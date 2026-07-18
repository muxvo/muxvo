// dogfood-r2#4 根因 B：`term.command create{cwd}` 显式目录钉住注入（enqueueCwdPinInjection）service 级
// 闭环。login shell 的 `.zshrc` 无条件 cd 会把 PTY spawn cwd 漂走——显式 cwd 建成后经静默门补写
// `cd -- '<cwd>' && clear`（worktree-popover.md §4 契约改写；legacy 800ms 盲延时的静默门版）。
// 用捕注入假 harness（同 ChatResumeGateTests）：注入器真写 PTY 的串落 capture 文件——负锚（cwd=nil）
// 断言 capture 无 cd 串（诚实的「未注入」证据，非结构性断言）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
@testable import MuxvoAppCore

@Suite("create{cwd} 钉住注入（dogfood-r2#4）", .serialized, .timeLimit(.minutes(2)))
@MainActor
struct CwdPinInjectionTests {
    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-cwdpin-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// 捕注入假 harness service（printf READY 给静默门首输出；cat 把注入器写进 PTY 的串落 capture）。
    /// defaultTerminalCwd 非 nil → 预写 config（settings-dogfood 批：默认路径 pin 场景）。
    private func makeCaptureService(root: URL, capture: URL, defaultTerminalCwd: String? = nil) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        if let defaultTerminalCwd {
            try? store.save(MuxvoConfig(defaultTerminalCwd: defaultTerminalCwd))
        }
        let template: () -> TerminalSession.Config = {
            var c = TerminalSession.Config()
            c.executablePath = "/bin/sh"
            c.argv = ["/bin/sh", "-c", "sleep 0.2; printf 'READY\\n'; cat >> '\(capture.path)'"]
            c.cwdPinWindowMs = 600_000 // pin 永不过期：断言窗口内语义，免 CI 慢机误过期
            return c
        }
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: root.path, dataRoot: root, configTemplate: template)
    }

    private func waitForContent(_ url: URL, contains needle: String, timeout: TimeInterval) async -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let s = try? String(contentsOf: url, encoding: .utf8), s.contains(needle) { return s }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    @Test("create{cwd} → 静默门注入 `cd -- '<cwd>' && clear` 送达 PTY")
    func createWithCwdInjectsCdPin() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        let resp = service.handleTermCommand(.create(cwd: root.path))
        guard case .created = resp else {
            Issue.record("create{cwd} 应建成终端，实得 \(resp)"); return
        }
        let content = await waitForContent(capture, contains: "&& clear", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && clear"),
                "显式 cwd 建成后须注入 cd 钉住串；capture=\(content.debugDescription)")
    }

    @Test("create{cwd:nil} 且默认路径**未设**（FAB/菜单形）→ 零注入（回归锚：保 .zshrc cd 习惯）")
    func createWithoutCwdSkipsInjection() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        let resp = service.handleTermCommand(.create(cwd: nil))
        guard case .created = resp else {
            Issue.record("create 应建成终端，实得 \(resp)"); return
        }
        // 静默门最坏注入窗（首输出 ~0.2s + 静默 0.5s）过后确认 PTY 无 cd 串。
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        let content = (try? String(contentsOf: capture, encoding: .utf8)) ?? ""
        #expect(!content.contains("cd -- "), "cwd=nil 不得注入；capture=\(content.debugDescription)")
    }

    @Test("create{cwd:nil} + 默认路径已设有效 → 同挂 cd 钉住注入（WT_PIN_default_cwd，修前必红）")
    func createNilCwdWithDefaultPathInjectsPin() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let defaultDir = root.appendingPathComponent("desk", isDirectory: true).path
        try? FileManager.default.createDirectory(atPath: defaultDir, withIntermediateDirectories: true)
        let service = makeCaptureService(root: root, capture: capture, defaultTerminalCwd: defaultDir)
        defer { service.stop() }
        let resp = service.handleTermCommand(.create(cwd: nil))
        guard case .created = resp else {
            Issue.record("create 应建成终端，实得 \(resp)"); return
        }
        let content = await waitForContent(capture, contains: "&& clear", timeout: 20)
        #expect(content.contains("cd -- '\(defaultDir)' && clear"),
                "默认路径已设：cwd:nil 新建须注入解析值 pin（与 projection 落点同函数）；capture=\(content.debugDescription)")
    }

    @Test("create{cwd:nil} + 默认路径失效目录 → 零注入（WT_PIN_default_invalid_no_pin：失效视同未设）")
    func createNilCwdWithInvalidDefaultPathSkipsInjection() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(
            root: root, capture: capture,
            defaultTerminalCwd: root.appendingPathComponent("gone-\(UUID().uuidString)").path)
        defer { service.stop() }
        let resp = service.handleTermCommand(.create(cwd: nil))
        guard case .created = resp else {
            Issue.record("create 应建成终端，实得 \(resp)"); return
        }
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        let content = (try? String(contentsOf: capture, encoding: .utf8)) ?? ""
        #expect(!content.contains("cd -- "),
                "失效默认路径不得 pin（homePath 兜底属落点半，不 pin）；capture=\(content.debugDescription)")
    }

    @Test("首窗空存档 fallback + 默认路径已设 → 同挂 pin（settings-dogfood 对抗 MINOR-1 回修，修前必红）")
    func startupFallbackWithDefaultPathInjectsPin() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let defaultDir = root.appendingPathComponent("desk", isDirectory: true).path
        try? FileManager.default.createDirectory(atPath: defaultDir, withIntermediateDirectories: true)
        let service = makeCaptureService(root: root, capture: capture, defaultTerminalCwd: defaultDir)
        defer { service.stop() }
        let ids = service.createStartupTerminals(count: 1)   // 空存档 → fallback 直建（不经 createTerminalUnified）
        guard !ids.isEmpty else { Issue.record("fallback 应建成终端"); return }
        let content = await waitForContent(capture, contains: "&& clear", timeout: 20)
        #expect(content.contains("cd -- '\(defaultDir)' && clear"),
                "空存档 fallback 与 FAB/新窗播种同语义，须同挂默认路径 pin；capture=\(content.debugDescription)")
    }

    @Test("chatJump 无命中新建（对抗回修 MAJOR-1）→ 同挂 cd 钉住注入送达 PTY")
    func chatJumpCreateAtInjectsCdPin() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        // 无现存终端 → resolveChatJump 必落 .createAt(root.path)。
        service.handleAction(.chatJumpToTerminal(sessionId: "s-any", cwd: root.path))
        let content = await waitForContent(capture, contains: "&& clear", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && clear"),
                "chatJump 显式 cwd 新建须同挂钉住注入（spec §4「一切显式 cwd 的 create」）；capture=\(content.debugDescription)")
    }

    @Test("F-B 同缝：注入 cd 写权威 cwd → refreshCwds 不被 OSC7 漂移 clobber，header=目标 cwd")
    func pinnedCwdConvergesOverOsc7Drift() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        let resp = service.handleTermCommand(.create(cwd: root.path))
        guard case let .created(termId, _) = resp,
              let session = service.registry.session(for: SessionID(raw: termId)) else {
            Issue.record("create{cwd} 应建成终端，实得 \(resp)"); return
        }
        #expect(service.cwdsForTest[termId] == root.path, "前置：新终端 cwd = 目标（createTerminal 落点）")
        // 立即喂 OSC7 漂移串（`.zshrc` 的 cd 场景）：feed 刷活动戳把注入推迟 ~0.5s，漂移先落 session._cwd。
        session.feed("\u{1b}]7;file://localhost/tmp/muxvo-cwdpin-drift\u{07}")
        // 等注入送达 PTY（capture 落串 = 注入器已写 payload；其后 noteInjectedCwd 已在同 Task 内执行）。
        let content = await waitForContent(capture, contains: "&& clear", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && clear"),
                "前置：注入应送达 PTY；capture=\(content.debugDescription)")
        // 驱一次 cwd 轮询：修复语义 = session._cwd 已被注入落点权威覆写，回读恰等 cwds[id] 不 clobber。
        service.refreshCwdsForTest()
        #expect(service.cwdsForTest[termId] == root.path,
                "注入 cd 写权威 cwd：header 收敛为目标 cwd，不被 OSC7 漂移钉死（实得 \(service.cwdsForTest[termId] ?? "nil")）")
    }

    @Test("pin 窗口（dogfood-r3 问题2，修前必红）：注入成功后漂移 OSC7 **晚到** → header 保持目标 cwd")
    func pinnedCwdSurvivesLateOsc7Drift() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        let resp = service.handleTermCommand(.create(cwd: root.path))
        guard case let .created(termId, _) = resp,
              let session = service.registry.session(for: SessionID(raw: termId)) else {
            Issue.record("create{cwd} 应建成终端，实得 \(resp)"); return
        }
        // 等注入送达 PTY 后再轮询 session.cwd（capture 落串 ≠ noteInjectedCwd 已执行——同 Task 内
        // write 之后才调，轮询权威 cwd 消除微竞态）。
        _ = await waitForContent(capture, contains: "&& clear", timeout: 20)
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline, session.cwd != root.path {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        #expect(session.cwd == root.path, "前置：注入落点已写权威 cwd（实得 \(session.cwd)）")
        // 晚到漂移 OSC7（异步 prompt 插件 / 在飞字节场景）→ pin 窗口内忽略，不覆写权威 cwd。
        session.feed("\u{1b}]7;file://localhost/tmp/muxvo-cwdpin-late-drift\u{07}")
        service.refreshCwdsForTest()
        #expect(service.cwdsForTest[termId] == root.path,
                "pin 窗口：晚到漂移 OSC7 不得覆写注入落点（实得 \(service.cwdsForTest[termId] ?? "nil")）")
    }
}
