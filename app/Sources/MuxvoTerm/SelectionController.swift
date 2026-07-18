// SelectionController：选区手势状态机（行为规格 terminal-input.md §4）。会话串行 queue 专属。
//
// 落实 §4 的 vt 手势路径（对照 vendor 例 c-vt-selection-gesture）：
//   press → drag → release 三事件复用（typed，创建时定型），全在会话 queue 上应用（与 vt feed 互斥）。
//   - 单击 CELL press 返回 GHOSTTY_NO_VALUE（只记 anchor）→ 视作「新点击清旧选区」。
//   - 双击 WORD / 三击 LINE 由 gesture 内建 CLICK_COUNT 驱动 behavior（附件 A §7 遗留①核销：内建，
//     无需自写词边界）——须给 press 提供 TIME_NS + REPEAT_INTERVAL_NS + REPEAT_DISTANCE 才有多击态。
//   - drag/多击 press 返回 GhosttySelection 快照 → 立即经 OPT_SELECTION 装回 terminal（copy 成 tracked
//     状态，snapshot 无需存续）。装回后 render state 的 ROW_DATA_SELECTION 每行给区间 → 快照反色。
//   - 输出滚动时选区存续由 vt tracked grid ref 语义自动管（视图只重绘），此层不额外处理。
//
// 生命周期：gesture + 三 event 由本控制器拥有；shutdownOnQueue 在 terminal_free 之前释放
// （gesture_free 需传活 terminal 以回收 tracked 引用）。
import CGhosttyVT
import Dispatch

final class SelectionController: @unchecked Sendable {
    private let queue: DispatchQueue
    /// 借用会话 terminal 句柄；shutdown 置 nil 后所有操作 no-op。
    private var term: OpaquePointer?
    private var gesture: OpaquePointer?
    private var pressEvent: OpaquePointer?
    private var dragEvent: OpaquePointer?
    private var releaseEvent: OpaquePointer?

    /// Shift+Click 扩展选区序列位（DOGFOOD_M3_17，§4 ☆）：extend press 命中取值链后置 true，
    /// 令其后 drag 绕开 gesture 状态机（每事件重读 DATA_SELECTION.start 为固定端、只移 end），release
    /// 清位（不喂 gesture release——gesture 没见过对应 press）。clear/普通 press/shutdown 防御性清位。
    /// queue-confined，仅经会话 queue 访问。
    private var extendDragActive = false

    /// 多击判定窗口（vt 惯例默认）：≤500ms 间隔且 ≤5px 位移视作连击。可后续 config 化。
    private let repeatIntervalNs: UInt64 = 500_000_000
    private let repeatDistancePx: Double = 5

    /// 全在会话 queue 上构造（terminal_new 同一 sync 块内）。任一 alloc 失败 → 整体 nil，
    /// 选区 API 退化为 no-op（不致命）。
    init?(queue: DispatchQueue, term: OpaquePointer) {
        dispatchPrecondition(condition: .onQueue(queue))
        self.queue = queue
        self.term = term

        var g: OpaquePointer?
        guard ghostty_selection_gesture_new(nil, &g) == GHOSTTY_SUCCESS, let g else { return nil }
        self.gesture = g

        func makeEvent(_ type: GhosttySelectionGestureEventType) -> OpaquePointer? {
            var e: OpaquePointer?
            guard ghostty_selection_gesture_event_new(nil, &e, type) == GHOSTTY_SUCCESS else { return nil }
            return e
        }
        guard let p = makeEvent(GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_PRESS),
              let d = makeEvent(GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_DRAG),
              let r = makeEvent(GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_RELEASE) else {
            ghostty_selection_gesture_event_free(pressEvent)
            ghostty_selection_gesture_event_free(dragEvent)
            ghostty_selection_gesture_event_free(releaseEvent)
            ghostty_selection_gesture_free(g, term)
            return nil
        }
        self.pressEvent = p; self.dragEvent = d; self.releaseEvent = r
    }

