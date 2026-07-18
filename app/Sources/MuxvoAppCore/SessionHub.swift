// SessionHub：全局单件（批C/D C2「共享层抽取」，multi-window.md §2.3）。
//
// TerminalService（原 ~1300 行）纵向劈开：**全局件**（跨窗唯一 / 单写者 / 设备级偏好）收进本类，
// **窗内件**（UIStateProjection / searchBar / filePanel / panelMode / quitConfirm / mapSnapshot / persist）
// 留在每窗一份的瘦身 TerminalService。C2 出口 = 仍只开 1 窗、外部行为逐位一致（单窗零回归四闸）。
//
// 全局件清单（§2.3）：SessionRegistry / WaitEventBus·WaitDetectorHub·HookSocketListener /
// WorkerSilenceMonitor / SessionTracker·TerminalActiveSessionsStore·ownershipBox·injectionThrottle /
// 恢复层规划（planRestore）/ GitStatusCache / DockBadge 聚合 / 心跳泵 / 全局字号·panelZoom 广播 /
// chat 注入配置（chatTitlesStore/ensureResumable/onChatResumeFeedback）。
//
// fan-out 设计（§1/§2）：凡「需要落到拥有 termId 的那个窗」的操作（registry 状态变化 / wait 结论 /
// git 值变重推 / chatTitle 补写 / 字号广播）经 `SessionHubWindow` 成员协议逐窗转发，各窗投影用
// order.contains 守卫天然丢外来 id。**C2 单窗 = 单成员，fan-out 退化为直调，行为逐位一致。**
//
// 并发：@MainActor（同 TerminalService）。registry 观察者 / waitHub 结论 / chatTitleBackfill 在后台
// 队列触发 → hop main 后落成员。心跳在 main。
import AppKit
import Foundation
import MuxvoBridge
import MuxvoChatHistory
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
import MuxvoTermCore

/// 每窗成员接口（批C C2 §2.3）：hub 的心跳/registry/wait 族/字号广播经此 fan-out 到各窗瘦身
/// TerminalService。TerminalService 实现本协议、init 末 `hub.registerWindow(self)` 登记（弱引用）。
@MainActor
public protocol SessionHubWindow: AnyObject {
    /// 心跳每 tick（50ms）：本窗投影去抖 flush。
    func hubFlushProjection()
    /// 心跳每 ~1s（20 tick）：本窗投影 cwd 轮询刷新。
    func hubRefreshCwds()
    /// 心跳每 ~1s：本窗收起终端末行摘要采样（term-grid.md §11）。
    func hubSampleMinimizedLastLines()
    /// 心跳每 ~1s：本窗后台尺寸门（term-grid.md §11.4，防 80×24 注入烧写）。
    func hubEnsureBackgroundSized()
    /// 本窗活体终端 id（projection.liveTerminalIds）——hub 聚合全窗喂 pollWaitDetector。
    var hubLiveTerminalIds: [String] { get }
    /// registry 去抖状态变化 → 本窗投影（非本窗成员 id 由 order.contains 守卫天然丢）。
    func hubNoteRegistryStateChange(_ id: SessionID, _ state: MuxvoTermCore.TerminalState)
    /// wait 合成结论 → 本窗投影红点/浮卡。
    func hubNoteWaiting(_ id: SessionID, _ source: WaitSource?)
    /// git 门控值变 / panelZoom 变 → 本窗重推 ui.state（deliver(projection.snapshot())）。
    func hubRedeliver()
    /// R2.5 首绑补写 → 本窗（无该 termId 的成员内部 no-op）。
    func hubApplyChatTitleBackfill(termId: String, sessionId: String)
    /// 全局字号广播：本窗投影步进字号 + 渲染层广播，返回新字号（hub 据此单值持久化）。
    func hubStepFontZoom(_ dir: UIStateProjection.ZoomDirection) -> Int
}

@MainActor
public final class SessionHub {
    // MARK: 全局子系统

