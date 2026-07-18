// M5 批3 chat 面板动作 native 半（CHAT_L1_18 裁决语义，chat-history.md §7.6/§7.7）：
//   · chatClose → 面板回 terminal（Esc/关闭钮 native 半）。
//   · chatJumpToTerminal → cwd 前缀命中聚焦已开终端 / 无命中于 cwd 新建 / cwd 缺席仅关面板；**无条件关面板**。
//   · chatResume → 于 cwd 新建终端 + customTitle 继承 + 按 source 注入 resume（CC `claude --resume`/Codex
//     `codex resume`，M5-R1 接线）+ 关面板；非法 sessionId → 纯新建不注入。注入串本身由 ResumeCommand/
//     InitialCommandInjector 单测断言，此处只验路由副作用（新建/标题/关面板）。
// 决策语义走纯函数 resolveChatJump / cwdPrefixMatches（注入假终端列表，含 worktree 子目录例、路径分量边界）；
// 路由/副作用走真 TerminalService（选中/新建/关面板 + maxReached 拒绝分支）。
// 命名纪律：本文件测试名不得像 spec ID（防 E_FORGED_ID）；suite 描述引用「CHAT_L1_18 native 半」便于批5 对账。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
import MuxvoTerm
@testable import MuxvoAppCore

@Suite("chat 面板动作 native 半（CHAT_L1_18 裁决 §7.7）", .serialized)
@MainActor
struct ChatPanelRoutingTests {

    // MARK: 装配 helper（沿 PanelModeStateTests 先例）

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-chatroute-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeService(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    /// 捕注入写的假 harness service（configTemplate 指 `cat >> capture`；`printf READY` 给静默门首输出 seen_first）。
    /// 仿 SessionRestoreIntegrationTests ④——注入器真写进 PTY 的 resume 串落 capture 文件，供派发锚断言确切 harness 形。
    private func makeCaptureService(root: URL, capture: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let template: () -> TerminalSession.Config = {
            var c = TerminalSession.Config()
            c.executablePath = "/bin/sh"
            c.argv = ["/bin/sh", "-c", "sleep 0.2; printf 'READY\\n'; cat >> '\(capture.path)'"]
            return c
        }
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: root.path, dataRoot: root, configTemplate: template)
    }

    /// 轮询文件直到含 needle 或超时（仿 SessionRestoreIntegrationTests.waitForContent）。
    private func waitForContent(_ url: URL, contains needle: String, timeout: TimeInterval) async -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let s = try? String(contentsOf: url, encoding: .utf8), s.contains(needle) { return s }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    // MARK: - 纯决策：cwdPrefixMatches（§7.7② CHAT_L1_18 前缀语义）

    @Test("cwdPrefixMatches：终端 cwd 相等 / 以 session.cwd 为前缀（含 worktree 子目录）命中")
    func cwdPrefixMatchesHitsExactAndSubdir() {
        // 相等命中。
        #expect(TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj", terminalCwd: "/a/proj"))
        // worktree 子目录：session 在项目根、终端在其 worktree 子目录 → 终端 cwd 以 session.cwd 为前缀 → 命中。
        #expect(TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj", terminalCwd: "/a/proj/worktrees/feat-x"))
        #expect(TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj", terminalCwd: "/a/proj/sub"))
    }

    @Test("cwdPrefixMatches：路径分量边界——/a/proj 不误配 /a/proj-x；反方向不命中；空 session.cwd 恒不命中")
    func cwdPrefixMatchesRespectsBoundary() {
        // 边界：/a/proj 不是 /a/proj-x 的分量前缀（无 `/` 边界）。
        #expect(!TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj", terminalCwd: "/a/proj-x"))
        // 反方向：终端在父目录、session 在子目录 → 终端 cwd 不以 session.cwd 为前缀 → 不命中（方向敏感）。
        #expect(!TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj/sub", terminalCwd: "/a/proj"))
        // 完全无关。
        #expect(!TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj", terminalCwd: "/b/other"))
        // 空 session.cwd。
        #expect(!TerminalService.cwdPrefixMatches(sessionCwd: "", terminalCwd: "/a/proj"))
    }

    @Test("cwdPrefixMatches：去尾斜杠归一（/a/proj/ ~ /a/proj）")
    func cwdPrefixMatchesNormalizesTrailingSlash() {
        #expect(TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj/", terminalCwd: "/a/proj"))
        #expect(TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj", terminalCwd: "/a/proj/"))
        #expect(TerminalService.cwdPrefixMatches(sessionCwd: "/a/proj/", terminalCwd: "/a/proj/sub/"))
    }

    // MARK: - 纯决策：resolveChatJump（注入假终端列表）