    func shutdownOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        extendDragActive = false   // 防御性清 extend 位
        if let gesture, let term { ghostty_selection_gesture_reset(gesture, term) }
        ghostty_selection_gesture_event_free(pressEvent)
        ghostty_selection_gesture_event_free(dragEvent)
        ghostty_selection_gesture_event_free(releaseEvent)
        if let gesture { ghostty_selection_gesture_free(gesture, term) }
        pressEvent = nil; dragEvent = nil; releaseEvent = nil; gesture = nil; term = nil
    }

    // MARK: - 手势事件（会话 queue；col/row 已由调用方按 viewport 尺寸 clamp）

    /// press：装 REF + 多击判定参数 + behaviors 表（单 CELL / 双 WORD / 三 LINE）。
    /// SUCCESS（多击词/行选）→ 装回；NO_VALUE（单击 anchor）→ 清旧选区。
    func pressOnQueue(col: Int, row: Int, surfaceX: Double, surfaceY: Double, timeNs: UInt64) {
        dispatchPrecondition(condition: .onQueue(queue))
        extendDragActive = false   // 普通 press 起新 gesture 序列：防御性清 extend 位（防泄漏）
        guard let term, let gesture, let pressEvent, var ref = gridRef(term, col: col, row: row) else { return }

        _ = ghostty_selection_gesture_event_set(pressEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, &ref)
        var pos = GhosttySurfacePosition(x: surfaceX, y: surfaceY)
        _ = ghostty_selection_gesture_event_set(pressEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION, &pos)
        var t = timeNs
        _ = ghostty_selection_gesture_event_set(pressEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_TIME_NS, &t)
        var interval = repeatIntervalNs
        _ = ghostty_selection_gesture_event_set(pressEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_INTERVAL_NS, &interval)
        var dist = repeatDistancePx
        _ = ghostty_selection_gesture_event_set(pressEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_DISTANCE, &dist)
        var behaviors = GhosttySelectionGestureBehaviors(
            single_click: GHOSTTY_SELECTION_GESTURE_BEHAVIOR_CELL,
            double_click: GHOSTTY_SELECTION_GESTURE_BEHAVIOR_WORD,
            triple_click: GHOSTTY_SELECTION_GESTURE_BEHAVIOR_LINE)
        _ = ghostty_selection_gesture_event_set(pressEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_BEHAVIORS, &behaviors)

        var sel = GhosttySelection(); sel.size = MemoryLayout<GhosttySelection>.size
        if ghostty_selection_gesture_event(gesture, term, pressEvent, &sel) == GHOSTTY_SUCCESS {
            install(&sel)
        } else {
            clear()
        }
    }

    /// Shift+Click 扩展选区 press（DOGFOOD_M3_17，§4 ☆）：固定端 = 取值链（现活选区 start → gesture
    /// 活 anchor → 皆无退化普通 press），moving 端 = 点击格。命中取值链则**不喂 gesture press**、构造
    /// GhosttySelection{start:fixed,end:click,rectangle:false} 装回（方向保持——**不过 ordered 归一化**：
    /// 点选区前得 REVERSE 选区，导出/反色天然正确；点中间收缩为 start..click，xterm.js incremental 惯例）→
    /// reset gesture 杀挂起多击序列（消灭「500ms 内 shift+click 判 double→WORD」）→ 置 extend 位。
    /// 全在同一 queue.sync 块内（调用方 selectionPress 的块）：读 → gridRef → 构造 → install，块间不持
    /// untracked ref（DATA_SELECTION/ANCHOR 的 start 与 click ref 皆 untracked，install 前无 mutating 调用，
    /// install 即转 tracked，此后不再引用）。
    func extendPressOnQueue(col: Int, row: Int, surfaceX: Double, surfaceY: Double, timeNs: UInt64) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term, let gesture else { return }
        // 取值链固定端 + 点击格：皆得 → 构造 install；任一空（无选区无 anchor 首击 / 越界）→ 退化普通 press
        // （保 anchor/多击计时/后续 drag 起选）。
        guard let fixed = fixedStartRef(), let click = gridRef(term, col: col, row: row) else {
            pressOnQueue(col: col, row: row, surfaceX: surfaceX, surfaceY: surfaceY, timeNs: timeNs)
            return
        }
        var sel = GhosttySelection()
        sel.size = MemoryLayout<GhosttySelection>.size
        sel.start = fixed        // 固定端（方向保持端）
        sel.end = click          // moving 端 = 点击格
        sel.rectangle = false
        install(&sel)                                    // 直装：不过 ordered 归一化（方向即「start 固定」语义载体）
        ghostty_selection_gesture_reset(gesture, term)   // 杀挂起多击序列（连 shift+click 不升 WORD/LINE）；
                                                         // 此后已有活选区，下次 extend 走取值链第 1 级
        extendDragActive = true
    }

    /// drag：装 REF + GEOMETRY（后者手势要求）+ POSITION。返回选区快照即装回。
    /// geometry 主要供 autoscroll 边缘判定（当前 autoscroll 尽力延后，见报告）；drag 端点以 REF 为准。
    func dragOnQueue(col: Int, row: Int, surfaceX: Double, surfaceY: Double,
                     columns: Int, cellWidthPx: Int, screenHeightPx: Int) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term else { return }
        // Shift+Click 扩展序列（DOGFOOD_M3_17，§4 ☆）：绕开 gesture 状态机——每事件重读 DATA_SELECTION.start
        // 为固定端（terminal 自身 tracked 存储，滚动/输出存续自动管）+ 当前 drag 格构造 install，不进 gesture
        // drag。autoscroll tick 经 selectionDrag 同路零特判；tick 期若 DATA_SELECTION 读到 NO_VALUE 则 no-op 防御。
        if extendDragActive {
            var cur = GhosttySelection(); cur.size = MemoryLayout<GhosttySelection>.size
            guard ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SELECTION, &cur) == GHOSTTY_SUCCESS,
                  let click = gridRef(term, col: col, row: row) else { return }
            var sel = GhosttySelection()
            sel.size = MemoryLayout<GhosttySelection>.size
            sel.start = cur.start   // 固定端恒 = 逻辑 start（方向保持）
            sel.end = click
            sel.rectangle = false
            install(&sel)
            return
        }
        guard let gesture, let dragEvent, var ref = gridRef(term, col: col, row: row) else { return }

        _ = ghostty_selection_gesture_event_set(dragEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, &ref)
        var pos = GhosttySurfacePosition(x: surfaceX, y: surfaceY)
        _ = ghostty_selection_gesture_event_set(dragEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION, &pos)
        var geo = GhosttySelectionGestureGeometry(
            columns: UInt32(max(1, columns)),
            cell_width: UInt32(max(1, cellWidthPx)),
            padding_left: 0,
            screen_height: UInt32(max(1, screenHeightPx)))
        _ = ghostty_selection_gesture_event_set(dragEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_GEOMETRY, &geo)

        var sel = GhosttySelection(); sel.size = MemoryLayout<GhosttySelection>.size
        if ghostty_selection_gesture_event(gesture, term, dragEvent, &sel) == GHOSTTY_SUCCESS {
            install(&sel)
        }
    }

    /// release：仅更新手势状态（返回 NO_VALUE，不产选区）。单击清除已在 press 完成，拖动选区保留。
    func releaseOnQueue(col: Int, row: Int) {
        dispatchPrecondition(condition: .onQueue(queue))
        // Shift+Click 扩展序列收尾（DOGFOOD_M3_17）：清位返回，**不喂 gesture release**——gesture 没见过
        // 对应 press（extend press 未喂 gesture）。选区已由 extend press/drag 装回、保留。
        if extendDragActive { extendDragActive = false; return }
        guard let term, let gesture, let releaseEvent else { return }
        if var ref = gridRef(term, col: col, row: row) {
            _ = ghostty_selection_gesture_event_set(releaseEvent, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, &ref)
        }
        _ = ghostty_selection_gesture_event(gesture, term, releaseEvent, nil)
    }

    /// 显式清除：重置手势 click 序列 + 清 terminal 选区。
    func clearOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        extendDragActive = false   // 防御性清 extend 位（旧选区照清、位不泄漏进下个序列）
        guard let term, let gesture else { return }
        ghostty_selection_gesture_reset(gesture, term)
        clear()
    }

    /// 是否有活选区（Cmd+C 门控）。
    func hasSelectionOnQueue() -> Bool {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term else { return false }
        var sel = GhosttySelection(); sel.size = MemoryLayout<GhosttySelection>.size
        return ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SELECTION, &sel) == GHOSTTY_SUCCESS
    }

    /// 活选区端点是否 REVERSE（DOGFOOD_M3_17 §4 ☆ 实证：点选区前扩展得 REVERSE 选区）。无选区 → nil。
    /// 经 `ghostty_terminal_selection_order` 读端点序（FORWARD=0/REVERSE=1/MIRRORED_*=2,3，仅矩形选区出现）。
    func selectionReversedOnQueue() -> Bool? {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term else { return nil }
        var sel = GhosttySelection(); sel.size = MemoryLayout<GhosttySelection>.size
        guard ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SELECTION, &sel) == GHOSTTY_SUCCESS else { return nil }
        var order = GHOSTTY_SELECTION_ORDER_FORWARD
        guard ghostty_terminal_selection_order(term, &sel, &order) == GHOSTTY_SUCCESS else { return nil }
        return order == GHOSTTY_SELECTION_ORDER_REVERSE
    }

    /// 复制：formatter 导出活选区 plain text（unwrap+trim=Screen.selectionString 语义）。
    /// formatter.h 核销：选区字段名 = `selection`（NULL=活选区）；一次性 API
    /// ghostty_terminal_selection_format_alloc 直接支持 → 不需 grid_ref 遍历兜底。无选区 → nil。
    func copyPlainTextOnQueue() -> String? {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term else { return nil }
        var opts = GhosttyTerminalSelectionFormatOptions()
        opts.size = MemoryLayout<GhosttyTerminalSelectionFormatOptions>.size
        opts.emit = GHOSTTY_FORMATTER_FORMAT_PLAIN
        opts.unwrap = true
        opts.trim = true
        opts.selection = nil
        var ptr: UnsafeMutablePointer<UInt8>? = nil
        var len = 0
        let rc = ghostty_terminal_selection_format_alloc(term, nil, opts, &ptr, &len)
        guard rc == GHOSTTY_SUCCESS, let ptr, len > 0 else { return nil }
        defer { ghostty_free(nil, ptr, len) }
        return String(decoding: UnsafeBufferPointer(start: ptr, count: len), as: UTF8.self)
    }

    // MARK: - 私有

    /// Shift+Click 扩展的固定端取值链（DOGFOOD_M3_17，§4 ☆）。同一 queue 块内取用、立即构造 install，
    /// 返回的是 untracked GhosttyGridRef 快照（值拷贝，install 前无 mutating 调用则有效）：
    ///   ① 现活选区 `DATA_SELECTION.start`（方向保持端）；
    ///   ② gesture 活 anchor `DATA_ANCHOR`（单击 release 后存续性由 SelectionControllerTests 实证）；
    ///   皆无 → nil（调用方退化普通 press）。
    private func fixedStartRef() -> GhosttyGridRef? {
        guard let term else { return nil }
        var sel = GhosttySelection(); sel.size = MemoryLayout<GhosttySelection>.size
        if ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SELECTION, &sel) == GHOSTTY_SUCCESS {
            return sel.start   // ① 现活选区逻辑 start
        }
        if let gesture {       // ② gesture 活 anchor
            var ref = GhosttyGridRef(); ref.size = MemoryLayout<GhosttyGridRef>.size
            if ghostty_selection_gesture_get(gesture, term, GHOSTTY_SELECTION_GESTURE_DATA_ANCHOR, &ref) == GHOSTTY_SUCCESS {
                return ref
            }
        }
        return nil
    }

    /// viewport (col,row) → 未跟踪 grid ref 快照。越界返回 nil。
    private func gridRef(_ term: OpaquePointer, col: Int, row: Int) -> GhosttyGridRef? {
        var point = GhosttyPoint()
        point.tag = GHOSTTY_POINT_TAG_VIEWPORT
        point.value.coordinate = GhosttyPointCoordinate(x: UInt16(max(0, col)), y: UInt32(max(0, row)))
        var ref = GhosttyGridRef(); ref.size = MemoryLayout<GhosttyGridRef>.size
        guard ghostty_terminal_grid_ref(term, point, &ref) == GHOSTTY_SUCCESS else { return nil }
        return ref
    }

    private func install(_ sel: inout GhosttySelection) {
        guard let term else { return }
        _ = ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_SELECTION, &sel)
    }

    private func clear() {
        guard let term else { return }
        _ = ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_SELECTION, nil)
    }
}