    /// 会话注册表（全局唯一，§2.1）：所有窗共享；SurfaceProvider/OrchAssembly 经 TerminalService.registry 取同一实例。
    public let registry: SessionRegistry
    /// git 门控字段缓存（全局；跨窗同一 cwd 命中同缓存）。
    public let gitStatusCache: GitStatusCache
    /// config.json 单写者中枢：TerminalService 结构性写回（openTerminals/gridLayout/zoom fontSize）+
    /// config.request 偏好处理器共享同一实例。
    public let configModel: ConfigModel
    let homePath: String
    let dataRoot: URL
    private let ptyChildrenStore: PtyChildrenStore
    /// Dock 徽标控制器（全局单 Dock）：deliver 聚合 Σ 各窗 waitingCount 喂之（§5.3）。
    private let dockBadge: DockBadgeController

    // WaitDetector 子系统（wait-detector.md §3/§4/§6，全局）。
    let waitBus: WaitEventBus
    /// IUO：onConclusion 捕获 [weak self]，init 末赋值——始终非 nil。
    private(set) var waitDetectorHub: WaitDetectorHub!
    private var hookListener: HookSocketListener?
    private let workerSilenceMonitor: WorkerSilenceMonitor

    // M4b 终端会话恢复（terminal-session-restore.md ④，全局单写者/单并发闸）。
    let activeSessionsStore: TerminalActiveSessionsStore
    let sessionTracker: SessionTracker
    /// Codex 锚点采集（§1.5，P-2 fast-follow r3）：无 hook → 前台探针 + rollout 定向匹配。IUO：init 末赋值。
    private(set) var codexTracker: CodexAnchorTracker!
    /// 每 tick 统一前台探针快照（§1.5：WaitDetectorHub 静默门控与 codexTracker 共享同一次 pgrep/ps，净 exec 持平）。
    private let foregroundSnapshotBox = ForegroundSnapshotBox()
    private let ownershipBox: TakeoverOwnershipBox
    /// resume 全局并发闸（跨窗共享 M 上限）。
    let injectionThrottle: InjectionThrottle
    private let restoreBanner: SessionRestoreBanner
    private let claudeContainerPath: String
    /// Codex rollout 容器（§1.5 恢复预检 + 采集 listCandidates 根）：`~/.codex/sessions`（或隔离）。
    private let codexSessionsPath: String
    /// 恢复/续聊注入取证日志（各窗 enqueue* Task 落地写；全局单文件）。
    let restoreAuditURL: URL
    private let restoreBannerLogURL: URL

    // chat 注入配置（全局；chat-history.md §7.7）。
    let chatTitlesStore: ChatCustomTitlesStore?
    /// worktree 自定义名（worktree-popover.md §5）：renameSubmit 正向写，statusSync join 读（AppDelegate
    /// 把同一实例注入 InteractiveWorktreeService）。
    let worktreeNamesStore: WorktreeNamesStore?
    let ensureResumable: (@Sendable (_ sessionId: String) -> ChatResumeGateVerdict)?
    let onChatResumeFeedback: (@Sendable (_ sessionId: String, _ code: String) -> Void)?
    private let chatTitleBackfill = ChatTitleBackfillHook()

    // 全局偏好态（§5.1）。
    private var lastAppliedTerminalThemeName: String
    /// 面板缩放（dogfood-r3 问题5，§5.1 全局单值）：⌘⇧+/-/0 一窗改全窗同步。
    public private(set) var panelZoom: Double

    /// 会话 spawn 模板 test-seam（M4b 集成测；nil = 生产模板）。
    private let configTemplateOverride: (() -> TerminalSession.Config)?

    // 心跳泵（全局单泵；tick 驱逐窗投影 + 聚合 pollWaitDetector）。
    private var heartbeat: Timer?
    private var heartbeatTick: UInt64 = 0
    private var heartbeatStarted = false

    // 成员（弱引用；C2 恒 1 项）+ 各窗 waitingCount（Dock Σ 聚合）。
    private struct WeakMember { weak var value: (any SessionHubWindow)? }
    private var members: [WeakMember] = []
    private var windowWaitingCounts: [ObjectIdentifier: Int] = [:]

