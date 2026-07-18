// cwd pin 窗口测试（terminal-session-restore.md 登记⑨修订，dogfood-r3 问题2）：
// 注入 cd 后晚到的漂移 OSC7 在窗口内被忽略、匹配 OSC7 解 pin、过期恢复正常接受。
// 纯决策函数用显式 nowMs 零时钟依赖；会话接线走隔离模式（spawnShell=false，feed 同步）零 sleep。
import Foundation
import Testing
@testable import MuxvoTerm

// MARK: - 纯决策函数（零时钟）

@Suite("cwdPinDecision 纯决策")
struct CwdPinDecisionTests {
    private typealias Pin = TerminalSession.InjectedCwdPin

    @Test("无 pin → accept")
    func noPinAccepts() {
        #expect(TerminalSession.cwdPinDecision(pin: nil, incomingRaw: "file://localhost/tmp/x", nowMs: 100) == .accept)
    }

    @Test("窗口内不匹配 → ignore（晚到漂移被忽略）")
    func driftInsideWindowIgnored() {
        let pin = Pin(path: "/proj", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: pin, incomingRaw: "file://localhost/Users/rl/drift", nowMs: 100) == .ignore)
    }

    @Test("窗口内匹配（file:// 前缀 + 百分号解码 + 尾斜杠 + /private 别名）→ acceptAndClearPin")
    func matchClearsPin() {
        // file://host 前缀
        let p1 = Pin(path: "/tmp/muxvo proj", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: p1, incomingRaw: "file://localhost/tmp/muxvo%20proj", nowMs: 100) == .acceptAndClearPin)
        // 尾斜杠差异
        let p2 = Pin(path: "/proj", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: p2, incomingRaw: "file://localhost/proj/", nowMs: 100) == .acceptAndClearPin)
        // macOS /tmp ↔ /private/tmp 别名（双向）
        let p3 = Pin(path: "/tmp/a", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: p3, incomingRaw: "file://localhost/private/tmp/a", nowMs: 100) == .acceptAndClearPin)
        let p4 = Pin(path: "/private/tmp/a", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: p4, incomingRaw: "file://localhost/tmp/a", nowMs: 100) == .acceptAndClearPin)
        // 裸绝对路径入站（无 file:// 前缀）
        let p5 = Pin(path: "/proj", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: p5, incomingRaw: "/proj", nowMs: 100) == .acceptAndClearPin)
    }

    @Test("nowMs == expiresAtMs 边界 → 过期接受（acceptAndClearPin）")
    func expiryBoundaryAccepts() {
        let pin = Pin(path: "/proj", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: pin, incomingRaw: "file://localhost/drift", nowMs: 5_000) == .acceptAndClearPin)
        #expect(TerminalSession.cwdPinDecision(pin: pin, incomingRaw: "file://localhost/drift", nowMs: 6_000) == .acceptAndClearPin)
    }

    @Test("入站非法（空/相对路径）不算匹配 → 窗内 ignore")
    func invalidIncomingNeverMatches() {
        let pin = Pin(path: "/proj", expiresAtMs: 5_000)
        #expect(TerminalSession.cwdPinDecision(pin: pin, incomingRaw: "", nowMs: 100) == .ignore)
        #expect(TerminalSession.cwdPinDecision(pin: pin, incomingRaw: "relative/path", nowMs: 100) == .ignore)
    }
}

// MARK: - 会话接线（隔离模式，feed 同步，零 sleep）

@Suite("cwd pin 会话接线")
struct CwdPinSessionTests {

    @Test("noteInjectedCwd 后窗口内漂移 OSC7 被忽略；匹配 OSC7 接受并解 pin；解 pin 后漂移正常生效")
    func pinLifecycleInSession() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cwdPinWindowMs = 600_000 // 永不过期（测试窗口内行为）
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        session.noteInjectedCwd("/proj")
        #expect(session.cwd == "/proj")

        // 晚到漂移 OSC7 → 忽略，header 保持注入落点
        session.feed("\u{1b}]7;file://localhost/Users/rl/drift\u{07}")
        #expect(session.cwd == "/proj")

        // 匹配 OSC7 → 接受（存原始 file:// 串，refreshCwds 归一）并解 pin
        session.feed("\u{1b}]7;file://localhost/proj\u{07}")
        #expect(session.cwd == "file://localhost/proj")

        // pin 已解除 → 后续漂移正常生效（用户真 cd 不受影响）
        session.feed("\u{1b}]7;file://localhost/Users/rl/elsewhere\u{07}")
        #expect(session.cwd.contains("/Users/rl/elsewhere"))
    }

    @Test("cwdPinWindowMs=0 → pin 立即过期，漂移 OSC7 照常生效（过期路径零 sleep）")
    func zeroWindowExpiresImmediately() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cwdPinWindowMs = 0
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        session.noteInjectedCwd("/proj")
        session.feed("\u{1b}]7;file://localhost/Users/rl/drift\u{07}")
        #expect(session.cwd.contains("/Users/rl/drift"))
    }
}
