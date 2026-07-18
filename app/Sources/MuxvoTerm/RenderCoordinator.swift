// RenderCoordinator：渲染数据面的唯一 updater（行为规格 terminal-rendering.md §0-§5）。
//
// 落实 M0 三条架构合同的①②：
//   ① render state 归会话所有、多视图共读——GhosttyRenderState + row iterator + cells 缓冲
//      全挂本 coordinator（其生命周期 = 会话生命周期 = terminal 生命周期），唯一 updater。
//      视图不再各持 render state 互抢 terminal dirty；改为读会话物化好的不可变快照。
//   ② dirty 驱动 + ~4ms 节流合并——feed 只置脏，节流调度 update；draw 路径永不 sync 进
//      会话 queue（消除探针实测 15.4ms 竞争）。resize/滚动/选区/焦点走「立即通道」跳过节流。
//
// 数据流（§1.1）：
//   feed(会话queue) → vt_write → feedDidWriteOnQueue 置脏+调度
//     → performUpdateOnQueue(会话queue) → ghostty_render_state_update(独占 terminal，同 queue 天然互斥)
//     → 遍历 dirty 行构建/复用 → 物化 TerminalFrameSnapshot(generation++)
//     → OSAllocatedUnfairLock 原子发布 → 通知观察者(各自投递 queue，默认 main→needsDisplay)
//
// 线程模型：除 currentSnapshot()（任意线程读发布锁）外，所有方法均在会话串行 queue 上跑，
// 以 dispatchPrecondition 断言。@unchecked Sendable：queue-confined 状态 + 发布锁人工保证。
import CGhosttyVT
import Dispatch
import Foundation
import os

/// render state 三句柄的生命周期容器：deinit 统一释放（会话释放 coordinator 时归零）。
final class RenderHandles: @unchecked Sendable {
    let state: OpaquePointer
    let iter: OpaquePointer
    let cells: OpaquePointer

    init?() {
        var st: OpaquePointer?
        guard ghostty_render_state_new(nil, &st) == GHOSTTY_SUCCESS, let st else { return nil }
        var it: OpaquePointer?
        guard ghostty_render_state_row_iterator_new(nil, &it) == GHOSTTY_SUCCESS, let it else {
            ghostty_render_state_free(st)
            return nil
        }
        var ce: OpaquePointer?
        guard ghostty_render_state_row_cells_new(nil, &ce) == GHOSTTY_SUCCESS, let ce else {
            ghostty_render_state_free(st)
            ghostty_render_state_row_iterator_free(it)
            return nil
        }
        self.state = st; self.iter = it; self.cells = ce
    }

    deinit {
        ghostty_render_state_row_cells_free(cells)
        ghostty_render_state_row_iterator_free(iter)
        ghostty_render_state_free(state)
    }
}

final class RenderCoordinator: @unchecked Sendable {
    /// 节流最小间隔（§1.2 ~4ms 合并调度）。
    static let minIntervalNanos: UInt64 = 4_000_000

    private let queue: DispatchQueue
    /// 借用会话的 terminal 句柄。shutdown 时置 nil → 之后所有排队的 flush 皆 no-op。
    private var term: OpaquePointer?
    private let handles: RenderHandles

    // 节流状态（仅会话 queue 访问）
    private var dirty = false
    private var flushScheduled = false
    private var lastFlushAt: DispatchTime?
    private var scrolledSinceUpdate = false

    // 搜索命中（SCREEN 绝对坐标；仅会话 queue 访问）——buildSnapshot 每帧按 scrollbar.offset 映射到 viewport 行。
    private var searchMatches: [SearchMatch] = []
    private var searchCurrentIndex: Int?

    // 快照构建状态（仅会话 queue 访问）
    private var genCounter: UInt64 = 0
    private var lastLines: [RowSnapshot] = []          // 上一帧行（行内容缓存骨架：未变行跨帧复用）
    private var utf8Buf = [UInt8](repeating: 0, count: 512)
    private var lastPaletteBytes: [UInt8]?             // 色板缓存：字节未变则复用同一 [RGBA]（省分配/共享）
    private var lastPalette: [RGBA] = Array(repeating: RGBA(r: 0, g: 0, b: 0), count: 256)