    @Test("resolveChatJump：前缀命中（含 worktree 子目录例）→ .focus(该终端)")
    func resolveChatJumpFocusesOnPrefixMatch() {
        let terminals = [
            (id: "t-other", cwd: "/repo/alpha"),
            (id: "t-worktree", cwd: "/repo/beta/worktrees/wt1"), // session /repo/beta 的 worktree 子目录
        ]
        #expect(TerminalService.resolveChatJump(sessionCwd: "/repo/beta", terminals: terminals)
            == .focus(terminalId: "t-worktree"))
    }

    @Test("resolveChatJump：无命中 → .createAt(session.cwd)；cwd 缺席/空白 → .closeOnly")
    func resolveChatJumpCreateAndCloseOnly() {
        let terminals = [(id: "t0", cwd: "/repo/alpha")]
        // 无命中 → createAt。
        #expect(TerminalService.resolveChatJump(sessionCwd: "/repo/gamma", terminals: terminals)
            == .createAt(cwd: "/repo/gamma"))
        // cwd 缺席 → closeOnly。
        #expect(TerminalService.resolveChatJump(sessionCwd: nil, terminals: terminals) == .closeOnly)
        // cwd 空白 → closeOnly。
        #expect(TerminalService.resolveChatJump(sessionCwd: "   ", terminals: terminals) == .closeOnly)
    }

    @Test("resolveChatJump：多个候选取首个命中（列表序）")
    func resolveChatJumpTakesFirstMatch() {
        let terminals = [
            (id: "first", cwd: "/repo/proj"),
            (id: "second", cwd: "/repo/proj/sub"),
        ]
        #expect(TerminalService.resolveChatJump(sessionCwd: "/repo/proj", terminals: terminals)
            == .focus(terminalId: "first"))
    }

    // MARK: - 路由/副作用：chatClose

    @Test("chatClose：面板由 chatHistory 关回 terminal（重推 panelMode==.terminal）")
    func chatCloseReturnsToTerminal() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }

        service.setPanelMode(.chatHistory)
        #expect(service.panelMode == .chatHistory)

        service.handleAction(.chatClose)
        #expect(service.panelMode == .terminal)
        #expect(pushes.last?.panelMode == .terminal)
    }

    // MARK: - 路由/副作用：chatOpen 主动 detach 单一缝（M5-R1 批4 顺修，e2e item34 抓获）

    @Test("chatOpen（tab 路径）：切入全窗面板必触发 onWillEnterFullPanel（先 detach 后翻态；回 terminal 不触发）")
    func chatOpenFiresWillEnterFullPanelBeforeFlip() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var fired = 0
        var modeAtFire: PanelMode?
        service.onWillEnterFullPanel = { fired += 1; modeAtFire = service.panelMode }

        // tab 路径（ui.action chatOpen）——批3 W1 缺陷：此路径曾漏 detach（detach 只挂菜单路径内联）。
        service.handleAction(.chatOpen)
        #expect(service.panelMode == .chatHistory)
        #expect(fired == 1)
        #expect(modeAtFire == .terminal) // 硬序①：hook 触发时尚未翻态（先 detach 后翻态）

        // 同态重复 no-op（guard 防冗余 push，也不得重复 detach）。
        service.handleAction(.chatOpen)
        #expect(fired == 1)

        // 回 terminal：web 重报 layoutReport 反应式 re-attach，不触发 detach 缝。
        service.handleAction(.chatClose)
        #expect(service.panelMode == .terminal)
        #expect(fired == 1)

        // 菜单等价路径（taskCenter 方向）同走单一缝。
        service.setPanelMode(.taskCenter)
        #expect(fired == 2)
    }

    // MARK: - 路由/副作用：chatJumpToTerminal

    @Test("chatJump 命中：cwd 前缀命中已开终端 → 聚焦（selectedId）+ 无条件关面板")
    func chatJumpFocusesMatchingTerminalAndCloses() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var toClose: [String] = []
        defer { for id in toClose { _ = service.handleTermCommand(.close(terminalId: id)) } }

        // 真 spawn 一个终端于 root（cwd 已知）。
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        toClose.append(termId)

        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        service.setPanelMode(.chatHistory)

        service.handleAction(.chatJumpToTerminal(sessionId: "sess-1", cwd: root.path))
        #expect(pushes.last?.selectedId == termId) // 聚焦命中终端
        #expect(pushes.last?.panelMode == .terminal) // 无条件关面板
        #expect(service.panelMode == .terminal)
    }

    @Test("chatJump 无命中：于 session.cwd 新建终端 + 关面板")
    func chatJumpCreatesTerminalOnNoMatch() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var toClose: [String] = []
        defer { for id in toClose { _ = service.handleTermCommand(.close(terminalId: id)) } }

        // 无既有终端 → 无命中。session.cwd = 一个真实子目录。
        let projDir = root.appendingPathComponent("proj", isDirectory: true)
        try? FileManager.default.createDirectory(at: projDir, withIntermediateDirectories: true)

        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        service.setPanelMode(.chatHistory)

        service.handleAction(.chatJumpToTerminal(sessionId: "sess-2", cwd: projDir.path))
        let terminals = pushes.last?.terminals ?? []
        #expect(terminals.count == 1) // 新建了一个
        #expect(terminals.first?.cwd == projDir.path) // 落在 session.cwd
        #expect(pushes.last?.panelMode == .terminal)
        toClose.append(contentsOf: terminals.map { $0.id })
    }

    @Test("chatJump cwd 缺席：不新建、仅关面板")
    func chatJumpWithoutCwdOnlyCloses() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        service.setPanelMode(.chatHistory)

        service.handleAction(.chatJumpToTerminal(sessionId: "sess-3", cwd: nil))
        #expect(pushes.last?.terminals.isEmpty == true) // 未新建
        #expect(pushes.last?.panelMode == .terminal) // 仅关面板
    }

    @Test("chatJump maxReached 拒绝分支：满员时新建被既有拒绝行为吞、不崩，面板仍无条件关闭")
    func chatJumpMaxReachedStillCloses() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }

        // 直接把 registry 填满到上限（spawnShell=false，快、无真进程）；projection.order 保持空。
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        while !service.registry.maxReached {
            guard case .success = service.registry.create(config: cfg) else {
                Issue.record("前置：填满 registry 应成功"); return
            }
        }
        #expect(service.registry.maxReached)

        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        service.setPanelMode(.chatHistory)

        // 无 projection 终端 → 无命中 → createAt → createTerminal 撞 maxReached → 静默跳过。
        service.handleAction(.chatJumpToTerminal(sessionId: "sess-4", cwd: root.path))
        #expect(pushes.last?.terminals.isEmpty == true) // projection 侧未新增（create 被拒）
        #expect(pushes.last?.panelMode == .terminal) // 面板仍无条件关闭
        #expect(service.panelMode == .terminal)
    }

    // MARK: - 路由/副作用：chatResume（M4b 回补：新建 + customTitle 继承 + CC 注入 resume）

    @Test("chatResume（CC）：于 session.cwd 新建终端 + customTitle 继承为标签 + 关面板（注入 resume 由注入器单测覆盖）")
    func chatResumeCreatesTerminalWithTitleAndCloses() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var toClose: [String] = []
        defer { for id in toClose { _ = service.handleTermCommand(.close(terminalId: id)) } }

        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        service.setPanelMode(.chatHistory)

        // 合法 UUID sessionId → CC 注入路径（注入串本身由 InitialCommandInjectorTests 断言；此处验副作用）。
        service.handleAction(.chatResume(
            sessionId: "11111111-2222-3333-4444-555555555555", cwd: root.path,
            source: .claudeCode, customTitle: "我的会话"))
        let terminals = pushes.last?.terminals ?? []
        #expect(terminals.count == 1)
        #expect(terminals.first?.cwd == root.path)
        #expect(terminals.first?.customName == "我的会话", "customTitle 继承为新终端标签（§7.7）")
        #expect(pushes.last?.panelMode == .terminal)
        toClose.append(contentsOf: terminals.map { $0.id })
    }

    @Test("chatResume（Codex，合法 UUID）：于 session.cwd 新建终端 + 关面板（M5-R1 接线 `codex resume`；注入串由单测覆盖）")
    func chatResumeCodexInjects() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var toClose: [String] = []
        defer { for id in toClose { _ = service.handleTermCommand(.close(terminalId: id)) } }

        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        service.setPanelMode(.chatHistory)

        // 合法 UUID sessionId → Codex 注入路径（`codex resume <sid>`，harness=.codex；串本身由
        // ResumeCommand/InitialCommandInjector 单测断言，此处验副作用：新建 + 关面板不崩）。
        service.handleAction(.chatResume(
            sessionId: "11111111-2222-3333-4444-555555555555", cwd: root.path,
            source: .codex, customTitle: nil))
        let terminals = pushes.last?.terminals ?? []
        #expect(terminals.count == 1 && terminals.first?.cwd == root.path)
        #expect(pushes.last?.panelMode == .terminal)
        toClose.append(contentsOf: terminals.map { $0.id })
    }

    @Test("chatResume（非法 sessionId）：任一 source 纯新建不注入 + 关面板（纵深防线）")
    func chatResumeBadSessionIdDegrades() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var toClose: [String] = []
        defer { for id in toClose { _ = service.handleTermCommand(.close(terminalId: id)) } }

        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        service.setPanelMode(.chatHistory)

        // 非 UUID sessionId（含前导 - 的旧式）→ 不进注入分支（纯新建）；不崩、面板无条件关闭。
        service.handleAction(.chatResume(
            sessionId: "-rf; rm", cwd: root.path, source: .codex, customTitle: nil))
        let terminals = pushes.last?.terminals ?? []
        #expect(terminals.count == 1 && terminals.first?.cwd == root.path)
        #expect(pushes.last?.panelMode == .terminal)
        toClose.append(contentsOf: terminals.map { $0.id })
    }

    // MARK: - 派发锚（m-4 对抗回修）：source→harness 经真 PTY 写探针断言确切命令形（防 .codex↔.claude 手滑）

    @Test("chatResume 派发锚（Codex）：source=codex → 注入器真写 PTY 的串含 `codex resume <sid>`（防 .codex→.claude 手滑）")
    func chatResumeCodexDispatchesCodexResumeToPTY() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        let sid = "11111111-2222-3333-4444-555555555555"
        // 合法 UUID + source=codex → handleChatResume 派 harness=.codex → 注入器写 `codex resume <sid>` 进 PTY。
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .codex, customTitle: nil))
        let content = await waitForContent(capture, contains: "codex resume \(sid)", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && codex resume \(sid)"),
                "source=codex 派 harness=.codex → PTY 收 `codex resume <sid>`；capture=\(content.debugDescription)")
        #expect(!content.contains("claude --resume"),
                "codex 派发绝不写 claude --resume（若 :826 .codex 手滑成 .claude 此锚立红）")
    }

    @Test("chatResume 派发锚（CC）：source=claudeCode → 注入器真写 PTY 的串含 `claude --resume <sid>`（--resume 后无 --；反向锚）")
    func chatResumeCCDispatchesClaudeResumeToPTY() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        let sid = "11111111-2222-3333-4444-555555555555"
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .claudeCode, customTitle: nil))
        let content = await waitForContent(capture, contains: "claude --resume \(sid)", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && claude --resume \(sid)"),
                "source=claudeCode 派 harness=.claude → PTY 收 `claude --resume <sid>`（--resume 无 --）；capture=\(content.debugDescription)")
        #expect(!content.contains("codex resume"), "CC 派发绝不写 codex resume（反向手滑锚）")
        #expect(!content.contains("--resume -- "), "绝不回退 `--resume -- <sid>`（M5-R1 真机回归形）")
    }

    @Test("尺寸就绪门装配红绿锚（登记⑩，对抗回修 MINOR-2）：resize 未达扣住不注入 → 投递 resize 才落地且缝 sizeReady=true")
    func chatResumeSizeGateHoldsUntilFirstResize() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let capture = root.appendingPathComponent("capture.txt")
        let service = makeCaptureService(root: root, capture: capture)
        defer { service.stop() }
        let sid = "11111111-2222-3333-4444-555555555555"
        service.handleAction(.chatResume(sessionId: sid, cwd: root.path, source: .claudeCode, customTitle: nil))
        // 负半（红锚）：无 surface → 会话从未 resize → 尺寸门扣住。静默门本身 ~600ms-1s 即可注入，
        // 观察 2s 无写入——若调用点漏传 sizeReady（装配断点），注入 ~1s 落地、此断言立红。
        let held = await waitForContent(capture, contains: "claude --resume", timeout: 2)
        #expect(!held.contains("claude --resume"),
                "resize 未达时注入必须被尺寸就绪门扣住（登记⑩）；capture=\(held.debugDescription)")
        // 正半（绿锚）：投递首个外部 resize（公共 API 直调，= 生产 commitGrid 同一收口）→ 门放行 →
        // 注入落地 + 观测缝记录就绪态与门放行时刻的网格。
        guard let session = service.registry.allSessions().first else {
            Issue.record("capture 会话缺失"); return
        }
        #expect(session.resize(cols: 100, rows: 30))
        let content = await waitForContent(capture, contains: "claude --resume \(sid)", timeout: 20)
        #expect(content.contains("cd -- '\(root.path)' && claude --resume \(sid)"),
                "resize 后注入应落地；capture=\(content.debugDescription)")
        let obs = service.lastResumeInjectionForTest
        #expect(obs?.sizeReady == true && obs?.cols == 100 && obs?.rows == 30,
                "观测缝应记录 sizeReady=true 且 cols=放行时网格（实际 \(String(describing: obs))）")
    }
}