    public init(
        configModel: ConfigModel, ptyChildrenStore: PtyChildrenStore, homePath: String, dataRoot: URL,
        gitStatusCache: GitStatusCache = GitStatusCache(),
        configTemplate: (() -> TerminalSession.Config)? = nil,
        claudeContainer: String? = nil,
        codexContainer: String? = nil,
        chatTitlesStore: ChatCustomTitlesStore? = nil,
        worktreeNamesStore: WorktreeNamesStore? = nil,
        ensureResumable: (@Sendable (_ sessionId: String) -> ChatResumeGateVerdict)? = nil,
        onChatResumeFeedback: (@Sendable (_ sessionId: String, _ code: String) -> Void)? = nil
    ) {
        self.configModel = configModel
        self.ptyChildrenStore = ptyChildrenStore
        self.homePath = homePath
        self.dataRoot = dataRoot
        self.gitStatusCache = gitStatusCache
        self.chatTitlesStore = chatTitlesStore
        self.worktreeNamesStore = worktreeNamesStore
        self.ensureResumable = ensureResumable
        self.onChatResumeFeedback = onChatResumeFeedback
        self.configTemplateOverride = configTemplate
        let loaded = configModel.config
        self.dockBadge = DockBadgeController(
            mode: DockBadgeMode(rawValue: loaded.dockBadgeMode) ?? .realtime,
            intervalMin: loaded.dockBadgeIntervalMin,
            setBadge: RealDockBadge.setBadge, makeTimer: RealDockBadge.makeTimer)

        // pty-children 活会话接线（⑩观察②缺口）：spawn 记账本、终态移除——硬崩溃残留由 orphan-pty-reaper 兜底。
        let store = ptyChildrenStore
        self.registry = SessionRegistry(
            onChildSpawned: { pid in try? store.record(pid: pid) },
            onChildReaped: { pid in try? store.remove(pid: pid) }
        )
        self.lastAppliedTerminalThemeName = loaded.terminal.themeName
        self.panelZoom = Self.clampPanelZoom(loaded.panelZoom)

        self.waitBus = WaitEventBus()
        self.workerSilenceMonitor = WorkerSilenceMonitor(bus: waitBus)

        self.activeSessionsStore = TerminalActiveSessionsStore(root: dataRoot)
        self.ownershipBox = TakeoverOwnershipBox()
        self.injectionThrottle = InjectionThrottle(limit: TerminalRestoreGate.resumeConcurrencyM)
        self.claudeContainerPath = claudeContainer
            ?? ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"].map { ($0 as NSString).expandingTildeInPath }
            ?? (homePath as NSString).appendingPathComponent(".claude")
        // Codex rollout 根（§1.5）：隔离参数 > CODEX_HOME/sessions > ~/.codex/sessions。
        self.codexSessionsPath = codexContainer
            ?? ProcessInfo.processInfo.environment["CODEX_HOME"].map {
                (($0 as NSString).expandingTildeInPath as NSString).appendingPathComponent("sessions")
            }
            ?? ((homePath as NSString).appendingPathComponent(".codex") as NSString).appendingPathComponent("sessions")
        let logsDir = dataRoot.appendingPathComponent("logs", isDirectory: true)
        self.restoreAuditURL = logsDir.appendingPathComponent("session-restore-audit.log")
        self.restoreBannerLogURL = logsDir.appendingPathComponent("session-restore-banner.log")
        self.restoreBanner = SessionRestoreBanner(logURL: restoreBannerLogURL)
        let anchorStore = activeSessionsStore
        let ownership = ownershipBox
        let backfill = chatTitleBackfill
        self.sessionTracker = SessionTracker(
            bus: waitBus, deliverOn: DispatchQueue(label: "muxvo.session-tracker"),
            record: { termId, sessionId, cwd, transcriptPath, ts in
                // R2.5 首绑补写触发：首绑/换 sid 判据须在 updateAnchor 前读旧值（record 由单串行 tracker 队列驱动）。
                let changed = anchorStore.readAll()[termId]?.sessionId != sessionId
                anchorStore.updateAnchor(
                    termId: termId, sessionId: sessionId, cwd: cwd, transcriptPath: transcriptPath, lastActiveTs: ts)
                if changed { backfill.fire(termId: termId, sessionId: sessionId) }
            },
            remove: { anchorStore.clear(termId: $0) },
            ownershipOf: { ownership.ownership(of: $0) })

        // Codex 锚点采集（§1.5，r3）：无 hook → 前台探针 + rollout 定向匹配。record/clear 写同一 anchorStore
        // （harness=.codex，与 CC 采集写同键、最近活跃覆盖）；listCandidates 走定向 probe（严禁全量扫）。
        let codexRoot = URL(fileURLWithPath: codexSessionsPath, isDirectory: true)
        self.codexTracker = CodexAnchorTracker(
            record: { termId, sid, cwd, rollout, ts in
                anchorStore.updateAnchor(
                    termId: termId, sessionId: sid, cwd: cwd, transcriptPath: rollout,
                    lastActiveTs: ts, harness: .codex)
            },
            clearIfCodex: { termId, sid in
                anchorStore.clearIfMatches(termId: termId, harness: .codex, sessionId: sid)
            },
            listCandidates: { sinceMs, nowMs in
                CodexRolloutProbe.recentCandidates(
                    sessionsDir: codexRoot, sinceMs: Int64(sinceMs), nowMs: Int64(nowMs)
                ).map {
                    RolloutCandidate(
                        sessionId: $0.sessionId, cwd: $0.cwd, rolloutPath: $0.rolloutPath,
                        mtimeMs: UInt64(max(0, $0.mtimeMs)))
                }
            },
            ownershipOf: { ownership.ownership(of: $0) })

        // WaitDetector hub：合成结论经 onConclusion（hubQueue 非 main）→ hop main → fan-out 各窗 noteWaiting。
        // 前台非 shell 门控改读**每 tick 共享快照**（§1.5：与 codexTracker 同一次 pgrep/ps，不翻倍 exec）。
        let fgBox = foregroundSnapshotBox
        self.waitDetectorHub = WaitDetectorHub(
            bus: waitBus,
            onConclusion: { [weak self] id, source in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { self?.fanoutNoteWaiting(id, source) }
                }
            },
            foregroundProbe: { shellPid in fgBox.isNonShell(shellPid) })

