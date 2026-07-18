// TerminalSearchEngine：终端内搜索的自实现引擎（行为规格 terminal-search-bar.md §M3「搜索执行」）。
//
// libghostty-vt 无内建 search API（vt 头文件核销：grid_ref.h 仅提「search state」作 tracked ref
// 的举例用途，无检索函数）→ 自实现：查询时经 grid_ref 逐行取 SCREEN 全域文本（scrollback+active），
// 大小写不敏感、逐 grapheme cluster 的子串匹配（M3 不做 regex），命中记 SCREEN 绝对坐标 + 网格列区间。
//
// 并发（对齐 SelectionController §4）：会话串行 queue 专属，所有触 C 的方法 dispatchPrecondition
// 断言在 queue 上，与 vt feed 互斥。term 借用会话句柄，shutdown 置 nil 后 no-op。
//
// 坐标系（point.h）：匹配用 GHOSTTY_POINT_TAG_SCREEN（含 scrollback 的全屏，y 单调 0→total-1），
// 命中的 screenRow 是绝对行号；渲染端（RenderCoordinator）每帧按 scrollbar.offset 映射回 viewport 行。
// CJK：宽字符占 2 网格列（char 列 + SPACER_TAIL 列），SPACER_TAIL 不贡献文本，命中列区间涵盖两列。
import CGhosttyVT
import Dispatch

/// 一条命中（SCREEN 绝对坐标；colFrom/colTo 为闭区间网格列，宽字符涵盖其占用两列）。
struct SearchMatch: Sendable, Equatable {
    var screenRow: Int
    var colFrom: Int
    var colTo: Int
}

/// 一个网格列的文本贡献（text 已小写化；startCol/endCol 为该 cluster 占用的网格列闭区间）。
struct LineCluster: Equatable {
    var text: String
    var startCol: Int
    var endCol: Int
}

final class TerminalSearchEngine: @unchecked Sendable {
    private let queue: DispatchQueue
    /// 借用会话 terminal 句柄；shutdown 置 nil 后所有操作 no-op。
    private var term: OpaquePointer?

    /// 命中列表（SCREEN 绝对坐标，按行升序、行内列升序）。
    private(set) var matches: [SearchMatch] = []
    /// 当前命中下标（nil = 无命中 / 未搜索）。
    private(set) var currentIndex: Int?
    /// 归一化查询（小写 grapheme clusters；空 = 未搜索/已清）。
    private var queryClusters: [String] = []

    init(queue: DispatchQueue, term: OpaquePointer) {
        self.queue = queue
        self.term = term
    }