    // 发布槽（任意线程读；draw 路径只碰这把锁，永不进会话 queue）
    private let published = OSAllocatedUnfairLock<TerminalFrameSnapshot?>(initialState: nil)

    // 观察者（仅会话 queue 增删/遍历；投递到各自 deliverQueue）
    private struct Observer {
        let id: Int
        let deliverQueue: DispatchQueue
        let callback: @Sendable (TerminalFrameSnapshot) -> Void
    }
    private var observers: [Observer] = []
    private var nextObserverID = 1

    init?(queue: DispatchQueue, term: OpaquePointer) {
        guard let h = RenderHandles() else { return nil }
        self.queue = queue
        self.term = term
        self.handles = h
    }

    // MARK: - 生命周期

    /// 会话 close 时在 queue 上调用：停用 coordinator（后续 flush 全 no-op）。
    /// 句柄本身随 coordinator 释放由 RenderHandles.deinit 收（会话不再持 coordinator 后）。
    func shutdownOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        term = nil
        observers.removeAll()
        published.withLock { $0 = nil }
    }

    // MARK: - 发布槽读取（任意线程）

    /// draw / 视图读最新一帧（零锁竞争的短临界区，永不 sync 进会话 queue）。
    func currentSnapshot() -> TerminalFrameSnapshot? { published.withLock { $0 } }

    // MARK: - 观察者（会话 queue）

    func addObserverOnQueue(
        deliverOn: DispatchQueue,
        _ callback: @escaping @Sendable (TerminalFrameSnapshot) -> Void
    ) -> Int {
        dispatchPrecondition(condition: .onQueue(queue))
        let id = nextObserverID
        nextObserverID += 1
        observers.append(Observer(id: id, deliverQueue: deliverOn, callback: callback))
        return id
    }

    func removeObserverOnQueue(_ id: Int) {
        dispatchPrecondition(condition: .onQueue(queue))
        observers.removeAll { $0.id == id }
    }

    // MARK: - feed 节流通道（会话 queue）

    /// feed 写完 vt 后置脏并调度节流 update（§1.2：feed 只置脏标志）。
    func feedDidWriteOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        dirty = true
        scheduleThrottledFlush()
    }

    /// 至多一个在途的节流 flush；到点且脏才 update，把窗口内的 feed 合并成一次。
    private func scheduleThrottledFlush() {
        guard !flushScheduled, term != nil else { return }
        flushScheduled = true
        let now = DispatchTime.now()
        let deadline: DispatchTime
        if let last = lastFlushAt {
            let earliest = last.uptimeNanoseconds + RenderCoordinator.minIntervalNanos
            deadline = earliest > now.uptimeNanoseconds
                ? DispatchTime(uptimeNanoseconds: earliest) : now
        } else {
            deadline = now  // 首帧不延迟（leading edge）
        }
        queue.asyncAfter(deadline: deadline) { [weak self] in
            self?.throttledFlushOnQueue()
        }
    }

    private func throttledFlushOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        flushScheduled = false
        guard dirty, term != nil else { return }
        performUpdateOnQueue(forceFull: false)
    }

    // MARK: - 立即通道（resize/滚动/选区/焦点）

    // MARK: - 搜索命中（会话 queue；引擎推入，buildSnapshot 每帧映射）

    /// 引擎重建/导航后推入当前命中集（SCREEN 绝对坐标 + 当前下标）。
    func setSearchOnQueue(matches: [SearchMatch], currentIndex: Int?) {
        dispatchPrecondition(condition: .onQueue(queue))
        searchMatches = matches
        searchCurrentIndex = currentIndex
    }

    /// 清空搜索命中（关闭搜索条 / 空查询）。
    func clearSearchOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        searchMatches = []
        searchCurrentIndex = nil
    }

    /// 标记「本帧发生过滚动」——buildSnapshot 据此查 scrollbar（否则 active 时不查，省开销）。
    func noteScrollOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        scrolledSinceUpdate = true
    }

    /// 立即 update（异步 hop 到会话 queue）：跳过节流。forceFull=true 全行重建（选区/滚动/resize）。
    func requestImmediateUpdate(forceFull: Bool) {
        queue.async { [weak self] in self?.performUpdateOnQueue(forceFull: forceFull) }
    }

    // MARK: - 唯一 update 路径（会话 queue）

    func performUpdateOnQueue(forceFull: Bool) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term else { return }
        dirty = false
        lastFlushAt = DispatchTime.now()
        // render.h：update 期间独占 terminal（同 queue 与 feed 天然互斥）；只消费一次 dirty。
        guard ghostty_render_state_update(handles.state, term) == GHOSTTY_SUCCESS else { return }
        let snapshot = buildSnapshot(term: term, forceFull: forceFull)
        published.withLock { $0 = snapshot }
        // 通知各视图（多视图共读同一份 snapshot；默认投递 main → needsDisplay）。
        for obs in observers {
            let cb = obs.callback
            obs.deliverQueue.async { cb(snapshot) }
        }
    }

    // MARK: - 快照物化（会话 queue；唯一触 render state 逐行/逐 cell 读取处）

    private func buildSnapshot(term: OpaquePointer, forceFull: Bool) -> TerminalFrameSnapshot {
        let st = handles.state
        genCounter += 1
        let generation = genCounter

        var cols16: UInt16 = 0
        var rows16: UInt16 = 0
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_COLS, &cols16)
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_ROWS, &rows16)
        let cols = Int(cols16)
        let rows = Int(rows16)

        var gdirty = GHOSTTY_RENDER_STATE_DIRTY_FALSE
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_DIRTY, &gdirty)
        let full = forceFull || gdirty == GHOSTTY_RENDER_STATE_DIRTY_FULL || lastLines.count != rows

        let colors = readColors(st)
        let defaultFg = colors.foreground
        let defaultBg = colors.background

        var newLines: [RowSnapshot] = []
        newLines.reserveCapacity(rows)
        var selectionRanges: [SelectionRange] = []

        // 行迭代：populate 预分配 iterator（handles.iter），逐视口行走。
        var itHandle: OpaquePointer? = handles.iter
        _ = ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, &itHandle)
        var y = 0
        while ghostty_render_state_row_iterator_next(handles.iter) {
            if y >= rows { break }

            var rowDirty = false
            ghostty_render_state_row_get(handles.iter, GHOSTTY_RENDER_STATE_ROW_DATA_DIRTY, &rowDirty)

            // 选区（每行 cheap，render.h 建议每行查一次而非逐 cell）。
            var sel = GhosttyRenderStateRowSelection()
            sel.size = MemoryLayout<GhosttyRenderStateRowSelection>.size
            let selRC = ghostty_render_state_row_get(handles.iter, GHOSTTY_RENDER_STATE_ROW_DATA_SELECTION, &sel)
            let rowSel: (Int, Int)? = selRC == GHOSTTY_SUCCESS ? (Int(sel.start_x), Int(sel.end_x)) : nil
            if let (from, to) = rowSel {
                selectionRanges.append(SelectionRange(row: y, from: from, to: to))
            }

            if full || rowDirty || y >= lastLines.count {
                newLines.append(buildRow(defaultFg: defaultFg, defaultBg: defaultBg,
                                         selection: rowSel, dirtyOnBuild: true))
            } else {
                // 行内容缓存骨架：未变行复用上一帧 RowSnapshot（同 contentHash → 批 3 shaping 缓存命中）。
                newLines.append(reuseRow(lastLines[y], selection: rowSel))
            }

            // 消费后清行级脏（render.h 双层契约：清 global 不清 row，须分别清）。
            var cleanRow = false
            ghostty_render_state_row_set(handles.iter, GHOSTTY_RENDER_STATE_ROW_OPTION_DIRTY, &cleanRow)
            y += 1
        }
        // 消费后清全局脏。
        var cleanState = GHOSTTY_RENDER_STATE_DIRTY_FALSE
        ghostty_render_state_set(st, GHOSTTY_RENDER_STATE_OPTION_DIRTY, &cleanState)

        lastLines = newLines

        let cursor = readCursor(st)

        // viewportActive（terminal 数据，非 render state）；scrollbar 仅非 active 或本帧滚动过才查（开销大）。
        var viewportActive = true
        _ = ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE, &viewportActive)
        var scrollbar: ScrollbarSnapshot?
        if !viewportActive || scrolledSinceUpdate {
            var sb = GhosttyTerminalScrollbar()
            if ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &sb) == GHOSTTY_SUCCESS {
                scrollbar = ScrollbarSnapshot(total: Int(sb.total), offset: Int(sb.offset), len: Int(sb.len))
            }
        }
        scrolledSinceUpdate = false

        let searchHighlights = mapSearchHighlights(term: term, rows: rows, scrollbar: scrollbar)

        return TerminalFrameSnapshot(
            generation: generation, cols: cols, rows: rows, lines: newLines,
            cursor: cursor, colors: colors, selectionRanges: selectionRanges,
            scrollbar: scrollbar, viewportActive: viewportActive,
            searchHighlights: searchHighlights)
    }

    /// SCREEN 绝对命中 → viewport 行高亮：viewportRow = screenRow - scrollbar.offset（offset = viewport
    /// 顶端的 SCREEN 行号）。仅落在 [0,rows) 的命中入帧；当前命中打 isCurrent（强高亮）。
    private func mapSearchHighlights(term: OpaquePointer, rows: Int, scrollbar: ScrollbarSnapshot?) -> [SearchHighlight] {
        guard !searchMatches.isEmpty else { return [] }
        let offset: Int
        if let sb = scrollbar {
            offset = sb.offset
        } else {
            var sb2 = GhosttyTerminalScrollbar()
            offset = ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &sb2) == GHOSTTY_SUCCESS
                ? Int(sb2.offset) : 0
        }
        var out: [SearchHighlight] = []
        for (idx, m) in searchMatches.enumerated() {
            let vr = m.screenRow - offset
            guard vr >= 0, vr < rows else { continue }
            out.append(SearchHighlight(row: vr, from: m.colFrom, to: m.colTo, isCurrent: idx == searchCurrentIndex))
        }
        return out
    }

    private func buildRow(defaultFg: RGBA, defaultBg: RGBA, selection: (Int, Int)?, dirtyOnBuild: Bool) -> RowSnapshot {
        var ceHandle: OpaquePointer? = handles.cells
        guard ghostty_render_state_row_get(handles.iter, GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, &ceHandle) == GHOSTTY_SUCCESS else {
            return RowSnapshot(cells: [], dirtyOnBuild: dirtyOnBuild, contentHash: 0)
        }
        let ce = handles.cells
        var cells: [TerminalCell] = []
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325   // FNV-1a offset basis
        @inline(__always) func mix(_ byte: UInt8) { hash = (hash ^ UInt64(byte)) &* 0x0000_0100_0000_01b3 }

        var x = -1
        while ghostty_render_state_row_cells_next(ce) {
            x += 1

            var flags: CellStyleFlags = []
            var hasStyling = false
            ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_HAS_STYLING, &hasStyling)
            if hasStyling {
                var style = GhosttyStyle()
                style.size = MemoryLayout<GhosttyStyle>.size
                if ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE, &style) == GHOSTTY_SUCCESS {
                    if style.bold { flags.insert(.bold) }
                    if style.italic { flags.insert(.italic) }
                    if style.faint { flags.insert(.faint) }
                    if style.blink { flags.insert(.blink) }
                    if style.inverse { flags.insert(.inverse) }
                    if style.invisible { flags.insert(.invisible) }
                    if style.strikethrough { flags.insert(.strikethrough) }
                    if style.overline { flags.insert(.overline) }
                    if style.underline != 0 { flags.insert(.underline) }
                }
            }

            var fg = defaultFg
            var bg = defaultBg
            var c = GhosttyColorRgb(r: 0, g: 0, b: 0)
            if ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR, &c) == GHOSTTY_SUCCESS {
                fg = RGBA(r: c.r, g: c.g, b: c.b)
            }
            if ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR, &c) == GHOSTTY_SUCCESS {
                bg = RGBA(r: c.r, g: c.g, b: c.b)
            }

            var grapheme = ""
            var glen: UInt32 = 0
            ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN, &glen)
            if glen > 0 { grapheme = readClusterUTF8(ce) ?? "" }

            let selected = selection.map { x >= $0.0 && x <= $0.1 } ?? false
            cells.append(TerminalCell(grapheme: grapheme, fg: fg, bg: bg, styleFlags: flags, selected: selected))

            // 内容 hash：grapheme + 样式 + fg/bg（不含 selected——选区变不算内容变，仍可复用 shaping）。
            for b in grapheme.utf8 { mix(b) }
            mix(UInt8(flags.rawValue & 0xff)); mix(UInt8((flags.rawValue >> 8) & 0xff))
            mix(fg.r); mix(fg.g); mix(fg.b); mix(bg.r); mix(bg.g); mix(bg.b)
        }
        return RowSnapshot(cells: cells, dirtyOnBuild: dirtyOnBuild, contentHash: hash)
    }

    /// 复用上一帧的行（内容未变），仅按当前选区刷新 selected 标志（不改内容/contentHash）。
    private func reuseRow(_ row: RowSnapshot, selection: (Int, Int)?) -> RowSnapshot {
        var r = row
        r.dirtyOnBuild = false
        guard let (from, to) = selection else {
            if row.cells.contains(where: { $0.selected }) {
                for i in r.cells.indices { r.cells[i].selected = false }
            }
            return r   // 无选区且原本也无 → 原值返回（与 lastLines[y] 共享底层存储）
        }
        for i in r.cells.indices { r.cells[i].selected = (i >= from && i <= to) }
        return r
    }

    private func readClusterUTF8(_ ce: OpaquePointer) -> String? {
        utf8Buf.withUnsafeMutableBufferPointer { p in
            var gb = GhosttyBuffer(ptr: p.baseAddress, cap: p.count, len: 0)
            let rc = ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8, &gb)
            guard rc == GHOSTTY_SUCCESS, gb.len > 0 else { return nil }
            return String(decoding: UnsafeBufferPointer(start: p.baseAddress, count: gb.len), as: UTF8.self)
        }
    }

    private func readCursor(_ st: OpaquePointer) -> CursorSnapshot {
        var visible = false
        var blinking = false
        var password = false
        var inViewport = false
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VISIBLE, &visible)
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_BLINKING, &blinking)
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_PASSWORD_INPUT, &password)
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_HAS_VALUE, &inViewport)
        var cx: UInt16 = 0
        var cy: UInt16 = 0
        if inViewport {
            ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_X, &cx)
            ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_Y, &cy)
        }
        var styleC = GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VISUAL_STYLE, &styleC)
        let style: CursorSnapshot.Style
        switch styleC {
        case GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR: style = .bar
        case GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_UNDERLINE: style = .underline
        case GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK_HOLLOW: style = .blockHollow
        default: style = .block
        }
        return CursorSnapshot(x: Int(cx), y: Int(cy), style: style, visible: visible,
                              blinking: blinking, passwordInput: password, inViewport: inViewport)
    }

    private func readColors(_ st: OpaquePointer) -> TerminalColors {
        var c = GhosttyRenderStateColors()
        c.size = MemoryLayout<GhosttyRenderStateColors>.size
        guard ghostty_render_state_colors_get(st, &c) == GHOSTTY_SUCCESS else {
            return TerminalColors(background: RGBA(r: 0, g: 0, b: 0), foreground: RGBA(r: 255, g: 255, b: 255),
                                  cursor: nil, palette: lastPalette)
        }
        let bg = RGBA(r: c.background.r, g: c.background.g, b: c.background.b)
        let fg = RGBA(r: c.foreground.r, g: c.foreground.g, b: c.foreground.b)
        let cursor: RGBA? = c.cursor_has_value ? RGBA(r: c.cursor.r, g: c.cursor.g, b: c.cursor.b) : nil
        // 色板：字节未变则复用同一 [RGBA]（省 256 次分配，跨快照共享底层存储）。
        let palette = paletteIfChanged(&c)
        return TerminalColors(background: bg, foreground: fg, cursor: cursor, palette: palette)
    }

    private func paletteIfChanged(_ c: inout GhosttyRenderStateColors) -> [RGBA] {
        let bytes = withUnsafeBytes(of: c.palette) { Array($0) }   // 256×3 = 768 字节
        if let last = lastPaletteBytes, last == bytes { return lastPalette }
        let palette: [RGBA] = withUnsafeBytes(of: c.palette) { raw in
            let buf = raw.bindMemory(to: GhosttyColorRgb.self)
            return (0..<256).map { RGBA(r: buf[$0].r, g: buf[$0].g, b: buf[$0].b) }
        }
        lastPaletteBytes = bytes
        lastPalette = palette
        return palette
    }
}
