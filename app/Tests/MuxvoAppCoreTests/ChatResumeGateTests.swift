// M5-R1 批2 C：chatResume 归档回填闸（enqueueChatResumeInjection 仅 .claude harness 注入前问
// ensureResumable）。block → 跳过注入（终端纯 shell）+ hop main 回调 feedback；proceed/nil → 照常注入；
// .codex 无归档回填、不过闸恒注入。
// 用捕注入假 harness（同 ChatPanelRoutingTests/SessionRestoreIntegration）：注入器真写 PTY 的 resume 串
// 落 capture 文件——block 分支断言 capture 无 resume 串（诚实的「未注入」证据，非结构性断言）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
@testable import MuxvoAppCore

@Suite("chatResume 归档回填闸（仅 .claude 过闸）", .serialized, .timeLimit(.minutes(2)))
@MainActor
struct ChatResumeGateTests {
    private let sid = "11111111-2222-3333-4444-555555555555"

    /// 反馈录制器（@unchecked Sendable：feedback 回调经 main.async 触发）。
    private final class FeedbackRecorder: @unchecked Sendable {
        private let lock = NSLock()
        private var events: [(String, String)] = []
        func record(_ sid: String, _ code: String) { lock.withLock { events.append((sid, code)) } }
        var all: [(String, String)] { lock.withLock { events } }
    }

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-resumegate-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// 捕注入假 harness service（printf READY 给静默门首输出；cat 把注入器写进 PTY 的 resume 串落 capture）。
    private func makeCaptureService(
        root: URL, capture: URL,
        ensureResumable: (@Sendable (String) -> ChatResumeGateVerdict)? = nil,
        onChatResumeFeedback: (@Sendable (String, String) -> Void)? = nil
    ) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let template: () -> TerminalSession.Config = {
            var c = TerminalSession.Config()
            c.executablePath = "/bin/sh"
            c.argv = ["/bin/sh", "-c", "sleep 0.2; printf 'READY\\n'; cat >> '\(capture.path)'"]
            c.cwdPinWindowMs = 600_000 // pin 永不过期：断言窗口内语义，免 CI 慢机误过期
            return c
        }
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: root.path, dataRoot: root, configTemplate: template,
            ensureResumable: ensureResumable, onChatResumeFeedback: onChatResumeFeedback)
    }

    private func waitForContent(_ url: URL, contains needle: String, timeout: TimeInterval) async -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let s = try? String(contentsOf: url, encoding: .utf8), s.contains(needle) { return s }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    private func pollUntil(timeout: TimeInterval = 5, _ cond: () -> Bool) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if cond() { return }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    // MARK: - block → 跳过注入 + feedback

    @Test("CC block：跳过注入（PTY 无 claude --resume）+ feedback 收到 (sid, code)")
    func ccBlockSkipsInjectionAndFeedbacks() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let fb = FeedbackRecorder()
        let service = makeCaptureService(
            root: root, capture: capture,
            ensureResumable: { _ in .block(code: "ARCHIVE_MISSING") },
            onChatResumeFeedback: { fb.record($0, $1) })
        defer { service.stop() }
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .claudeCode, customTitle: nil))
        // feedback 到达（hop main 异步）。
        await pollUntil { fb.all.contains(where: { $0.0 == sid && $0.1 == "ARCHIVE_MISSING" }) }
        #expect(fb.all.contains(where: { $0.0 == sid && $0.1 == "ARCHIVE_MISSING" }), "block → feedback(sid, code)")
        // 给注入器最坏窗口后确认 PTY 无 resume 串（纯 shell）。
        try? await Task.sleep(nanoseconds: 600_000_000)
        let content = (try? String(contentsOf: capture, encoding: .utf8)) ?? ""
        #expect(!content.contains("claude --resume"), "block → 跳过注入，PTY 无 resume 串；capture=\(content.debugDescription)")
    }

    // MARK: - proceed / nil → 照常注入

    @Test("CC proceed：照常注入 claude --resume 送达 PTY")
    func ccProceedInjects() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(
            root: root, capture: capture, ensureResumable: { _ in .proceed })
        defer { service.stop() }
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .claudeCode, customTitle: nil))
        let content = await waitForContent(capture, contains: "claude --resume \(sid)", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && claude --resume \(sid)"),
                "proceed → 照常注入；capture=\(content.debugDescription)")
    }

    @Test("nil 闸（回归锚）：ensureResumable=nil → 照常注入（零行为变化）")
    func nilGateInjects() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture) // ensureResumable = nil
        defer { service.stop() }
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .claudeCode, customTitle: nil))
        let content = await waitForContent(capture, contains: "claude --resume \(sid)", timeout: 20)
        #expect(content.contains("claude --resume \(sid)"), "nil 闸 → 恒 proceed 照常注入；capture=\(content.debugDescription)")
    }

    // MARK: - codex 不过闸

    @Test("Codex 不过闸：即便 gate=block，codex resume 仍照常注入 + 无 feedback")
    func codexBypassesGate() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let fb = FeedbackRecorder()
        let service = makeCaptureService(
            root: root, capture: capture,
            ensureResumable: { _ in .block(code: "X") }, // 若 codex 错过闸此锚立红
            onChatResumeFeedback: { fb.record($0, $1) })
        defer { service.stop() }
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .codex, customTitle: nil))
        let content = await waitForContent(capture, contains: "codex resume \(sid)", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && codex resume \(sid)"),
                "codex 无归档回填 → 不过闸恒注入；capture=\(content.debugDescription)")
        #expect(fb.all.isEmpty, "codex 不触发 gate → 无 feedback")
    }

    // MARK: - F-B：注入 cd 写权威 cwd → 收敛 OSC7 漂移（header 路径不被 `.zshrc` cd 钉死）

    @Test("resumeCwd 收敛 OSC7 漂移：注入 cd 后 refreshCwds 不被漂移 clobber，header=目标 cwd")
    func resumeCwdConvergesOverOsc7Drift() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture, ensureResumable: { _ in .proceed })
        defer { service.stop() }
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .claudeCode, customTitle: nil))
        // createTerminal 同步推快照 → 立即可取 termId + 会话（cwds[id] 此刻 = 目标 cwd）。
        guard let termId = service.cwdsForTest.keys.first,
              let session = service.registry.session(for: SessionID(raw: termId)) else {
            Issue.record("chatResume 应同步新建一个终端"); return
        }
        #expect(service.cwdsForTest[termId] == root.path, "前置：新终端 cwd = 目标（createTerminal 落点）")
        // 立即喂 OSC7 漂移串（`.zshrc` 的 cd 场景）：feed 刷活动戳把注入推迟 ~0.5s，漂移先落 session._cwd。
        // 格式对齐 MuxvoTermTests 既有 OSC7 用例（`file://localhost/...` ghostty 接住，_cwd 存原始 file:// 串）。
        session.feed("\u{1b}]7;file://localhost/tmp/muxvo-fb-drift\u{07}")
        // 等注入送达 PTY（capture 落 resume 串 = 注入器已写 payload；其后 noteInjectedCwd 已在同 Task 内执行）。
        let content = await waitForContent(capture, contains: "claude --resume \(sid)", timeout: 20)
        #expect(content.contains("claude --resume \(sid)"), "前置：注入应送达 PTY；capture=\(content.debugDescription)")
        // 驱一次 cwd 轮询（生产 ~1s 心跳走 refreshCwds，读 session.cwd 回灌 cwds[id]）：
        // 修复后 session._cwd = 注入 cd 落点（权威），回读恰等 cwds[id] → 不 clobber；未修则被漂移钉死。
        service.refreshCwdsForTest()
        #expect(service.cwdsForTest[termId] == root.path,
                "注入 cd 写权威 cwd：header 收敛为目标 cwd，不被 OSC7 漂移钉死（实得 \(service.cwdsForTest[termId] ?? "nil")）")
    }

    @Test("pin 窗口（dogfood-r3 问题2，修前必红）：resume 注入成功后漂移 OSC7 **晚到** → header 保持目标 cwd")
    func resumeCwdSurvivesLateOsc7Drift() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture, ensureResumable: { _ in .proceed })
        defer { service.stop() }
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .claudeCode, customTitle: nil))
        guard let termId = service.cwdsForTest.keys.first,
              let session = service.registry.session(for: SessionID(raw: termId)) else {
            Issue.record("chatResume 应同步新建一个终端"); return
        }
        // 等注入送达 PTY 后再轮询 session.cwd（capture 落串 ≠ noteInjectedCwd 已执行，消除微竞态）。
        let content = await waitForContent(capture, contains: "claude --resume \(sid)", timeout: 20)
        #expect(content.contains("claude --resume \(sid)"), "前置：注入应送达 PTY；capture=\(content.debugDescription)")
        await pollUntil { session.cwd == root.path }
        #expect(session.cwd == root.path, "前置：注入落点已写权威 cwd（实得 \(session.cwd)）")
        // 晚到漂移 OSC7（`.zshrc` 在飞字节 / p10k 类异步 prompt 门后重绘场景）→ pin 窗口内忽略。
        session.feed("\u{1b}]7;file://localhost/tmp/muxvo-fb-late-drift\u{07}")
        service.refreshCwdsForTest()
        #expect(service.cwdsForTest[termId] == root.path,
                "pin 窗口：晚到漂移 OSC7 不得覆写注入落点（实得 \(service.cwdsForTest[termId] ?? "nil")）")
    }
}
