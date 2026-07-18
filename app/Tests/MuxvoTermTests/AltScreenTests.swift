// alt-screen 边沿检测 + 投影（message-editor.md §1/§8）：会话层 feed 后读 vt ACTIVE_SCREEN 翻转即回调；
// UIStateProjection.noteAltScreen 落入 terminals[].altScreen 供 ui.state 推给 web 切 RichEditor/RawTerminal。
//
// 命名纪律：alt-screen 无 legacy spec ID → 测试名一律非 spec-ID 形状（防 E_FORGED_ID）。
import Darwin
import Foundation
import Testing
import MuxvoKit
import MuxvoTermCore
@testable import MuxvoTerm

/// 线程安全布尔序列记录（onAltScreenChanged 在会话 queue 触发；feed 为 queue.sync 故回调随 feed 返回而完成）。
private final class AltEdgeRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _values: [Bool] = []
    func record(_ v: Bool) { lock.lock(); _values.append(v); lock.unlock() }
    var values: [Bool] { lock.lock(); defer { lock.unlock() }; return _values }
}

private func tmpDir() -> String { FileManager.default.temporaryDirectory.path }

@Suite("alt-screen 边沿检测与投影（message-editor §1）")
struct AltScreenDetectTests {

    @Test("alt_screen_edge: feed \\x1b[?1049h/l 翻转触发回调，同屏无边沿不重复触发")
    func feedEdgeTriggersCallback() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false // 隔离模式：直灌 vt，无需真 PTY
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        let rec = AltEdgeRecorder()
        session.onAltScreenChanged = { [rec] isAlt in rec.record(isAlt) }

        session.feed("plain text")          // primary，无边沿 → 无回调
        #expect(rec.values == [])

        session.feed("\u{1b}[?1049h")        // 进 alternate → true
        #expect(rec.values == [true])

        session.feed("still in alt")         // 仍 alternate，无边沿 → 不重复
        #expect(rec.values == [true])

        session.feed("\u{1b}[?1049l")        // 退回 primary → false
        #expect(rec.values == [true, false])
    }

    @Test("alt_screen_projection: noteAltScreen 边沿落 terminals[].altScreen，幂等无重复")
    func projectionNoteAltScreen() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        var cfg = TerminalSession.Config()
        cfg.executablePath = "/bin/cat" // 确定性 pid>0（不 feed，仅测投影字段）
        cfg.argv = ["cat"]
        let projection = UIStateProjection(registry: registry, homePath: tmpDir(), configTemplate: { cfg })

        guard case let .created(termId, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let sid = SessionID(raw: termId)
        func altOf(_ id: String) -> Bool? { projection.snapshot().terminals.first { $0.id == id }?.altScreen }

        #expect(altOf(termId) == false)      // 缺省 primary
        projection.noteAltScreen(sid, true)
        #expect(altOf(termId) == true)
        projection.noteAltScreen(sid, false)
        #expect(altOf(termId) == false)
    }
}
