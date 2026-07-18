// 选区门控 Cmd+C 判定 + 复制接真（批 4②；terminal-input.md §4/§8）。
// 走隔离 TerminalSession（spawnShell:false）+ 真选区手势，验证「session.hasSelection() 翻转 →
// CommandKeyInterception.decide 结果翻转」这条视图 performKeyEquivalent 依赖的接线。
import Darwin
import Foundation
import Testing
import CGhosttyVT
import MuxvoTerm
@testable import MuxvoTermRender

private func waitUntil(timeout: TimeInterval = 5, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        usleep(2_000)
    }
    return cond()
}

@MainActor
@Suite("选区门控 Cmd+C（hasSelection 翻转 → decide 翻转）")
struct SelectionGatingTests {

    private func makeSession() throws -> TerminalSession {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 20; cfg.rows = 6
        return try TerminalSession(config: cfg)
    }

    @Test("无选区 Cmd+C 放行；拖选后 Cmd+C 截留复制；clear 后再放行")
    func copyGateFlipsWithSelection() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("hello world\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        // 无选区：hasSelection false → decide 放行进 PTY。
        #expect(!s.hasSelection())
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_C,
                                              hasSelection: s.hasSelection()) == .forwardToPTY)

        // 拖选 "hello"（端点落 col 4 右半 px 39 → 含 cell 4，选区 0...4）。
        s.selectionPress(col: 0, row: 0, surfaceX: 0, surfaceY: 0, timeNs: 0)
        s.selectionDrag(col: 4, row: 0, surfaceX: 39, surfaceY: 0, columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        s.selectionRelease(col: 4, row: 0)
        #expect(waitUntil { s.hasSelection() })

        // 有选区：decide 截留复制；复制文本 == 期望。
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_C,
                                              hasSelection: s.hasSelection()) == .interceptCopy)
        #expect(s.copySelectionPlainText() == "hello")

        // 清除后回放行。
        s.clearSelection()
        #expect(waitUntil { !s.hasSelection() })
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_C,
                                              hasSelection: s.hasSelection()) == .forwardToPTY)
    }
}
