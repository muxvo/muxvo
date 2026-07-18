// 终端内搜索验收（批5②；行为规格 terminal-search-bar.md §5）。
// 全走 spawnShell:false 隔离会话 + 直接 feed VT 字节 + 快照/引擎查询，无 GUI、无 Metal、无 PTY。
// 命名纪律：本批无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import Darwin
import Foundation
import Testing
@testable import MuxvoTerm

private func waitUntil(timeout: TimeInterval = 5, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        usleep(2_000)
    }
    return cond()
}

private func makeSession(cols: UInt16 = 20, rows: UInt16 = 6) throws -> TerminalSession {
    var cfg = TerminalSession.Config()
    cfg.spawnShell = false
    cfg.cols = cols; cfg.rows = rows
    return try TerminalSession(config: cfg)
}

// MARK: - 纯匹配（findSpans；无会话，可独立断言重叠/多命中）

@Suite("findSpans 纯匹配：多命中非重叠、左→右")
struct SearchFindSpansTests {
    /// 造一行「窄字」clusters（每 cluster 占单列）。文本须已小写（引擎在读取处小写化）。
    private func line(_ s: String) -> [LineCluster] {
        s.enumerated().map { LineCluster(text: String($0.element), startCol: $0.offset, endCol: $0.offset) }
    }

    @Test("多命中非重叠：'ababa' 查 'aba' → 单命中 0...2（吃掉后自 i+=m，剩 'ba' 无命中）")
    func nonOverlapping() {
        let spans = TerminalSearchEngine.findSpans(in: line("ababa"), query: TerminalSearchEngine.clusters(of: "aba"))
        #expect(spans.count == 1)
        #expect(spans[0].from == 0 && spans[0].to == 2)
    }

    @Test("两处命中：'aa bb aa' 查 'aa' → 命中 0...1 与 6...7")
    func twoMatches() {
        let spans = TerminalSearchEngine.findSpans(in: line("aa bb aa"), query: TerminalSearchEngine.clusters(of: "aa"))
        #expect(spans.count == 2)
        #expect(spans[0].from == 0 && spans[0].to == 1)
        #expect(spans[1].from == 6 && spans[1].to == 7)
    }

    @Test("无命中 / 空查询 → 空")
    func noneAndEmpty() {
        #expect(TerminalSearchEngine.findSpans(in: line("hello"), query: TerminalSearchEngine.clusters(of: "zzz")).isEmpty)
        #expect(TerminalSearchEngine.findSpans(in: line("hello"), query: []).isEmpty)
    }
}

// MARK: - 会话搜索（feed + 查询 + 快照高亮走线）

@Suite("会话内搜索：命中/大小写/环绕/CJK/无命中/清除")
struct TerminalSearchSessionTests {

    @Test("大小写不敏感命中：'Hello hello HELLO' 查 'hello' → 3 命中、当前在首、快照 3 高亮含 1 当前")
    func caseInsensitiveMatchesAndHighlights() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("Hello hello HELLO\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        s.searchSetQuery("hello")
        #expect(s.searchMatchCount() == 3)
        #expect(s.searchCurrentScreenRow() == 0)

        #expect(waitUntil { (s.currentFrame()?.searchHighlights.count ?? 0) == 3 })
        let hls = try #require(s.currentFrame()).searchHighlights
        #expect(hls.filter { $0.isCurrent }.count == 1)
        #expect(hls.allSatisfy { $0.row == 0 })
    }

    @Test("next/prev 环绕：3 行各一命中，前进 0→1→2→0，后退回 2")
    func navigationWrapsAround() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("aa\r\naa\r\naa\r\n")
        #expect(waitUntil { (s.currentFrame()?.lines.count ?? 0) >= 3 })

        s.searchSetQuery("aa")
        #expect(s.searchMatchCount() == 3)
        #expect(s.searchCurrentScreenRow() == 0)
        s.searchNext(); #expect(s.searchCurrentScreenRow() == 1)
        s.searchNext(); #expect(s.searchCurrentScreenRow() == 2)
        s.searchNext(); #expect(s.searchCurrentScreenRow() == 0)   // 前进环绕
        s.searchPrev(); #expect(s.searchCurrentScreenRow() == 2)   // 后退环绕
    }

    @Test("CJK 宽字符：'你好世界' 查 '世界' → 1 命中，列区间涵盖两宽字所占 4 网格列（4...7）")
    func cjkWideCharSpansTwoColumns() throws {
        let s = try makeSession(cols: 20, rows: 6)
        defer { s.close() }
        s.feed("你好世界\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        s.searchSetQuery("世界")
        #expect(s.searchMatchCount() == 1)
        #expect(waitUntil { !(s.currentFrame()?.searchHighlights.isEmpty ?? true) })
        let hl = try #require(s.currentFrame()?.searchHighlights.first)
        #expect(hl.from == 4)   // 你=0-1 好=2-3 世=4-5 界=6-7
        #expect(hl.to == 7)
    }

    @Test("无命中：matchCount 0、currentScreenRow nil、快照无高亮")
    func noMatch() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("hello world\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        s.searchSetQuery("zzz")
        #expect(s.searchMatchCount() == 0)
        #expect(s.searchCurrentScreenRow() == nil)
        #expect(waitUntil { s.currentFrame()?.searchHighlights.isEmpty ?? false })
    }

    @Test("空查询清高亮（条仍开）；searchClear 亦清")
    func emptyQueryAndClearWipeHighlights() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("hello\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        s.searchSetQuery("hello")
        #expect(s.searchMatchCount() == 1)
        s.searchSetQuery("")   // 空查询 → 清
        #expect(s.searchMatchCount() == 0)
        #expect(waitUntil { s.currentFrame()?.searchHighlights.isEmpty ?? false })

        s.searchSetQuery("hello")
        #expect(s.searchMatchCount() == 1)
        s.searchClear()        // 显式清
        #expect(s.searchMatchCount() == 0)
        #expect(waitUntil { s.currentFrame()?.searchHighlights.isEmpty ?? false })
    }

    @Test("scrollback 深处命中：埋入 scrollback 的标记被搜到 → 滚动使其进入 viewport（SCREEN 绝对行映射到 viewport 行）")
    func scrollbackDepthMatchScrollsIntoView() throws {
        let s = try makeSession(cols: 20, rows: 6)
        defer { s.close() }
        // 第 2 行埋唯一标记，再灌足够行把它压入 scrollback。
        s.feed("line0\r\n")
        s.feed("MARKERZ\r\n")           // SCREEN 绝对行 1
        for i in 2..<40 { s.feed("line\(i)\r\n") }
        #expect(waitUntil { s.scrollbackRowCount() > 0 })
        s.ensureViewportAtBottom()      // 标记此时在可见区之上、不可见

        s.searchSetQuery("markerz")     // 大小写不敏感命中 scrollback
        #expect(s.searchMatchCount() == 1)
        #expect(s.searchCurrentScreenRow() == 1)   // 绝对 SCREEN 行

        // 引擎滚动使标记进入 viewport → 快照恰 1 处高亮，映射到某 viewport 行、且为当前命中。
        #expect(waitUntil { (s.currentFrame()?.searchHighlights.count ?? 0) == 1 })
        let hl = try #require(s.currentFrame()?.searchHighlights.first)
        #expect(hl.row >= 0 && hl.row < 6)
        #expect(hl.isCurrent)
    }
}
