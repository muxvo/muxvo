// 终端运行时换色 + colorScheme 应答（terminal-theme.md §5 立即生效 / §7 CSI ?996n）。
// 隔离会话（spawnShell=false，仅 vt）：applyTheme 后读快照有效色断言重注；feed 996 查询读 writePtyCapture
// 断言应答（997;1n=DARK / 997;2n=LIGHT，ghostty stream_terminal.zig:352-353 权威）。
import Foundation
import Testing
import MuxvoTermCore
@testable import MuxvoTerm

@Suite("终端运行时换色 + colorScheme 应答（applyTheme / CSI ?996n）")
struct ThemeApplyTests {

    private func waitUntil(timeout: TimeInterval = 3, _ cond: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !cond() { if Date() >= deadline { return false }; usleep(2000) }
        return true
    }

    private func isolatedSession(theme: TermTheme = .dark) throws -> TerminalSession {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.theme = theme
        return try TerminalSession(config: cfg)
    }

    @Test("applyTheme 立即生效：切 monokai → 快照 bg/palette 变；再切 light → bg/fg 变")
    func applyThemeUpdatesSnapshot() throws {
        let s = try isolatedSession()
        defer { s.close() }

        s.feed("x")   // 触首帧
        #expect(waitUntil { s.currentFrame() != nil })
        // 默认 dark：bg=#1e1e1e、fg=#cccccc（fg 修正后）。
        #expect(s.currentFrame()?.colors.background == RGBA(r: 0x1e, g: 0x1e, b: 0x1e))
        #expect(s.currentFrame()?.colors.foreground == RGBA(r: 0xcc, g: 0xcc, b: 0xcc))

        s.applyTheme(.monokai)
        #expect(waitUntil { s.currentFrame()?.colors.background == RGBA(r: 0x27, g: 0x28, b: 0x22) })
        #expect(s.currentFrame()?.colors.palette[1] == RGBA(r: 0xf9, g: 0x26, b: 0x72))  // monokai red

        s.applyTheme(.light)
        #expect(waitUntil { s.currentFrame()?.colors.background == RGBA(r: 0xff, g: 0xff, b: 0xff) })
        #expect(s.currentFrame()?.colors.foreground == RGBA(r: 0x38, g: 0x3a, b: 0x42))  // light fg
    }

    @Test("CSI ?996n 应答：dark/花样→997;1n（DARK）、light→997;2n（LIGHT）")
    func colorSchemeQueryResponse() throws {
        func query(_ theme: TermTheme) throws -> String {
            let s = try isolatedSession(theme: theme)
            defer { s.close() }
            s.feed("\u{1b}[?996n")
            #expect(waitUntil { !s.writePtyCapture().isEmpty })
            return String(decoding: s.writePtyCapture(), as: UTF8.self)
        }
        #expect(try query(.dark) == "\u{1b}[?997;1n")
        #expect(try query(.light) == "\u{1b}[?997;2n")          // 唯一报 LIGHT 的一套
        #expect(try query(.monokai) == "\u{1b}[?997;1n")        // 花样底色深 → DARK
        #expect(try query(.dracula) == "\u{1b}[?997;1n")
        #expect(try query(.solarizedDark) == "\u{1b}[?997;1n")
    }

    @Test("applyTheme 后 996 应答随存量 scheme 变：dark 会话切 light → 报 LIGHT")
    func colorSchemeFollowsApplyTheme() throws {
        let s = try isolatedSession(theme: .dark)
        defer { s.close() }
        // applyTheme 走 queue.async；feed 走 queue.sync——同一串行 queue，async 先入队故先执行，
        // 查询处理时 _colorScheme 已为 light（确定性，无竞态）。
        s.applyTheme(.light)
        s.feed("\u{1b}[?996n")
        #expect(waitUntil { !s.writePtyCapture().isEmpty })
        #expect(String(decoding: s.writePtyCapture(), as: UTF8.self) == "\u{1b}[?997;2n")
    }
}