    /// 会话 close 时在 queue 上调用：停用（后续操作 no-op）。
    func shutdownOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        term = nil
        matches = []
        currentIndex = nil
        queryClusters = []
    }

    var matchCount: Int { matches.count }
    var currentMatch: SearchMatch? {
        guard let i = currentIndex, matches.indices.contains(i) else { return nil }
        return matches[i]
    }

    // MARK: - 查询 / 导航（会话 queue）

    /// 重建命中（query 空 → 清）。preferFromScreenRow：新查询选「该行及之后的首个命中」，无则回首个（环绕语义）。
    func setQueryOnQueue(_ query: String, preferFromScreenRow: Int) {
        dispatchPrecondition(condition: .onQueue(queue))
        queryClusters = Self.clusters(of: query.lowercased())
        rebuild(preferFromScreenRow: preferFromScreenRow)
    }

    /// 清空（关闭搜索条 / 空查询）。
    func clearOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        queryClusters = []
        matches = []
        currentIndex = nil
    }

    /// 下一个（环绕）。返回新的当前命中（无命中 → nil）。
    @discardableResult
    func nextOnQueue() -> SearchMatch? {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !matches.isEmpty else { currentIndex = nil; return nil }
        let cur = currentIndex ?? -1
        currentIndex = (cur + 1) % matches.count
        return currentMatch
    }

    /// 上一个（环绕）。返回新的当前命中（无命中 → nil）。
    @discardableResult
    func prevOnQueue() -> SearchMatch? {
        dispatchPrecondition(condition: .onQueue(queue))
        guard !matches.isEmpty else { currentIndex = nil; return nil }
        let cur = currentIndex ?? 0
        currentIndex = (cur - 1 + matches.count) % matches.count
        return currentMatch
    }

    // MARK: - 重建（会话 queue；唯一触 grid_ref 逐行读取处）

    private func rebuild(preferFromScreenRow: Int) {
        matches = []
        currentIndex = nil
        guard let term, !queryClusters.isEmpty else { return }

        var cols16: UInt16 = 0
        ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_COLS, &cols16)
        let cols = Int(cols16)
        var total: UInt64 = 0
        ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_TOTAL_ROWS, &total)
        let totalRows = Int(total)
        guard cols > 0, totalRows > 0 else { return }

        var found: [SearchMatch] = []
        for y in 0..<totalRows {
            let line = readLineOnQueue(term: term, screenRow: y, cols: cols)
            guard !line.isEmpty else { continue }
            for span in Self.findSpans(in: line, query: queryClusters) {
                found.append(SearchMatch(screenRow: y, colFrom: span.from, colTo: span.to))
            }
        }
        matches = found
        if !found.isEmpty {
            currentIndex = found.firstIndex { $0.screenRow >= preferFromScreenRow } ?? 0
        }
    }

    /// 读一 SCREEN 行为 [LineCluster]（小写化；宽字符占两列、SPACER 跳过；空 cell 记单空格）。
    private func readLineOnQueue(term: OpaquePointer, screenRow: Int, cols: Int) -> [LineCluster] {
        var out: [LineCluster] = []
        out.reserveCapacity(cols)
        for x in 0..<cols {
            var point = GhosttyPoint()
            point.tag = GHOSTTY_POINT_TAG_SCREEN
            point.value.coordinate = GhosttyPointCoordinate(x: UInt16(x), y: UInt32(screenRow))
            var ref = GhosttyGridRef()
            ref.size = MemoryLayout<GhosttyGridRef>.size
            guard ghostty_terminal_grid_ref(term, point, &ref) == GHOSTTY_SUCCESS else { break }

            var cell: GhosttyCell = 0
            guard ghostty_grid_ref_cell(&ref, &cell) == GHOSTTY_SUCCESS else { continue }

            var wide = GHOSTTY_CELL_WIDE_NARROW
            ghostty_cell_get(cell, GHOSTTY_CELL_DATA_WIDE, &wide)
            // 宽字符尾/首占位格不独立贡献文本（其 char 格的 endCol 已涵盖尾格列）。
            if wide == GHOSTTY_CELL_WIDE_SPACER_TAIL || wide == GHOSTTY_CELL_WIDE_SPACER_HEAD { continue }

            var hasText = false
            ghostty_cell_get(cell, GHOSTTY_CELL_DATA_HAS_TEXT, &hasText)
            let width = (wide == GHOSTTY_CELL_WIDE_WIDE) ? 2 : 1
            let cluster = hasText ? readGraphemesOnQueue(&ref).lowercased() : " "
            out.append(LineCluster(text: cluster, startCol: x, endCol: x + width - 1))
        }
        return out
    }

    /// 读 grid_ref 处 cell 的完整 grapheme cluster（codepoints → String）。缓冲不足则扩容重读。
    private func readGraphemesOnQueue(_ ref: inout GhosttyGridRef) -> String {
        var buf = [UInt32](repeating: 0, count: 16)
        var needed = 0
        var rc = buf.withUnsafeMutableBufferPointer {
            ghostty_grid_ref_graphemes(&ref, $0.baseAddress, $0.count, &needed)
        }
        if rc == GHOSTTY_OUT_OF_SPACE, needed > buf.count {
            buf = [UInt32](repeating: 0, count: needed)
            rc = buf.withUnsafeMutableBufferPointer {
                ghostty_grid_ref_graphemes(&ref, $0.baseAddress, $0.count, &needed)
            }
        }
        guard rc == GHOSTTY_SUCCESS, needed > 0 else { return "" }
        var scalars = String.UnicodeScalarView()
        for i in 0..<needed {
            if let sc = Unicode.Scalar(buf[i]) { scalars.append(sc) }
        }
        return String(scalars)
    }

    // MARK: - 纯匹配（可独立单测；引擎与测试共用）

    /// 在一行 clusters 中找 query（逐 cluster 相等、非重叠、左→右）。返回每处命中的网格列闭区间。
    /// query cluster 与 line[i].text 均已小写化 → 大小写不敏感。
    static func findSpans(in line: [LineCluster], query: [String]) -> [(from: Int, to: Int)] {
        let m = query.count
        guard m > 0, line.count >= m else { return [] }
        var spans: [(from: Int, to: Int)] = []
        let n = line.count
        var i = 0
        while i <= n - m {
            var k = 0
            while k < m, line[i + k].text == query[k] { k += 1 }
            if k == m {
                spans.append((line[i].startCol, line[i + m - 1].endCol))
                i += m // 非重叠
            } else {
                i += 1
            }
        }
        return spans
    }

    /// 字符串 → grapheme cluster 数组（每个 Character 一个单元，与终端 cell 的 cluster 口径一致）。
    static func clusters(of s: String) -> [String] { s.map(String.init) }
}