        // silence 生产者进展回灌（§3，B2-6）：worker 终端非 silence hook 事件 → noteProgress。独立队列，捕 Sendable 盒。
        // sessionStart 排除（登记 4 兑现随修）：会话启动不是「任务进展」——不重置静默进展戳，
        // 保「进展信号源 = 遥测 hook（Notification/Stop/UserPromptSubmit）」语义不变。
        let silenceMon = workerSilenceMonitor
        let ownershipForSilence = ownershipBox
        waitBus.subscribe(deliverOn: DispatchQueue(label: "muxvo.silence-progress")) { ev in
            guard ev.event != .silence, ev.event != .sessionStart,
                  ownershipForSilence.ownership(of: ev.termId) == .worker else { return }
            silenceMon.noteProgress(termId: ev.termId, tsMs: ev.ts)
        }

        // registry 去抖状态变化（hop main）→ fan-out 各窗投影（§2；order 守卫丢外来 id）。
        registry.addObserver { [weak self] id, state in
            MainActor.assumeIsolated { self?.fanoutRegistryStateChange(id, state) }
        }

        // git 门控探针值变 → fan-out 各窗重推带新 isGitRepo/worktreeRegistered 的 ui.state。
        gitStatusCache.onChange = { [weak self] in self?.fanoutRedeliver() }

