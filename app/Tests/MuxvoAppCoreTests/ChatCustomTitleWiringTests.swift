// M5-R1 批2 C：聊天自定义标题接线（终端重命名→customTitle 正向链 + R2.5 首绑补写）+ chatOpen 路由。
//
//   · 正向链（.renameSubmit）：反查该终端已绑定 sessionId（hook 锚点填），有则写/清 titlesStore；无绑定不写。
//   · R2.5 首绑补写：先 rename（无锚点不写）后 sid 绑定（假 hook 锚点事件）→ record 检出首绑 → 补写 customName。
//   · chatOpen：ui.action → setPanelMode(.chatHistory)（Agent A 已落真路由，此处补路由测试）。
// 锚点建立走真采集链（injectHookAnchorEventForTest → waitBus → SessionTracker.record，异步 → poll）；
// 补写决策纯逻辑走 applyChatTitleBackfill 直调（免异步 flake）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
import MuxvoTerm
@testable import MuxvoAppCore

@Suite("聊天自定义标题接线（正向链 + R2.5 首绑补写 + chatOpen）", .serialized)
@MainActor
struct ChatCustomTitleWiringTests {
    private let sid = "11111111-2222-3333-4444-555555555555"

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-titlewire-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// 装配注入了 titlesStore 的 service（返回 store 供断言）。
    private func makeService(root: URL) -> (TerminalService, ChatCustomTitlesStore) {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let titles = ChatCustomTitlesStore(root: root)
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: root.path, dataRoot: root, chatTitlesStore: titles)
        return (service, titles)
    }

    /// 装配 titlesStore=nil 的 service（功能关闭 no-op 验证）。
    private func makeServiceNoStore(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: root.path, dataRoot: root)
    }

    /// 轮询主线程条件（@MainActor 内 await Task.sleep 让出主 actor，令 backfill 的 main.async hop 得以执行）。
    private func pollUntil(timeout: TimeInterval = 5, _ cond: () -> Bool) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if cond() { return }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    // MARK: - chatOpen 路由（任务 4：Agent A 已落真路由 setPanelMode(.chatHistory)，此处核验）

    @Test("chatOpen：ui.action → panelMode 翻 chatHistory + 重推带 panelMode")
    func chatOpenSwitchesToChatHistory() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        #expect(service.panelMode == .terminal)
        service.handleAction(.chatOpen)
        #expect(service.panelMode == .chatHistory)
        #expect(pushes.last?.panelMode == .chatHistory)
    }

    // MARK: - 正向链（任务 2：.renameSubmit 反查锚点 sid → titlesStore）

    @Test("rename 且有锚点：反查 sid → titlesStore 写入 customTitle")
    func renameWithAnchorWritesTitle() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, titles) = makeService(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        // 建立锚点（假 hook 事件 → 真 record）→ poll 绑定。
        service.injectHookAnchorEventForTest(termId: termId, sessionId: sid, cwd: root.path, transcript: "/t.jsonl")
        await pollUntil { service.chatAnchorsForTest[termId]?.sessionId == sid }
        #expect(service.chatAnchorsForTest[termId]?.sessionId == sid, "前置：锚点已绑定")
        // rename → 正向链写 titlesStore。
        service.handleAction(.renameSubmit(terminalId: termId, name: "我的项目"))
        #expect(titles.get(sid) == "我的项目")
    }

    @Test("rename 无锚点：sid 未绑定 → titlesStore 不写")
    func renameWithoutAnchorSkips() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, titles) = makeService(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.handleAction(.renameSubmit(terminalId: termId, name: "x"))
        #expect(titles.all().isEmpty, "无锚点 → 正向链不写（靠 R2.5 首绑补写）")
    }

    @Test("rename 空名：有锚点 → 清除 titlesStore 该 sid（与 projection 清默认对齐）")
    func renameEmptyClearsTitle() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, titles) = makeService(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.injectHookAnchorEventForTest(termId: termId, sessionId: sid, cwd: root.path, transcript: "/t.jsonl")
        await pollUntil { service.chatAnchorsForTest[termId]?.sessionId == sid }
        service.handleAction(.renameSubmit(terminalId: termId, name: "旧名"))
        #expect(titles.get(sid) == "旧名")
        // 空白名 → trim 后为空 → 清除。
        service.handleAction(.renameSubmit(terminalId: termId, name: "   "))
        #expect(titles.get(sid) == nil, "空名清除该 sid")
    }

    @Test("titlesStore=nil：rename 全链 no-op（不崩、service 存活）")
    func nilStoreRenameNoOp() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeServiceNoStore(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.handleAction(.renameSubmit(terminalId: termId, name: "x")) // 不崩
        #expect(service.panelMode == .terminal, "service 存活")
    }

    // MARK: - R2.5 首绑补写（任务 2 子项：sid 绑定时回读 customName 补写）

    @Test("R2.5 首绑补写：先 rename（无锚点不写）再假 hook 锚点事件 → record 检出首绑 → 补写 customName")
    func backfillOnFirstBindViaHookEvent() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, titles) = makeService(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        // 先 rename（此刻无锚点 → 正向链不写）。
        service.handleAction(.renameSubmit(terminalId: termId, name: "先取的名"))
        #expect(titles.all().isEmpty, "无锚点 → 尚未写入")
        // 再来 hook 锚点事件 → 首绑 → 补写钩子 → applyChatTitleBackfill 读 customName 补写。
        service.injectHookAnchorEventForTest(termId: termId, sessionId: sid, cwd: root.path, transcript: "/t.jsonl")
        await pollUntil { titles.get(sid) == "先取的名" }
        #expect(titles.get(sid) == "先取的名", "sid 绑定时回读 customName 补写")
    }

    @Test("补写直调：有 customName 且 sid 无 title → 写入 customName")
    func backfillDirectWritesCustomName() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, titles) = makeService(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.handleAction(.renameSubmit(terminalId: termId, name: "命名A")) // 设 customName（无锚点 → 正向链不写）
        #expect(titles.all().isEmpty)
        service.applyChatTitleBackfill(termId: termId, sessionId: sid)
        #expect(titles.get(sid) == "命名A")
    }

    // MARK: - 反向同步（title-sync 批：聊天卡 setTitle → 锚定终端 tile 名，chat-history.md W8 双向）

    @Test("反向改名：sid 锚定存活终端 → tile customName 跟随；title=nil → 清名")
    func reverseRenameFollowsAnchoredTerminal() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.injectHookAnchorEventForTest(termId: termId, sessionId: sid, cwd: root.path, transcript: "/t.jsonl")
        await pollUntil { service.chatAnchorsForTest[termId]?.sessionId == sid }

        service.applyChatTitleToAnchoredTerminal(sessionId: sid, title: "反向名")
        #expect(pushes.last?.terminals.first(where: { $0.id == termId })?.customName == "反向名")

        service.applyChatTitleToAnchoredTerminal(sessionId: sid, title: nil)
        #expect(pushes.last?.terminals.first(where: { $0.id == termId })?.customName == nil, "nil = 清自定义名")
    }

    @Test("反向改名多锚同 sid：取 lastActiveTs 最大者，其余不动")
    func reverseRenamePicksLatestAnchor() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        guard case let .created(t1, _) = service.handleTermCommand(.create(cwd: root.path)),
              case let .created(t2, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：两终端应创建成功"); return
        }
        defer {
            _ = service.handleTermCommand(.close(terminalId: t1))
            _ = service.handleTermCommand(.close(terminalId: t2))
        }
        // 先锚 t1，poll 绑定（≥20ms 轮询量子保证 t2 事件 ts 严格更大）再锚 t2。
        service.injectHookAnchorEventForTest(termId: t1, sessionId: sid, cwd: root.path, transcript: "/t.jsonl")
        await pollUntil { service.chatAnchorsForTest[t1]?.sessionId == sid }
        service.injectHookAnchorEventForTest(termId: t2, sessionId: sid, cwd: root.path, transcript: "/t.jsonl")
        await pollUntil { service.chatAnchorsForTest[t2]?.sessionId == sid }
        #expect((service.chatAnchorsForTest[t2]?.lastActiveTs ?? 0) > (service.chatAnchorsForTest[t1]?.lastActiveTs ?? 0),
                "前置：t2 锚点更新（ts 更大）")

        service.applyChatTitleToAnchoredTerminal(sessionId: sid, title: "给最新者")
        let terminals = pushes.last?.terminals ?? []
        #expect(terminals.first(where: { $0.id == t2 })?.customName == "给最新者", "lastActiveTs 最大者改名")
        #expect(terminals.first(where: { $0.id == t1 })?.customName == nil, "较旧锚点终端不动")
    }

    @Test("反向改名无存活终端：幽灵 termId 锚点被活体滤掉 → no-op 不崩，存活终端不误伤")
    func reverseRenameSkipsDeadTerminal() async {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        guard case let .created(live, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: live)) }
        // 幽灵锚点：termId 不在 registry（tracker record 不做活体滤，写入即在）。
        service.injectHookAnchorEventForTest(termId: "ghost-term", sessionId: sid, cwd: root.path, transcript: "/t.jsonl")
        await pollUntil { service.chatAnchorsForTest["ghost-term"]?.sessionId == sid }

        service.applyChatTitleToAnchoredTerminal(sessionId: sid, title: "不该落地")
        #expect(pushes.last?.terminals.first(where: { $0.id == live })?.customName == nil, "存活终端（未锚该 sid）不误伤")
        #expect(service.panelMode == .terminal, "no-op 不崩、service 存活")
    }

    // MARK: - 反向落点选择纯函数（对抗 MINOR-4/5：维序滤影子 + tie-break 稳定）

    @Test("落点选择：非 grid（registry 有锚但不在 projection 维序）被滤，回退落到 grid 成员")
    func pickTargetFiltersNonGridShadow() {
        let mk = { (sid: String, ts: UInt64) in
            TerminalSessionAnchor(sessionId: sid, harness: .cc, cwd: "/x", transcriptPath: "/t", lastActiveTs: ts)
        }
        // worker 终端锚点 ts 更大，但不在 gridIds → 必须回退到 grid 终端（否则 renameSubmit order guard 静默丢失）。
        let anchors = ["worker-1": mk(sid, 200), "grid-1": mk(sid, 100), "grid-other": mk("其他sid", 300)]
        #expect(TerminalService.pickReverseRenameTarget(
            anchors: anchors, sessionId: sid, gridIds: ["grid-1", "grid-other"]) == "grid-1")
        // 全部候选都非 grid → nil（只改历史记录本身）。
        #expect(TerminalService.pickReverseRenameTarget(
            anchors: anchors, sessionId: sid, gridIds: ["grid-other"]) == nil)
    }

    @Test("落点选择：lastActiveTs 相等 → termId 字典序 tie-break 稳定；ts 不等 → ts 最大者")
    func pickTargetTieBreakStable() {
        let mk = { (ts: UInt64) in
            TerminalSessionAnchor(sessionId: self.sid, harness: .cc, cwd: "/x", transcriptPath: "/t", lastActiveTs: ts)
        }
        let tie = ["term-b": mk(100), "term-a": mk(100), "term-c": mk(100)]
        for _ in 0..<8 { // Dictionary 无序快照下多次调用恒同落点
            #expect(TerminalService.pickReverseRenameTarget(
                anchors: tie, sessionId: sid, gridIds: ["term-a", "term-b", "term-c"]) == "term-c")
        }
        let mixed = ["term-z": mk(50), "term-a": mk(200)]
        #expect(TerminalService.pickReverseRenameTarget(
            anchors: mixed, sessionId: sid, gridIds: ["term-a", "term-z"]) == "term-a", "ts 主序优先于字典序")
    }

    // MARK: - MUXVO_HOOK_SOCK 注入（title-sync 批：多分身路由修复，terminal-session.md §1.2 / wait-detector.md §4）

    @Test("生产缺省 configTemplate：extraEnv 恒注入本 app hook socket 路径（与 native 监听同一派生源）")
    func defaultConfigTemplateInjectsHookSock() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let configStore = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let template = TerminalService.makeDefaultConfigTemplate(
            configModel: ConfigModel(store: configStore), dataRoot: root)
        let cfg = template()
        #expect(cfg.extraEnv[HookScript.socketEnvKey] == HookScript.socketURL(dataRoot: root).path,
                "MUXVO_HOOK_SOCK = <dataRoot>/run/hook.sock（HookScript.socketURL 单一派生源）")
    }

    @Test("补写守卫：无 customName → 不写；已有 title → 不覆盖；titlesStore=nil → no-op 不崩")
    func backfillGuards() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, titles) = makeService(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        // 无 customName（未 rename）→ 不写。
        service.applyChatTitleBackfill(termId: termId, sessionId: sid)
        #expect(titles.get(sid) == nil, "无 customName → 无可补写")
        // 已有 title → 不覆盖（rename 正向链先写的场景由 get(sid)!=nil 守住）。
        titles.set(sid, title: "existing")
        service.handleAction(.renameSubmit(terminalId: termId, name: "命名B"))
        service.applyChatTitleBackfill(termId: termId, sessionId: sid)
        #expect(titles.get(sid) == "existing", "已有 title → 补写不覆盖")
        // titlesStore=nil → 直调 no-op 不崩。
        let svcNil = makeServiceNoStore(root: root)
        svcNil.applyChatTitleBackfill(termId: "whatever", sessionId: sid)
        #expect(svcNil.panelMode == .terminal, "nil store 直调不崩、service 存活")
    }
}