        // R2.5 首绑补写实现：record 闭包在 tracker 后台队列 fire → hop main → fan-out 各窗（无该 termId 成员内部 no-op）。
        chatTitleBackfill.setHandler { [weak self] termId, sessionId in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.fanoutChatTitleBackfill(termId: termId, sessionId: sessionId) }
            }
        }
    }

    // MARK: 成员登记 / fan-out

    /// 登记一窗（TerminalService.init 末调；弱引用，析构自动剔除）。
    public func registerWindow(_ member: any SessionHubWindow) {
        members.append(WeakMember(value: member))
    }

    /// 注销一窗（TerminalService.stop 调）：剔除成员 + 清 Dock 计数并重算 Σ。
    public func unregisterWindow(_ member: any SessionHubWindow) {
        let oid = ObjectIdentifier(member)
        members.removeAll { $0.value == nil || ObjectIdentifier($0.value!) == oid }
        windowWaitingCounts[oid] = nil
        dockBadge.update(waitingCount: windowWaitingCounts.values.reduce(0, +))
    }

    /// 活成员（剔除已析构；C2 恒 1 项）。
    private func liveMembers() -> [any SessionHubWindow] {
        members.removeAll { $0.value == nil }
        return members.compactMap { $0.value }
    }

    private func fanoutRegistryStateChange(_ id: SessionID, _ state: MuxvoTermCore.TerminalState) {
        for m in liveMembers() { m.hubNoteRegistryStateChange(id, state) }
    }
    private func fanoutNoteWaiting(_ id: SessionID, _ source: WaitSource?) {
        for m in liveMembers() { m.hubNoteWaiting(id, source) }
    }
    private func fanoutRedeliver() {
        for m in liveMembers() { m.hubRedeliver() }
    }
    private func fanoutChatTitleBackfill(termId: String, sessionId: String) {
        for m in liveMembers() { m.hubApplyChatTitleBackfill(termId: termId, sessionId: sessionId) }
    }

    // MARK: Dock 徽标聚合（§5.3 全局 Σ）

    /// 各窗 deliver 喂本窗 waitingCount → hub 汇总 Σ 落 Dock（C2 单窗 = 该窗值，逐位一致）。
    func noteWindowWaitingCount(_ member: any SessionHubWindow, _ count: Int) {
        windowWaitingCounts[ObjectIdentifier(member)] = count
        dockBadge.update(waitingCount: windowWaitingCounts.values.reduce(0, +))
    }

    /// 测试可见：喂给 Dock 徽标的 Σ 各窗等待计数（settings-dogfood 批：silence 计入口径的装配断言缝）。
    var windowWaitingTotalForTest: Int { windowWaitingCounts.values.reduce(0, +) }

    // MARK: 全局字号 / panelZoom 广播（§5.1）

    /// panelZoom clamp [0.6, 2.0]（纯函数供 init/步进共用）。
    nonisolated static func clampPanelZoom(_ value: Double) -> Double { min(2.0, max(0.6, value)) }

    /// 全局字号缩放（DOGFOOD_M3_05，§5.1 一窗改全窗同步）：逐窗投影步进 + 渲染广播，单值持久化
    /// config.terminal.fontSize。返回新字号（web 路径回 zoomed(fontSize:)）。C2 单成员 = 原 applyZoom 语义。
    @discardableResult
    func applyGlobalZoom(_ dir: UIStateProjection.ZoomDirection) -> Int {
        var size = configModel.config.terminal.fontSize
        for m in liveMembers() { size = m.hubStepFontZoom(dir) }
        persistFontSize(size)
        return size
    }

    private func persistFontSize(_ size: Int) {
        guard configModel.config.terminal.fontSize != size else { return }
        configModel.update { $0.terminal.fontSize = size }
    }

    /// 面板缩放（dogfood-r3 问题5，§5.1 全局）：±0.1 阶梯 clamp、reset=1.0 → 置权威态 + 持久化
    /// config.panelZoom + fan-out 各窗重推。返回新值。C2 单成员 = 原 TerminalService.applyPanelZoom 语义。
    @discardableResult
    func applyPanelZoom(_ dir: UIStateProjection.ZoomDirection) -> Double {
        let tenths = (panelZoom * 10).rounded()
        let next: Double
        switch dir {
        case .in: next = Self.clampPanelZoom((tenths + 1) / 10)
        case .out: next = Self.clampPanelZoom((tenths - 1) / 10)
        case .reset: next = 1.0
        }
        guard next != panelZoom else { return panelZoom }
        panelZoom = next
        if configModel.config.panelZoom != next {
            configModel.update { $0.panelZoom = next }
        }
        for m in liveMembers() { m.hubRedeliver() }
        return next
    }

    // MARK: 偏好副作用（config.request set → ConfigModel.onPrefsChanged → AppDelegate → 本类）

    /// Dock 徽标模式重算（M6 批1）。
    func applyDockBadgePrefs() {
        dockBadge.reconfigure(
            mode: DockBadgeMode(rawValue: configModel.config.dockBadgeMode) ?? .realtime,
            intervalMin: configModel.config.dockBadgeIntervalMin)
    }

    /// 终端配色广播（terminal-theme.md §5，全局）：lastApplied 守卫仅真变才重注全会话。
    func applyTerminalThemePrefs() {
        let name = configModel.config.terminal.themeName
        guard name != lastAppliedTerminalThemeName else { return }
        lastAppliedTerminalThemeName = name
        let theme = TermTheme.named(name)
        for session in registry.allSessions() { session.applyTheme(theme) }
    }

    // MARK: WaitEventBus 接缝（interactive-worker.md §3，B2-6）+ ownership 判据

    @discardableResult
    func subscribeWaitEvents(
        deliverOn queue: DispatchQueue, _ handler: @escaping @Sendable (WaitEvent) -> Void
    ) -> WaitEventBus.Token {
        waitBus.subscribe(deliverOn: queue, handler)
    }
    func unsubscribeWaitEvents(_ token: WaitEventBus.Token) { waitBus.unsubscribe(token) }
    func setTakeoverOwnershipCheck(_ isTakeover: @escaping @Sendable (String) -> Bool) {
        ownershipBox.setTakeoverCheck(isTakeover)
    }
    func setWorkerOwnershipCheck(_ isWorker: @escaping @Sendable (String) -> Bool) {
        ownershipBox.setWorkerCheck(isWorker)
    }

    // MARK: 投影构造工厂（每窗 TerminalService.init 用；全局 config 派生）

    /// 生产缺省 spawn 模板（继承当前终端配色 + 恒注入本 app hook socket env，wait-detector.md §4）。
    static func makeDefaultConfigTemplate(
        configModel: ConfigModel, dataRoot: URL
    ) -> () -> TerminalSession.Config {
        let socketPath = HookScript.socketURL(dataRoot: dataRoot).path
        return {
            let name = MainActor.assumeIsolated { configModel.config.terminal.themeName }
            var cfg = TerminalSession.Config()
            cfg.theme = TermTheme.named(name)
            cfg.extraEnv[HookScript.socketEnvKey] = socketPath
            return cfg
        }
    }

    /// 每窗投影 spawn 模板：override（测试缝）优先，否则生产模板。
    func makeProjectionConfigTemplate() -> () -> TerminalSession.Config {
        configTemplateOverride ?? Self.makeDefaultConfigTemplate(configModel: configModel, dataRoot: dataRoot)
    }

    /// 每窗投影无显式 cwd 默认落点（读全局 config.defaultTerminalCwd，'' 或失效目录 → homePath 兜底）。
    func makeProjectionDefaultCwd() -> () -> String {
        let configModel = self.configModel
        let homePath = self.homePath
        return {
            MainActor.assumeIsolated {
                TerminalService.resolveDefaultCwd(configModel.config.defaultTerminalCwd, homePath: homePath)
            }
        }
    }

    /// 每窗投影初始字号（全局 config.terminal.fontSize）。
    var initialFontSize: Int { configModel.config.terminal.fontSize }

    // MARK: 真状态源 / 心跳（beginStateSource 拆：hub 起一次 + 每窗 register + 推首帧）

    /// 起 Layer 0 hook socket（幂等：已起则 no-op）。
    func startHookSocket() {
        guard hookListener == nil else { return }
        let reg = registry
        let bus = waitBus
        let listener = HookSocketListener(
            runDirectory: HookScript.runDirectory(dataRoot: dataRoot),
            isLiveTerminal: { termId in reg.session(for: SessionID(raw: termId)) != nil },
            onEvent: { event in bus.publish(event) })
        do {
            try listener.start()
            hookListener = listener
            NSLog("[muxvo] WaitDetector hook socket 已监听：\(listener.socketURL.path)")
        } catch {
            NSLog("[muxvo] WaitDetector hook socket 启动失败（退化到兜底层）：\(error)")
        }
    }

    /// 心跳泵（terminal-session.md §6.3/§3.2/§5，全局单泵）：每 50ms 推进 registry 超时 + 逐窗投影 flush；
    /// 每 ~1s（20 tick）逐窗 refreshCwds/末行采样/尺寸门 + 聚合全窗 liveTerminalIds 喂 pollWaitDetector +
    /// 锚点去抖落盘。幂等：已起则 no-op（多窗各自 beginStateSource 不重起）。
    func startHeartbeat() {
        guard !heartbeatStarted else { return }
        heartbeatStarted = true
        heartbeat?.invalidate()
        heartbeatTick = 0
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                let now = UInt64(DispatchTime.now().uptimeNanoseconds / 1_000_000)
                self.registry.pumpTimeouts(nowMs: now)
                for m in self.liveMembers() { m.hubFlushProjection() }
                self.activeSessionsStore.flushIfDue(nowMs: WaitClock.nowMs())
                self.heartbeatTick &+= 1
                if self.heartbeatTick % 20 == 0 {
                    for m in self.liveMembers() { m.hubRefreshCwds() }
                    self.pollWaitDetector()
                    for m in self.liveMembers() { m.hubSampleMinimizedLastLines() }
                    for m in self.liveMembers() { m.hubEnsureBackgroundSized() }
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeat = timer
    }

    /// 静默/前台轮询（§6，1s）：聚合全窗活体终端组 LiveTerminal 喂 waitHub.poll；worker 终端另喂 silence
    /// 生产者。跨窗去重（同一 SessionID 只属一窗 order；C2 单窗天然无重复）。
    private func pollWaitDetector() {
        var live: [WaitDetectorHub.LiveTerminal] = []
        var workers: [WorkerSilenceMonitor.WorkerTerminal] = []
        var seen = Set<String>()
        // §1.5 统一前台探针 pass：每活体终端一次 foregroundState（含 comm+argv），存快照供 WaitDetectorHub
        // 静默门控 + codexTracker 采集共享——与 M3 现状同 exec 数（不为 codex 额外跑 pgrep/ps）。
        var fgSnapshot: [Int32: ForegroundProbe.ForegroundState] = [:]
        var codexObs: [CodexTermObservation] = []
        for m in liveMembers() {
            for raw in m.hubLiveTerminalIds {
                guard seen.insert(raw).inserted else { continue }
                guard let session = registry.session(for: SessionID(raw: raw)) else { continue }
                let shellPid = session.pid ?? 0
                let fg = ForegroundProbe.foregroundState(shellPid: shellPid)
                if fgSnapshot[shellPid] == nil { fgSnapshot[shellPid] = fg }
                live.append(WaitDetectorHub.LiveTerminal(
                    termId: raw, shellPid: shellPid, lastOutputMs: session.lastOutputMs))
                if ownershipBox.ownership(of: raw) == .worker {
                    workers.append(WorkerSilenceMonitor.WorkerTerminal(
                        termId: raw, shellPid: shellPid, lastOutputMs: session.lastOutputMs))
                }
                codexObs.append(CodexTermObservation(termId: raw, cwd: session.cwd, foreground: fg))
            }
        }
        foregroundSnapshotBox.set(fgSnapshot) // WaitDetectorHub 闭包按 shellPid 读（poll 前置）
        let now = WaitClock.nowMs()
        waitDetectorHub.poll(live: live, nowMs: now)
        workerSilenceMonitor.poll(workers: workers, nowMs: now)
        codexTracker.poll(observations: codexObs, nowMs: now) // §1.5 Codex 锚点采集
    }

    /// 停机（AppDelegate.applicationWillTerminate / 便利构造自建 hub 时 TerminalService.stop 调）：停心跳泵 +
    /// hook socket + 强制落盘会话锚点。各窗在飞恢复注入 Task 由各窗 TerminalService.stop 取消。
    public func stop() {
        heartbeat?.invalidate()
        heartbeat = nil
        heartbeatStarted = false
        hookListener?.stop()
        hookListener = nil
        activeSessionsStore.flush()
    }

    // MARK: 会话恢复层规划（terminal-session-restore.md §3；注入执行留各窗 TerminalService）

    /// 恢复注入请求（planRestore 产出，TerminalService 逐条 enqueueRestoreInjection）。
    struct RestoreInjectRequest {
        let termId: String
        let anchor: TerminalSessionAnchor
        let tsMs: UInt64
    }

    /// 规划恢复层（原 TerminalService.restoreSessions 的规划/seed/prune/横幅半）：join openTerminals ↔ 锚点
    /// → 逐条过闸 → seed 结转 + 剪除死键 + 横幅取证；返回统计 + 待注入清单（注入执行触 projection.noteAltScreen
    /// 属窗内，留 TerminalService）。nil 统计 = 无 join / 无历史锚点（首启/正常无恢复）→ 纯 M3。

    /// 指挥台降级横幅窄接缝（merge 语义迁移：main 的 noteRestoredConsoles 挂 service，其 banner 归 hub 后
    /// 经此透传；只暴露单方法不暴露 banner 本体）。count==0 内部短路。
    func noteConsoleDegraded(count: Int) {
        restoreBanner.consoleDegraded(count: count)
    }

    func planRestore(join: [UIStateProjection.RestoreJoin]) -> (stats: TerminalService.RestoreStats?, injects: [RestoreInjectRequest]) {
        guard !join.isEmpty else { return (nil, []) }
        let anchors = activeSessionsStore.readAll()
        guard !anchors.isEmpty else { return (nil, []) }
        let inputs = join.map {
            TerminalRestorePlanner.JoinInput(newTermId: $0.newId, stableId: $0.source.id, cwd: $0.source.cwd)
        }
        let now = WaitClock.nowMs()
        let plan = TerminalRestorePlanner.plan(
            inputs: inputs, anchors: anchors,
            containers: [.cc: claudeContainerPath, .codex: codexSessionsPath], nowMs: now)
        var seeded: Set<String> = []
        var injects: [RestoreInjectRequest] = []
        var injectedCount = 0
        for entry in plan.entries {
            switch entry.decision {
            case .none:
                break // 无锚点 join → 纯 M3
            case let .cannotRestore(anchor):
                activeSessionsStore.seedRestored(termId: entry.newTermId, anchor: anchor)
                seeded.insert(entry.newTermId)
            case let .isolate(anchor):
                activeSessionsStore.seedRestored(termId: entry.newTermId, anchor: anchor)
                seeded.insert(entry.newTermId)
            case let .inject(anchor, seedAttempts):
                var seededAnchor = anchor
                seededAnchor.resumeAttempts = seedAttempts // 结转 crash-loop 计数
                seededAnchor.lastResumeTs = now // 注入即打戳
                activeSessionsStore.seedRestored(termId: entry.newTermId, anchor: seededAnchor)
                seeded.insert(entry.newTermId)
                injects.append(RestoreInjectRequest(termId: entry.newTermId, anchor: seededAnchor, tsMs: now))
                injectedCount += 1
            }
        }
        activeSessionsStore.pruneKeepingOnly(seeded) // 剪除 pre-crash 死键
        activeSessionsStore.flush() // seed/prune 立即落盘
        restoreBanner.cannotRestore(count: plan.cannotRestoreCount)
        restoreBanner.crashLoopPaused(count: plan.crashLoopIsolatedCount)

        let stats = TerminalService.RestoreStats(
            injected: injectedCount, cannotRestore: plan.cannotRestoreCount,
            isolated: plan.crashLoopIsolatedCount)
        return (stats, injects)
    }
}
