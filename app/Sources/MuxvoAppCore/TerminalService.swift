// TerminalService：ui.state 唯一真状态源的**每窗薄胶水层**（批4③；批C C2 纵向劈开后瘦身）。
//
// 批C/D C2「共享层抽取」（multi-window.md §2.3）：原 TerminalService 的**全局件**（registry / wait 族 /
// hook socket / 锚点 store / 恢复层规划 / GitStatusCache / DockBadge / 心跳泵 / 全局字号·panelZoom /
// chat 注入配置）上提到 `SessionHub`（全局单件）；本类只保留**窗内件**：UIStateProjection、搜索条 /
// 文件面板 / panelMode / quitConfirm / webOverlay 等 UI overlay 态、handleTermCommand/handleAction、
// mapSnapshot、本窗 persist、恢复注入执行（触 projection.noteAltScreen 属窗内）。全局子系统经 `hub`
// 与一组**计算转发属性**（registry/configModel/waitHub/… → hub.xxx）访问，故绝大多数方法体逐字未变。
//
// hub 心跳/registry/wait 族/字号广播经 `SessionHubWindow` 协议 fan-out 回本窗投影（init 末
// `hub.registerWindow(self)`）。**C2 仍只 1 窗**——外部行为与劈开前逐位一致。
//
// 分工（file 所有权定案，窗内半）：可测逻辑（观察/持有 UI 态/50ms 去抖/命令路由）在 MuxvoTerm 的
// UIStateProjection（library，单测）；本类只做三件不含分支逻辑的映射/装配：
//   ① 中性 ProjectionSnapshot → MuxvoBridge.UIState（补 per-push 唯一 id / palette / theme / homePath）→ onState
//   ② MuxvoBridge.TermCommandRequest → projection 命令 → 中性 outcome → MuxvoBridge.TermCommandResponse
//   ③ MuxvoBridge.UIAction（非 layoutReport）→ projection 方法（+ gridResize 持久化 config.gridLayout）
//
// 并发：@MainActor。projection 全程 main 单串行访问，与其「单一上下文」合同一致。
import AppKit
import Foundation
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
import MuxvoTermCore

@MainActor
public final class TerminalService: SessionHubWindow {
    /// 全局共享子系统（批C C2）：registry / wait 族 / hook socket / 锚点 / 恢复规划 / gitCache / dockBadge /
    /// 心跳 / 全局字号·panelZoom / chat 注入配置全在此。便利构造时自建（ownsHub=true）；生产经
    /// WindowManager 注入共享 hub（ownsHub=false）。
    public let hub: SessionHub
    /// 是否本类拥有 hub（便利构造自建）：stop() 时据此决定是否连带 hub.stop()（生产由 AppDelegate 停 hub）。
    private let ownsHub: Bool
    /// 本窗 ui.state 投影（含批A minimized/批B viewMode）。
    private let projection: UIStateProjection
    private let homePath: String

    // MARK: 全局子系统计算转发（method 体保持原样：registry./configModel./waitHub. → hub.…）

    /// 会话注册表（SurfaceProvider 共享同一实例）。全局唯一（§2.1），实体在 hub。
    public var registry: SessionRegistry { hub.registry }
    /// git 门控字段填充缓存（M6 批A）。实体在 hub。
    public var gitStatusCache: GitStatusCache { hub.gitStatusCache }
    private var configModel: ConfigModel { hub.configModel }
    private var activeSessionsStore: TerminalActiveSessionsStore { hub.activeSessionsStore }
    private var sessionTracker: SessionTracker { hub.sessionTracker }
    private var waitHub: WaitDetectorHub { hub.waitDetectorHub }
    private var waitBus: WaitEventBus { hub.waitBus }
    private var injectionThrottle: InjectionThrottle { hub.injectionThrottle }
    private var chatTitlesStore: ChatCustomTitlesStore? { hub.chatTitlesStore }
    private var worktreeNamesStore: WorktreeNamesStore? { hub.worktreeNamesStore }
    private var ensureResumable: (@Sendable (_ sessionId: String) -> ChatResumeGateVerdict)? { hub.ensureResumable }
    private var onChatResumeFeedback: (@Sendable (_ sessionId: String, _ code: String) -> Void)? { hub.onChatResumeFeedback }
    private var restoreAuditURL: URL { hub.restoreAuditURL }
    /// 面板缩放（dogfood-r3 问题5）：全局单值，实体在 hub；mapSnapshot 每 push 读、applyPanelZoom 转 hub。
    public var panelZoom: Double { hub.panelZoom }

    // MARK: 窗内态

    /// 本窗持久化分组键（multi-window.md §4，schema v2）：WindowManager 建窗后置。nil = 便利构造/旧单窗
    /// 路径 → persist* 退化写顶层扁平（老行为，向后兼容）；非 nil → 写本窗 `config.windows[windowId]` 分组
    /// + 镜像首窗回顶层（§4.3）。
    public var windowId: String?
    /// 本窗编号（§6.3；建 windows[] entry 缺席时兜底填入）。
    public var windowNumber: Int?

    /// 搜索条归属终端（Cmd+F 置、searchClose 清；批5②）。纯 UI overlay 态，留在薄胶水层不入 projection。
    private var searchBarTerminalId: String?
    /// 文件面板归属终端（M6 批A，file-panel.md §0.5）：fileOpen 置、fileClose/⌘E 清。纯 UI overlay 态。
    private var filePanelTerminalId: String?
    /// 面板模式权威态（task-center-panel.md §1，裁决①-panelMode）：native 持 terminal|taskCenter，经
    /// ui.state.panelMode 通知 web 切屏。**mode-consistency 不变量**：mapSnapshot 每 push 恒读此值置字段。
    public private(set) var panelMode: PanelMode = .terminal
    /// web 侧「全页覆盖面板」在前的上报源集合（ui.action panelOverlayReport）：skills/mcp/hooks overlay 与
    /// file tabs 视图是 web 本地态、native 不可见，须上报供 ⌘+/- 路由。
    private var webOverlaySources: Set<String> = []
    /// 切入非 terminal 全窗面板前的主动 detach 缝（M5-R1 批4 顺修，单一缝收口）：装配层注入
    /// compositeRoot.detachAllSurfacesForPanelMode。
    public var onWillEnterFullPanel: (() -> Void)?
    /// 退出确认待决态（DOGFOOD_M3_19）：AppDelegate.applicationShouldTerminate 唯一漏斗经 requestQuitConfirm
    /// 置、confirmQuit/cancelQuit 清。mapSnapshot 每 push 恒读落 ui.state.quitConfirm。
    public private(set) var quitConfirmPending: QuitConfirm?
    private var onQuitConfirmed: (() -> Void)?
    private var onQuitCancelled: (() -> Void)?
    /// per-push 唯一 id 源（桥草案 §3.1 m-1）。
    private var pushCounter: UInt64 = 0

    /// ui.state 出口：装配时接 PanelViewController.pushState（经 bus.pushUIState，握手前入队合并）。
    public var onState: ((UIState) -> Void)?

    /// 字号缩放渲染出口（DOGFOOD_M3_05）：hub 全局字号广播经 hubStepFontZoom 调 → 各 surface.updateFontSize。
    public var onFontSizeChanged: ((Int) -> Void)?

    /// 埋点观测缝（analytics.md L2，埋点批2）：装配层接 AnalyticsAssembly.track。纯旁路 nil = no-op，
    /// 绝不影响终端行为；restore 播种不经此（只挂用户动作收口）。
    public var onAnalyticsEvent: ((String, [String: String]) -> Void)?

    // MARK: 会话恢复（窗内半：注入执行触 projection.noteAltScreen；规划半在 hub.planRestore）

    /// 上次 restoreSessions 统计（M-2 可观测缝）。规划半（hub.planRestore）产出，本窗 createStartupTerminals 存。
    public struct RestoreStats: Equatable, Sendable {
        public let injected: Int
        public let cannotRestore: Int
        public let isolated: Int
    }
    public private(set) var lastRestoreStats: RestoreStats?
    /// 上次 restore 识别出的「被当普通会话恢复的指挥台」数（M4b 台账「重启后 console 无工具残余」清账的
    /// 可观测缝）：console-home cwd 锚识别（command-console.md §1 spawn cwd）、独立于会话锚点分支（无锚点纯
    /// shell 与有锚点 resume 两降级态皆计入）。集成测据此断言识别 + 提示计数，无需 hook 系统通知。0 = 无指挥台恢复。
    public private(set) var lastRestoreConsoleCount: Int = 0
    /// B5 登记6：会话恢复顶部横幅「已被用户关闭」标志。每次跑恢复层（lastRestoreStats 刷新）复位为 false
    /// ——新一轮重启的无法恢复/熔断计数是新事件，需重新可见；dismissRestoreBanner 动作置 true 隐藏本轮。
    private var restoreBannerDismissed = false
    /// 恢复注入在飞 Task（stop 时取消）。
    private var restoreInjectionTasks: [Task<Void, Never>] = []
    /// 登记⑩观测锁盒（生产只写不读；恢复/续聊两注入 Task 落地时写）。
    private let resumeInjectionObservation = ResumeInjectionObservationBox()

    /// 上次已打点的 waitingCount（hook 彩排取证 t1 锚点用，变化才打避免逐帧噪声）。
    private var lastWaitingCountLogged = 0

    // MARK: 便利构造（既有调用点/测试保持不变）—— 自建 SessionHub（ownsHub=true）

    /// 便利入口（既有 configModel: 签名）：自建 SessionHub 收全局件。便利构造兼容缝（批C C2 核心）——
    /// 既有单测/harness 经此零改动保绿。生产共享路径见 WindowManager + init(hub:ownsHub:)。
    public convenience init(
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
        let hub = SessionHub(
            configModel: configModel, ptyChildrenStore: ptyChildrenStore, homePath: homePath, dataRoot: dataRoot,
            gitStatusCache: gitStatusCache, configTemplate: configTemplate, claudeContainer: claudeContainer,
            codexContainer: codexContainer,
            chatTitlesStore: chatTitlesStore, worktreeNamesStore: worktreeNamesStore,
            ensureResumable: ensureResumable,
            onChatResumeFeedback: onChatResumeFeedback)
        self.init(hub: hub, ownsHub: true)
    }

    /// 便利入口（既有 configStore: 签名）：自建独立 ConfigModel + hub。
    public convenience init(
        configStore: ConfigStore, ptyChildrenStore: PtyChildrenStore, homePath: String, dataRoot: URL,
        gitStatusCache: GitStatusCache = GitStatusCache(),
        configTemplate: (() -> TerminalSession.Config)? = nil,
        claudeContainer: String? = nil,
        codexContainer: String? = nil,
        chatTitlesStore: ChatCustomTitlesStore? = nil,
        worktreeNamesStore: WorktreeNamesStore? = nil,
        ensureResumable: (@Sendable (_ sessionId: String) -> ChatResumeGateVerdict)? = nil,
        onChatResumeFeedback: (@Sendable (_ sessionId: String, _ code: String) -> Void)? = nil
    ) {
        self.init(
            configModel: ConfigModel(store: configStore), ptyChildrenStore: ptyChildrenStore,
            homePath: homePath, dataRoot: dataRoot, gitStatusCache: gitStatusCache,
            configTemplate: configTemplate, claudeContainer: claudeContainer, codexContainer: codexContainer,
            chatTitlesStore: chatTitlesStore, worktreeNamesStore: worktreeNamesStore,
            ensureResumable: ensureResumable,
            onChatResumeFeedback: onChatResumeFeedback)
    }

    /// 设计 init（批C C2）：注入共享 hub + 建本窗投影 + 登记到 hub。生产经 WindowManager 传共享 hub
    /// （ownsHub=false，由 AppDelegate 停 hub）；便利构造传自建 hub（ownsHub=true）。
    public init(hub: SessionHub, ownsHub: Bool) {
        self.hub = hub
        self.ownsHub = ownsHub
        self.homePath = hub.homePath
        // 本窗投影：registry/初始字号/spawn 模板/默认 cwd 全从全局 hub 派生。
        self.projection = UIStateProjection(
            registry: hub.registry, homePath: hub.homePath, initialFontSize: hub.initialFontSize,
            configTemplate: hub.makeProjectionConfigTemplate(),
            defaultCwd: hub.makeProjectionDefaultCwd())

        // 去抖后快照 → 映射 UIState → onState。
        projection.onSnapshot = { [weak self] snap in self?.deliver(snap) }
        // 终端结构/命名变化（create/remove/reorder/rename）→ 维序写回 config.openTerminals（尾批 item 1/3）。
        projection.onTerminalsPersist = { [weak self] in self?.persistOpenTerminals() }
        // 终端从投影剔除（用户关终端/自退移除）→ 清该 termId 会话锚点（M4b §1）+ 复位 Codex 采集状态机（§1.5）。
        projection.onTerminalRemoved = { [weak self] id in
            self?.sessionTracker.terminalRemoved(termId: id.raw)
            self?.hub.codexTracker.terminalRemoved(termId: id.raw)
        }

        // 登记本窗到 hub（弱引用）：registry 观察者/wait 结论/git 值变重推/chatTitle 补写/字号广播经 hub
        // fan-out 落本窗投影。self 全属性已初始化，登记安全。
        hub.registerWindow(self)
    }

    // MARK: 装配 / 生命周期

    /// 启动装配（尾批 item 1）：优先按 config.openTerminals 存档逐个重 spawn 新 shell（带 cwd/customName），
    /// 空存档 → 回退 startupTerminalCount 个于 homePath。onState 未接前调 → 不推，仅建会话 + 投影态。
    @discardableResult
    public func createStartupTerminals(count: Int) -> [String] {
        // 单窗路径（首窗 makeFirstWindow / harness / 单测）：seed 首窗 flat 存档 → 本窗独跑恢复层。
        // 多窗恢复走 seedRestoreTerminals + 聚合 planRestore（WindowManager.restoreWindows，§1.3 铁律）。
        let ids = seedRestoreTerminals(from: configModel.config.openTerminals, fallbackCount: count)
        let plan = hub.planRestore(join: projection.lastRestoreJoin)
        applyRestorePlan(injects: plan.injects, stats: plan.stats)
        return ids
    }

    /// 多窗恢复 Phase A（multi-window.md §1.3）：按持久化分组建本窗终端占位（restoreTerminals + 用户写钩子
    /// + §11.4 尺寸门第 1 层），**不跑恢复层**——planRestore 归聚合层（§1.3 铁律：全窗 join 求并集只跑一次，
    /// 避免每窗各跑撞 registry / 锚点 pruneKeepingOnly 误删他窗锚点）。产出 projection.lastRestoreJoin 待聚合。
    @discardableResult
    public func seedRestoreTerminals(from stored: [MuxvoConfig.OpenTerminal], fallbackCount: Int) -> [String] {
        let entries = stored.map {
            PersistableTerminal(
                id: $0.id, cwd: $0.cwd, customName: $0.customName, minimized: $0.minimized ?? false)
        }
        let ids = projection.restoreTerminals(entries, fallbackCount: max(1, fallbackCount))
        for id in ids { installUserWriteHook(termId: id) }
        // 空存档 fallback = 全新终端于默认路径（与新窗播种/FAB 同语义）→ 同挂抗漂移 pin
        //（settings-dogfood 对抗 MINOR-1 回修：原只 createTerminalUnified 链有 pin，此链缺口不对称）。
        // 有存档 = 恢复链（cwd 来自存档），pin 语义归 terminal-session-restore 域，不在此挂。
        if entries.isEmpty, let pin = Self.resolveDefaultCwdPin(configModel.config.defaultTerminalCwd) {
            for id in ids { enqueueCwdPinInjection(termId: id, cwd: pin) }
        }
        // §11.4 尺寸门第 1 层（对抗回修 MINOR-1）：恢复为收起态且带持久化尺寸 → 立即 resize（注入器
        // 直接过门；覆盖全收起重启的持久无源场景）。必须先于恢复注入（注入入队前把门置好）。
        for join in projection.lastRestoreJoin {
            guard let src = stored.first(where: { $0.id != nil && $0.id == join.source.id }),
                  src.minimized == true, let c = src.cols, let r = src.rows, c >= 10, r >= 2,
                  let session = registry.session(for: SessionID(raw: join.newId)) else { continue }
            _ = session.resize(cols: UInt16(clamping: c), rows: UInt16(clamping: r))
            Log.app.notice(
                "持久化尺寸恢复 [\(join.newId, privacy: .public)] \(c)x\(r)（收起态重启，§11.4 第 1 层过门）")
        }
        return ids
    }

    /// 本窗待聚合恢复 join（multi-window.md §1.3；WindowManager 聚合全窗喂 hub.planRestore）。
    public var pendingRestoreJoins: [UIStateProjection.RestoreJoin] { projection.lastRestoreJoin }

    /// 多窗恢复 Phase B（multi-window.md §1.3）：聚合 planRestore 产出的统计/注入分发到本窗——只入队
    /// **属本窗**（lastRestoreJoin 含该 newId）的注入（注入执行触 projection.noteAltScreen 属窗内故留本类）。
    /// stats 逐窗置同一聚合值（横幅按窗投影，多窗共享一份恢复统计）。
    func applyRestorePlan(injects: [SessionHub.RestoreInjectRequest], stats: RestoreStats?) {
        let mine = Set(projection.lastRestoreJoin.map { $0.newId })
        for req in injects where mine.contains(req.termId) {
            enqueueRestoreInjection(termId: req.termId, anchor: req.anchor, tsMs: req.tsMs)
        }
        // M4b 台账「重启后 console 无工具残余」清账（merge 语义迁移：main 挂 createStartupTerminals 内联，
        // 多窗架构下挂本汇点——单窗/多窗聚合两路径都经此，且用**本窗** join 识别本窗降级指挥台）。
        noteRestoredConsoles(join: projection.lastRestoreJoin)
        if let stats {
            lastRestoreStats = stats // M-2 可观测缝
            restoreBannerDismissed = false // 新一轮恢复计数 = 新事件，横幅重新可见（B5 登记6 form 半）
            // 多窗聚合恢复在 beginStateSource 首帧之后跑（§1.3），横幅须补推一帧（onState 未接则 no-op：
            // 单窗 createStartupTerminals 期 controller 未建，横幅仍随 beginStateSource 首帧出，行为不变）。
            deliver(projection.snapshot())
        }
    }

    /// 新窗启动终端（multi-window.md §1.1 裁决④）：建 count 个**全新**终端于 config.defaultTerminalCwd
    /// （经 projection 默认 cwd 缺省链），**不读 config.openTerminals**（那是首窗恢复域）。onState 未接前调 → 不推。
    @discardableResult
    public func createFreshStartupTerminals(count: Int) -> [String] {
        var ids: [String] = []
        for _ in 0..<max(1, count) {
            if case let .created(terminalId, _) = createTerminalUnified(cwd: nil, source: nil) { ids.append(terminalId) }
        }
        return ids
    }

    /// 本窗维序活体终端 id（multi-window.md §1.2 关窗收割 / §3 每窗计数）：projection.order 全体（可见+收起）。
    public var windowTerminalIds: [String] { projection.liveTerminalIds }

    /// 选中本窗某 tile（multi-window.md §7.1 裁决⑤：指挥台已开时聚焦其所在窗后滚动/选中指挥台 tile）。
    /// order 不含该 id（tile 不在本窗）→ no-op（projection.selectTile 内 order.contains 守卫）。
    public func selectTile(_ terminalId: String) {
        projection.selectTile(terminalId)
    }

    /// 本窗新建终端是否应置灰（multi-window.md §3.2）：snapshot.maxReached = 本窗满 20 ∨ 全局满 40。
    public var currentMaxReached: Bool { projection.snapshot().maxReached }

    /// 双击聚焦偏好实时读（settings-dogfood 批，PAR-13 消费端；CompositeRoot 洞区双击门控用）。
    public var doubleClickToFocusEnabled: Bool { configModel.config.doubleClickToFocus }

    /// 收割本窗全部会话（multi-window.md §1.2 非最后一窗关闭）：逐 id 优雅关闭（SIGHUP，复用关闭协议）+ 从
    /// 全局 registry 强制收割（立即剔除，防泄漏全局 40 名额、令 registry.count 即刻正确）。本窗投影随窗析构，
    /// **不经 projection.closeTerminal**（故不触发 onTerminalsPersist）——防 clobber 存活窗 flat 持久化（§4）。
    public func harvestAllSessions() {
        let ids = projection.liveTerminalIds.map { SessionID(raw: $0) }
        for id in ids { registry.close(id) }
        registry.forceRemove(ids)
    }

    /// 维序写回 config.openTerminals（尾批 item 1/3）：user create/remove/reorder/rename 后由
    /// projection.onTerminalsPersist 触发。M4b【T-3】：稳定 id 随维序落盘，作会话锚点 join 键。
    /// public（批C C3）：multi-window.md §1.2 关窗收割后由存活窗触发覆盖（WindowManager.closeWindow 调）。
    public func persistOpenTerminals() {
        let terms = persistableOpenTerminals()
        configModel.update { config in
            if let wid = windowId {
                // schema v2（multi-window.md §4）：写本窗分组 + 镜像首窗回顶层（§4.3 双写降级）。
                config.upsertWindowEntry(windowId: wid, number: windowNumber) { $0.openTerminals = terms }
            } else {
                config.openTerminals = terms // 便利构造/旧单窗路径：扁平顶层（向后兼容）。
            }
        }
    }

    /// 本窗维序持久化终端数组（multi-window.md §4；WindowManager 建窗登记 entry 复用同款 size-snapshot 口径）。
    public func persistableOpenTerminals() -> [MuxvoConfig.OpenTerminal] {
        projection.persistableTerminals.map { t -> MuxvoConfig.OpenTerminal in
            // §11.4 第 1 层：收起项带当刻会话尺寸快照（重启恢复即 resize 过门；未收起省略）。
            var cols: Int?; var rows: Int?
            if t.minimized, let id = t.id,
               let session = registry.session(for: SessionID(raw: id)), session.hasReceivedResize {
                cols = Int(session.cols); rows = Int(session.rows)
            }
            return MuxvoConfig.OpenTerminal(
                id: t.id, cwd: t.cwd, customName: t.customName,
                minimized: t.minimized ? true : nil, // §11：未收起省略（旧形状字节不变）
                cols: cols, rows: rows)
        }
    }

    /// 真状态源就位（本窗）：起 Layer 0 hook socket（hub，幂等）+ 推本窗首帧快照 + 启心跳泵（hub，幂等）。
    /// 单窗顺序与劈开前逐位一致（hook socket → 首帧 → 心跳）。
    public func beginStateSource() {
        hub.startHookSocket()
        let snap = projection.snapshot()
        Log.app.info("真状态源就位：推首帧 + 启心跳泵（终端 \(snap.terminals.count)）")
        deliver(snap)
        hub.startHeartbeat()
    }

    /// 收起终端末行摘要采样（term-grid.md §11，心跳 1Hz；hub 心跳经 hubSampleMinimizedLastLines 调本窗）。
    /// 只读已物化渲染帧（原子指针快照），自底向上取首条非空行、截 120 字符 → projection.noteLastLine。
    /// internal（非 private）：@testable 直调断言（免真开心跳泵+hook socket）。
    func sampleMinimizedLastLines() {
        for termId in projection.minimizedTerminalIds {
            guard let session = registry.session(for: SessionID(raw: termId)),
                  let frame = session.currentFrame(), frame.rows > 0 else { continue }
            var line = ""
            for y in stride(from: frame.rows - 1, through: 0, by: -1) {
                let text = frame.lineText(y).trimmingCharacters(in: .whitespaces)
                if !text.isEmpty { line = String(text.prefix(120)); break }
            }
            guard !line.isEmpty else { continue }
            projection.noteLastLine(SessionID(raw: termId), line)
        }
    }

    /// 后台尺寸门（term-grid.md §11.4，登记⑩延伸；hub 心跳经 hubEnsureBackgroundSized 调本窗）：重启恢复
    /// 为收起/List 后台的终端永不进网格 → hasReceivedResize=false → resume 注入 5s 超时按 80×24 烧 scrollback。
    /// 解 = 心跳内把首个已收真实 resize 的可见会话（优先 selected）的 cols/rows 拷贝给未定尺寸的收起会话。
    /// internal（非 private）：@testable 直调断言（TG_MIN_restore_size_gate 红绿锚）。
    func ensureBackgroundSized() {
        let targetIds = projection.minimizedTerminalIds + projection.listBackgroundTerminalIds
        guard !targetIds.isEmpty else { return }
        let pending = targetIds.compactMap { id -> TerminalSession? in
            guard let s = registry.session(for: SessionID(raw: id)), !s.hasReceivedResize else { return nil }
            return s
        }
        guard !pending.isEmpty else { return }
        let sourceCandidates = ([projection.snapshot().selectedId].compactMap { $0 } + projection.visibleTerminalIds)
        guard let source = sourceCandidates.lazy
            .compactMap({ self.registry.session(for: SessionID(raw: $0)) })
            .first(where: { $0.hasReceivedResize }) else { return }
        let (cols, rows) = (source.cols, source.rows)
        for session in pending {
            _ = session.resize(cols: cols, rows: rows)
            Log.app.notice(
                "后台尺寸门拷贝 [\(session.id.raw, privacy: .public)] \(cols)x\(rows)（源=可见会话，防 80×24 注入烧写）")
        }
    }

    /// 停机（本窗）：取消在飞恢复注入 + 注销 hub 登记 + 便利构造自建 hub 时连带停 hub（生产由 AppDelegate 停 hub）。
    public func stop() {
        for t in restoreInjectionTasks { t.cancel() }
        restoreInjectionTasks.removeAll()
        hub.unregisterWindow(self)
        if ownsHub { hub.stop() }
    }

    /// 装配层（orch 装配后）注入 takeover 归属判据（§1 found B-2）：转发 hub。
    public func setTakeoverOwnershipCheck(_ isTakeover: @escaping @Sendable (String) -> Bool) {
        hub.setTakeoverOwnershipCheck(isTakeover)
    }

    /// 装配层注入交互式 worker 归属判据（§1 found B-2 + B2-0）：转发 hub。
    public func setWorkerOwnershipCheck(_ isWorker: @escaping @Sendable (String) -> Bool) {
        hub.setWorkerOwnershipCheck(isWorker)
    }

    /// 指挥台重启降级识别 + 提示（M4b 台账「重启后 console 无工具残余」清账；command-console.md §1）。
    /// **只识别 + 告知，不改恢复行为**：restore 把指挥台终端当普通会话恢复（有锚点 → 注入 `claude --resume`
    /// 无 `--mcp-config`；无锚点 → 纯 shell）——两种降级态下指挥四工具皆不存在，fail-closed 行为正确、本批不动。
    /// **识别锚 = console-home cwd**（command-console.md §1：指挥台 spawn 于 `<dataRoot>/console-home`、PTY 根
    /// 为 claude 无 login-shell 漂移，故持久化 cwd 稳定锚定 console-home）；用**持久化 source cwd**（非会话锚点）
    /// 覆盖有/无锚点两降级态。两侧同经 `normalizeInjectedCwd` 归一（皆派生自同一 `consoleHomeURL(dataRoot)`，
    /// 无 symlink 别名问题）。已知有界残余：用户把普通终端 cwd 停在 console-home 会误计（heuristic，同 spec 诚实边界）。
    private func noteRestoredConsoles(join: [UIStateProjection.RestoreJoin]) {
        // merge 语义迁移：dataRoot/restoreBanner 已归 hub（C2 劈层），经 hub 取根 + 窄接缝透传横幅。
        let consoleHome = Self.normalizeInjectedCwd(ConsoleHomeManager.consoleHomeURL(dataRoot: hub.dataRoot).path)
        let count = join.reduce(into: 0) { acc, j in
            if Self.normalizeInjectedCwd(j.source.cwd) == consoleHome { acc += 1 }
        }
        lastRestoreConsoleCount = count
        hub.noteConsoleDegraded(count: count) // count==0 内部短路（无指挥台恢复不打扰）
    }

    /// 排一条恢复注入（案 A，S2）：改装该终端 onUserWrite 为「人键 abort 标志 + 清红路由」→ 过尺寸就绪门
    /// （登记⑩）+ 共用静默门注入 resume 串（在飞 ≤M）→ 成功落取证行（SEC-m1）。人键介入 → 退化普通 shell。
    private func enqueueRestoreInjection(termId: String, anchor: TerminalSessionAnchor, tsMs: UInt64) {
        guard let session = registry.session(for: SessionID(raw: termId)) else { return }
        let flag = installRestoreUserWriteHook(termId: termId)
        let baseline = session.lastOutputMs
        let throttle = injectionThrottle
        let auditURL = restoreAuditURL
        let injectedCwd = Self.normalizeInjectedCwd(anchor.cwd) // F-B：注入 cd 落点归一
        let obsBox = resumeInjectionObservation
        let task = Task.detached { [weak session] in
            guard let session else { return }
            let injected = await throttle.run {
                await InitialCommandInjector.run(
                    cwd: anchor.cwd, sessionId: anchor.sessionId,
                    harness: ResumeCommand.Harness(anchor.harness), // §1.5：.cc→claude / .codex→codex resume
                    baselineMs: baseline,
                    lastOutput: { session.lastOutputMs },
                    write: { session.write($0) },
                    humanInputArrived: { flag.value },
                    sizeReady: { session.hasReceivedResize }) // 尺寸就绪门（登记⑩）
            }
            if injected {
                session.noteInjectedCwd(injectedCwd)
                Self.noteResumeInjectionLanded(box: obsBox, termId: termId, session: session)
                SessionRestoreAudit.record(
                    url: auditURL, termId: termId, sessionId: anchor.sessionId,
                    cwd: anchor.cwd, tsMs: tsMs, resumeAttempts: anchor.resumeAttempts,
                    harness: anchor.harness.rawValue) // 取证可判「重启后自动跑了哪个 CLI」
            }
        }
        restoreInjectionTasks.append(task)
    }

    /// 登记⑩注入落地取证：.notice 持久日志 + 测试缝写入。
    nonisolated private static func noteResumeInjectionLanded(
        box: ResumeInjectionObservationBox, termId: String, session: TerminalSession
    ) {
        let obs = ResumeInjectionObservation(
            termId: termId, cols: session.cols, rows: session.rows, sizeReady: session.hasReceivedResize)
        box.write(obs)
        Log.app.notice(
            "resume 注入落地 [\(termId, privacy: .public)] cols=\(obs.cols)x\(obs.rows) sizeReady=\(obs.sizeReady)")
    }

    /// 恢复期终端 onUserWrite 改装（§3 feas M-9）：排除自应答后置人键标志（注入器读作 abort 判据）+ 保清红路由。
    /// 返回该终端的人键标志（注入器 humanInputArrived 读）。替代 installUserWriteHook（仅被注入终端用此变体）。
    private func installRestoreUserWriteHook(termId: String) -> RestoreHumanInputFlag {
        let flag = RestoreHumanInputFlag()
        guard let session = registry.session(for: SessionID(raw: termId)) else { return flag }
        let wh: WaitDetectorHub = waitHub
        session.onUserWrite = { bytes in
            guard !TerminalAutoResponse.isAutoResponse(bytes) else { return } // 自应答不算人键（provenance，§3）
            flag.set()
            wh.noteUserInput(termId: termId)
        }
        session.onAltScreenChanged = { [weak self] isAlt in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.projection.noteAltScreen(SessionID(raw: termId), isAlt) }
            }
        }
        return flag
    }

    // MARK: WaitEventBus 接缝（转发 hub）

    /// WaitEventBus 第二订阅者接缝（interactive-worker.md §3，B2-6）：转发 hub。
    @discardableResult
    public func subscribeWaitEvents(
        deliverOn queue: DispatchQueue, _ handler: @escaping @Sendable (WaitEvent) -> Void
    ) -> WaitEventBus.Token {
        hub.subscribeWaitEvents(deliverOn: queue, handler)
    }

    /// 注销 WaitEventBus 订阅（幂等；装配层停机时调）：转发 hub。
    public func unsubscribeWaitEvents(_ token: WaitEventBus.Token) {
        hub.unsubscribeWaitEvents(token)
    }

    /// 装 PTY 用户写入 → reset 接缝（§3）：排除终端自应答后 hub.noteUserInput 清红。同装 alt-screen 边沿接缝
    /// （message-editor.md §1/§8）：会话 vt ACTIVE_SCREEN 翻转 → hop main 落 projection.noteAltScreen。
    private func installUserWriteHook(termId: String) {
        guard let session = registry.session(for: SessionID(raw: termId)) else { return }
        let wh: WaitDetectorHub = waitHub
        session.onUserWrite = { bytes in
            guard !TerminalAutoResponse.isAutoResponse(bytes) else { return }
            wh.noteUserInput(termId: termId)
        }
        session.onAltScreenChanged = { [weak self] isAlt in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.projection.noteAltScreen(SessionID(raw: termId), isAlt) }
            }
        }
    }

    // MARK: ① 快照 → UIState

    private func deliver(_ snap: ProjectionSnapshot) {
        // 去抖后的 UI 推送时刻 = <2s 判据 t1（红点/Dock 徽标随本次 onState 达 web）。
        if snap.waitingCount != lastWaitingCountLogged {
            Log.app.notice("wait 红点推送 waitingCount=\(snap.waitingCount, privacy: .public)")
            lastWaitingCountLogged = snap.waitingCount
        }
        // Dock 徽标经 hub 聚合 Σ 各窗**可见等待数**（§5.3；settings-dogfood 批改口径：含静默弱信号，
        // 与 in-app WaitingInput 黄灯/红点一致——legacy dock-badge.ts 数 state==='WaitingInput' 无强弱
        // 之分，强口径致「满屏黄灯角标恒 0」观感断裂。浮卡 waitingNotification 保持强口径不变）。
        hub.noteWindowWaitingCount(self, snap.visibleWaitingCount)
        onState?(mapSnapshot(snap))
    }

    /// Dock 徽标模式重算（M6 批1）：config.request set 后经 ConfigModel.onPrefsChanged → AppDelegate → 转发 hub。
    public func applyDockBadgePrefs() {
        hub.applyDockBadgePrefs()
    }

    /// 终端配色广播（terminal-theme.md §5 立即生效）：config.request set 后经 onPrefsChanged → 转发 hub。
    public func applyTerminalThemePrefs() {
        hub.applyTerminalThemePrefs()
    }

    private func mapSnapshot(_ snap: ProjectionSnapshot) -> UIState {
        pushCounter &+= 1
        let theme: Theme = Theme(rawValue: configModel.config.theme) ?? .dark
        // palette 随 terminal.themeName 取 Theme.swift 真值（terminal-theme.md §6）：终端洞 web
        // 回退底色必须与 Metal 真实渲染色一致，不得按 UI theme 二值硬编码（B1 修错拍）。
        let termTheme = TermTheme.named(configModel.config.terminal.themeName)
        let palette = Palette(
            background: termTheme.background.cssHex,
            foreground: termTheme.foreground.cssHex
        )
        let terminals = snap.terminals.map { t in
            // git 门控字段同步查缓存（M6 批A）：命中填真值、miss 填 nil 并登记后台探针（值回来经
            // onChange 重推）。lookup 是 O(1) 字典读，mapSnapshot 恒零阻塞。
            let git = gitStatusCache.lookup(cwd: t.cwd)
            return TerminalSnapshot(
                id: t.id,
                state: MuxvoBridge.TerminalState(rawValue: t.state.rawValue) ?? .running,
                cwd: t.cwd,
                customName: t.customName,
                isGitRepo: git.isGitRepo,
                worktreeRegistered: git.worktreeRegistered,
                content: nil, // 真状态源恒缺席 content → web 走 .tile-term-hole 透明洞、native 渲染透出（桥草案 §6.3）
                altScreen: t.altScreen ? true : nil, // §1：备用屏 → web 切 RawTerminal；primary 时缺席（省 nil）
                minimized: t.minimized ? true : nil, // term-grid.md §11：未收起缺席（既有 fixture/golden JSON 字节冻结）
                lastLine: t.minimized ? t.lastLine : nil // §11：仅收起终端携带末行摘要（payload 冻结）
            )
        }
        // searchBar 归属终端仍在时才出（终端关闭 → 自动隐藏搜索条，防悬空引用）。
        let searchBar: SearchBar? = searchBarTerminalId
            .flatMap { id in snap.terminals.contains { $0.id == id } ? SearchBar(terminalId: id) : nil }
        // filePanel 同理：归属终端仍在时才出（M6 批A，file-panel.md §0.5）。
        let filePanel: FilePanel? = filePanelTerminalId
            .flatMap { id in snap.terminals.contains { $0.id == id } ? FilePanel(terminalId: id) : nil }
        return UIState(
            id: "s\(pushCounter)", desc: nil,
            theme: theme, homePath: homePath,
            viewMode: ViewMode(rawValue: snap.viewMode.rawValue) ?? .tiling,
            focusedId: snap.focusedId, selectedId: snap.selectedId, activeSidebarId: snap.activeSidebarId,
            maxReached: snap.maxReached,
            dragging: nil, dragOver: nil,          // web 本地瞬时态，真源恒 null（桥草案 §3.4）
            editing: nil,                          // 编辑三态是 web 本地，真源恒 null（桥草案 §3 note）
            // 批5①：强信号等待终端数（>0 出浮卡）。静默弱信号不计（wait-detector.md §3/§6）。
            waitingNotification: snap.waitingCount > 0 ? WaitingNotification(count: snap.waitingCount) : nil,
            searchBar: searchBar,                  // 批5②：Cmd+F 置 / searchClose 清
            showHiddenFiles: configModel.config.showHiddenFiles, // M6 批A：眼睛开关持久态，每 push 恒置
            filePanel: filePanel,                  // M6 批A：fileOpen 置 / fileClose/⌘E 清（归属终端已关自动隐藏）
            panelMode: panelMode,                  // §1 不变量：每 push 恒置权威 mode
            panelZoom: panelZoom == 1.0 ? nil : panelZoom, // dogfood-r3 问题5：==1.0 省略（既有 fixture/golden 字节冻结）
            quitConfirm: quitConfirmPending,        // DOGFOOD_M3_19：退出确认待决态
            restoreBanner: restoreBannerView(),     // B5 登记6：会话恢复顶部横幅（form 半）
            terminals: terminals, palette: palette
        )
    }

    /// B5 登记6（terminal-session-restore.md §4 顶部横幅 form 半）：从 lastRestoreStats 派生横幅视图。
    private func restoreBannerView() -> RestoreBanner? {
        guard !restoreBannerDismissed, let s = lastRestoreStats else { return nil }
        guard s.cannotRestore > 0 || s.isolated > 0 else { return nil }
        return RestoreBanner(cannotRestoreCount: s.cannotRestore, crashLoopPausedCount: s.isolated)
    }

    // MARK: ② term.command handler（→ TermCommandResponse）

    /// BridgeBus.onTermCommand 落点。业务失败经 rejected 分支回（类型化 payload，不占信封错误，桥草案 §2）。
    public func handleTermCommand(_ request: TermCommandRequest) -> TermCommandResponse {
        let outcome: TermCommandOutcome
        switch request {
        case let .create(cwd):
            outcome = createTerminalUnified(cwd: cwd, source: "web")
            // analytics.md L5：spawn 真失败（internal）计 app.error；maxReached/invalidCwd 是业务拒绝不计。
            if case let .rejected(reason, _) = outcome, reason == .internalError {
                onAnalyticsEvent?("app.error", ["domain": "terminal", "code": "spawn_fail"])
            }
            // dogfood-r2#4 根因 B：显式 cwd = 用户目录意图，须抗 login-shell 漂移 → 静默门补写 cd。
            if let cwd, case let .created(terminalId, _) = outcome {
                enqueueCwdPinInjection(termId: terminalId, cwd: cwd)
            }
        case let .close(terminalId):
            outcome = projection.closeTerminal(terminalId: terminalId)
            if case .closed = outcome { onAnalyticsEvent?("term.closed", [:]) }
        case let .zoom(action):
            let dir: UIStateProjection.ZoomDirection
            switch action {
            case .in: dir = .in
            case .out: dir = .out
            case .reset: dir = .reset
            }
            // 两路归一：web term.command zoom 与原生菜单同经 applyZoom（转 hub 全局字号广播 + 持久化）。
            return .zoomed(fontSize: applyZoom(dir))
        case let .insertText(terminalId, text):
            // M6 批A 拖拽路径入终端：把字节当用户键入写进 PTY（shell 转义在 web 侧做，此处保持通用原语）。
            guard let session = registry.session(for: SessionID(raw: terminalId)) else {
                return .rejected(code: .notFound, message: "终端不存在：\(terminalId)")
            }
            session.write(text)
            return .inserted(terminalId: terminalId)
        }
        return mapOutcome(outcome)
    }

    /// 终端直建归一链（DOGFOOD_M3_20）：projection.createTerminal(cwd:) + 成功 installUserWriteHook。
    /// source 仅供埋点（analytics.md L2 term.created：menu|web|help）；nil = 启动播种/恢复，不计。
    private func createTerminalUnified(cwd: String?, source: String?) -> TermCommandOutcome {
        let outcome = projection.createTerminal(cwd: cwd)
        if case let .created(terminalId, _) = outcome {
            installUserWriteHook(termId: terminalId)
            if let source { onAnalyticsEvent?("term.created", ["source": source]) }
            // 默认路径同享抗漂移 pin（settings-dogfood 批，dogfood-r2#4 同因）：cwd:nil 的 PTY 落点
            // =「终端默认路径」偏好（projection defaultCwd 缺省链），但 login-shell .zshrc 的 cd 会把
            // 它漂走——显式 cwd 链（handleTermCommand .create）早有 pin，此处对「已设且有效」的默认
            // 路径补同款。未设/失效（落点=homePath 兜底）不 pin，保 .zshrc cd 既有习惯。与 projection
            // 落点经同一解析函数（resolveDefaultCwdPin），零二次漂移。
            if cwd == nil,
               let pin = Self.resolveDefaultCwdPin(configModel.config.defaultTerminalCwd) {
                enqueueCwdPinInjection(termId: terminalId, cwd: pin)
            }
        }
        return outcome
    }

    /// 菜单「文件 → 新建终端 ⌘N」直建入口（DOGFOOD_M3_20）：与 term.command create 完全同链。
    @discardableResult
    public func createTerminalFromMenu() -> TermCommandOutcome {
        createTerminalUnified(cwd: nil, source: "menu")
    }

    /// 右上角问号=帮助会话一条龙（右上角批 B3；menu-bar.md §6，legacy MenuBar.tsx:113-130 行为对齐）：
    /// 满上限静默失效（legacy ≥20 直接 return 同语义）→ 新建终端（默认 home，建成即自动选中，
    /// UIStateProjection.createTerminal 语义）→ 静默门注入 `claude "请读取 <dataRoot>/guide.md …"` 进入
    /// 可问答帮助会话。web 侧 onHelpClick 已先关面板（closeAllPanels 对齐）。guide.md 由 AppDelegate
    /// 启动时从 bundle 资源拷入数据根（每启覆盖，GuideProvisioner）。
    private func openHelpSession() {
        guard !projection.snapshot().maxReached else { return } // legacy 满 20 静默失效对齐
        // cwd 显式 home（MINOR-2 回修）：legacy handleHelp 恒 home；cwd:nil 会吃「终端默认路径」偏好。
        guard case let .created(termId, _) = createTerminalUnified(cwd: homePath, source: "help") else { return }
        enqueueHelpGuideInjection(termId: termId)
    }

    /// 排一条帮助注入（enqueueRestoreInjection 同族）：尺寸就绪门 + 共用静默门注入 claude 命令。
    /// 无 abort 语义（legacy 盲写对齐）；注入落地 .notice 可判层。
    private func enqueueHelpGuideInjection(termId: String) {
        guard let session = registry.session(for: SessionID(raw: termId)) else { return }
        let guidePath = hub.dataRoot.appendingPathComponent("guide.md").path
        let baseline = session.lastOutputMs
        let throttle = injectionThrottle
        let task = Task.detached { [weak session] in
            guard let session else { return }
            let injected = await throttle.run {
                await HelpGuideInjector.run(
                    guidePath: guidePath,
                    baselineMs: baseline,
                    lastOutput: { session.lastOutputMs },
                    write: { session.write($0) },
                    sizeReady: { session.hasReceivedResize })
            }
            if injected {
                Log.app.notice("帮助会话注入落地 [\(termId, privacy: .public)] guide=\(guidePath, privacy: .public)")
            }
        }
        restoreInjectionTasks.append(task)
    }

    /// 指挥台终端建入口（M4b' T6，command-console.md §1）：PTY 根 = claude、cwd=console-home、onExit 挂 watchExit。
    @discardableResult
    public func createConsoleTerminal(
        executablePath: String, argv: [String], cwd: String, onExit: @escaping @Sendable () -> Void
    ) -> TermCommandOutcome {
        let outcome = projection.createTerminal(customize: { cfg in
            cfg.executablePath = executablePath
            cfg.argv = argv
            cfg.cwd = cwd
            cfg.onExit = { _, _ in onExit() }
        })
        if case let .created(terminalId, _) = outcome { installUserWriteHook(termId: terminalId) }
        return outcome
    }

    /// 字号缩放单一入口（DOGFOOD_M3_05；web term.command zoom 与原生「显示」菜单两路归一）：转 hub 全局
    /// 字号广播（逐窗投影步进 + 渲染广播 + 单值持久化 config.terminal.fontSize）。返回新字号。
    @discardableResult
    public func applyZoom(_ dir: UIStateProjection.ZoomDirection) -> Int {
        hub.applyGlobalZoom(dir)
    }

    // MARK: ⌘+/-/0 路由（dogfood-r3 问题5：全页面板缩面板、终端网格缩终端字号）

    /// ⌘+/-/0 单一路由入口（菜单 onZoom / e2e harness 同缝换用）：全页面板在前 → applyPanelZoom；终端网格
    /// 为主视图 → applyZoom。路由判断（读本窗 panelMode/webOverlaySources）属窗内，施加转 hub。
    public func applyZoomRouted(_ dir: UIStateProjection.ZoomDirection) {
        if panelMode != .terminal || !webOverlaySources.isEmpty {
            applyPanelZoom(dir)
        } else {
            applyZoom(dir)
        }
    }

    /// 面板缩放（dogfood-r3 问题5）：转 hub（全局 panelZoom 步进 + 持久化 + fan-out 各窗重推）。返回新值。
    @discardableResult
    public func applyPanelZoom(_ dir: UIStateProjection.ZoomDirection) -> Double {
        hub.applyPanelZoom(dir)
    }

    /// web re-hello（整页刷新/重连，onHandshake 缝）→ 清 overlay 上报残留（对抗验收 MINOR-1）。
    public func noteWebRehello() {
        webOverlaySources.removeAll()
    }

    /// 测试缝：webOverlaySources 当前内容（断言上报置/清/切模式防御清空）。
    var webOverlaySourcesForTest: Set<String> { webOverlaySources }

    /// 默认路径 pin 解析（settings-dogfood 批）：返回「值得抗漂移 pin 的解析目录」——未设（空/仅空白）
    /// → nil；展开 ~ 后非有效目录 → nil（失效视同未设，不把 homePath pin 上去破坏 .zshrc cd 习惯）。
    /// resolveDefaultCwd 的落点语义由 `?? homePath` 组合，两处单一来源。
    nonisolated static func resolveDefaultCwdPin(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let expanded = (trimmed as NSString).expandingTildeInPath
        var isDir: ObjCBool = false
        let ok = FileManager.default.fileExists(atPath: expanded, isDirectory: &isDir) && isDir.boolValue
        return ok ? expanded : nil
    }

    /// 默认终端路径解析（M6 批1，settings-modal.md 终端默认路径）：空/仅空白 → homePath；否则展开 ~ 并校验
    /// 有效目录，失效 → homePath 兜底。nonisolated：纯函数，供 init 闭包与单测在任意上下文调用。
    nonisolated static func resolveDefaultCwd(_ raw: String, homePath: String) -> String {
        resolveDefaultCwdPin(raw) ?? homePath
    }

    /// panelZoom clamp 纯函数（既有 PanelZoomTests 直断兼容缝）：转发 SessionHub（全局 panelZoom 实体在 hub）。
    nonisolated static func clampPanelZoom(_ value: Double) -> Double { SessionHub.clampPanelZoom(value) }

    /// 生产缺省 spawn 模板（既有 ChatCustomTitleWiringTests 直断 extraEnv 兼容缝）：转发 SessionHub。
    static func makeDefaultConfigTemplate(
        configModel: ConfigModel, dataRoot: URL
    ) -> () -> TerminalSession.Config {
        SessionHub.makeDefaultConfigTemplate(configModel: configModel, dataRoot: dataRoot)
    }

    private func mapOutcome(_ outcome: TermCommandOutcome) -> TermCommandResponse {
        switch outcome {
        case let .created(terminalId, pid):
            return .created(terminalId: terminalId, pid: Int(pid))
        case let .closed(terminalId):
            return .closed(terminalId: terminalId)
        case let .zoomed(fontSize):
            return .zoomed(fontSize: fontSize)
        case let .rejected(reason, message):
            return .rejected(code: RejectCode(rawValue: reason.rawValue) ?? .internal, message: message)
        }
    }

    // MARK: ③ ui.action handler（非 layoutReport；layoutReport 归 CompositeRoot 洞几何）

    /// ui.action → 隐含 wait acknowledge 的目标终端（wait-detector.md §3 ☆修订，DOGFOOD_M3_08；供单测）。
    static func impliedWaitAcknowledgeTarget(_ action: UIAction) -> String? {
        switch action {
        case let .tileClick(terminalId), let .sidebarSelect(terminalId),
             let .acknowledgeWaiting(terminalId), let .restoreTile(terminalId):
            return terminalId
        default:
            return nil
        }
    }

    func handleAction(_ action: UIAction) {
        // §3 隐含/显式 acknowledge 单点（☆DOGFOOD_M3_08：sidebarSelect 补入——切过去看了 = 看过了）。
        if let tid = Self.impliedWaitAcknowledgeTarget(action) {
            waitHub.acknowledge(termId: tid)
        }
        switch action {
        case let .tileClick(terminalId):
            projection.selectTile(terminalId)
        case let .sidebarSelect(terminalId):
            projection.selectSidebar(terminalId)
        case let .maximizeTile(terminalId):
            projection.maximizeTile(terminalId)
        case .restoreTiling:
            projection.restoreTiling()
        case .toggleListMode:
            // 视图切换幽灵钮（web→桥；列表模式 dogfood 追加）→ 与原生菜单「显示 → 列表模式」⌘⇧L 同落
            // projection.toggleListMode（List↔Tiling 二态）。projection.onSnapshot 自动重推，无需显式 deliver
            //（与上方 .restoreTiling 同款）。
            projection.toggleListMode()
            onAnalyticsEvent?("term.list_mode", ["on": projection.snapshot().viewMode == .list ? "true" : "false"])
        case .helpOpen:
            openHelpSession()
        case let .minimizeTile(terminalId):
            projection.minimizeTile(terminalId)
            onAnalyticsEvent?("term.minimized", [:])
        case let .restoreTile(terminalId):
            projection.restoreTile(terminalId)
        case .restoreAllMinimized:
            projection.restoreAllMinimized()
        case let .renameSubmit(terminalId, name):
            projection.renameSubmit(terminalId, name: name)
            // M5-R1 批2：customTitle 正向链——反查该终端已绑定的 CC/Codex sessionId，有则写 titlesStore。
            if let titles = chatTitlesStore,
               let sid = activeSessionsStore.readAll()[terminalId]?.sessionId {
                let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                titles.set(sid, title: trimmed.isEmpty ? nil : trimmed)
            }
            // worktree 名持久绑定（worktree-popover.md §5）：cwd 在某 worktree 内 → 名字写 worktree 映射
            // （空串=清除）；主仓/普通目录 cwd 不写（分支列表主行恒显 branch）。与上方 title-sync 平行零共享。
            if let wtNames = worktreeNamesStore,
               let cwd = projection.snapshot().terminals.first(where: { $0.id == terminalId })?.cwd,
               let wtRoot = WorktreeNamesStore.worktreeRoot(forCwd: cwd) {
                let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                wtNames.set(wtRoot, name: trimmed.isEmpty ? nil : trimmed)
            }
        case .acknowledgeWaiting:
            break // acknowledge 已在顶部单点处理
        case let .reorder(order):
            projection.reorder(order)
        case let .gridResize(columnRatios, rowRatios):
            persistGridLayout(columnRatios: columnRatios, rowRatios: rowRatios)
        case .layoutReport:
            break // CompositeRoot 已单独消费洞几何，不应转到此
        case let .searchQuery(terminalId, query):
            terminalSession(terminalId)?.searchSetQuery(query)
        case let .searchNext(terminalId):
            terminalSession(terminalId)?.searchNext()
        case let .searchPrev(terminalId):
            terminalSession(terminalId)?.searchPrev()
        case let .searchClose(terminalId):
            terminalSession(terminalId)?.searchClear()
            if searchBarTerminalId == terminalId {
                searchBarTerminalId = nil
                deliver(projection.snapshot()) // 隐藏搜索条：重推去掉 ui.state.searchBar
            }
        case let .fileOpen(terminalId):
            // 文件夹按钮左键（file-panel.md §0.5）：开面板于该终端 cwd。归属终端不存在则忽略（防悬空）。
            guard registry.session(for: SessionID(raw: terminalId)) != nil else { break }
            filePanelTerminalId = terminalId
            deliver(projection.snapshot()) // 重推带 filePanel 的 ui.state
        case .fileClose:
            filePanelTerminalId = nil
            deliver(projection.snapshot())
        case let .setShowHiddenFiles(value):
            // 眼睛开关持久化到 config（顶层 showHiddenFiles）+ 重推（快照回流为准）。
            if configModel.config.showHiddenFiles != value {
                configModel.updatePrefs { $0.showHiddenFiles = value }
            }
            deliver(projection.snapshot())
        case .chatOpen:
            // M5-R1 批2：顶部 tab 进入聊天历史面板（native 语义 = setPanelMode(.chatHistory)）。
            setPanelMode(.chatHistory)
        case .chatClose:
            // CHAT_L1_14_close native 半（chat-history.md §7.6）：Esc/关闭钮 → 面板回 terminal。
            setPanelMode(.terminal)
        case .exitTaskCenter:
            // DOGFOOD_M3_18：任务中心等待浮卡点正文 → 回 terminal。
            setPanelMode(.terminal)
        case let .chatJumpToTerminal(_, cwd):
            handleChatJump(cwd: cwd)
        case let .chatResume(sessionId, cwd, source, customTitle):
            handleChatResume(sessionId: sessionId, cwd: cwd, source: source, customTitle: customTitle)
        case .confirmQuit:
            // DOGFOOD_M3_19：web 点「退出」→ 与原生 Cmd+Q 确认同落 confirmQuit（清态 + beginShutdown）。
            confirmQuit()
        case .cancelQuit:
            // DOGFOOD_M3_19：web 点「取消」/遮罩/Esc → cancelQuit（清态重推 + reply(false) 存活）。
            cancelQuit()
        case let .panelOverlayReport(source, active):
            // dogfood-r3 问题5：web 本地 overlay 面板/file tabs 视图开合上报（仅 ⌘+/- 路由态，不重推）。
            if active {
                webOverlaySources.insert(source)
            } else {
                webOverlaySources.remove(source)
            }
        case .dismissRestoreBanner:
            // B5 登记6：用户关闭会话恢复横幅 → 隐藏本轮（durable log 仍在盘可查）。
            guard restoreBannerView() != nil else { break }
            restoreBannerDismissed = true
            deliver(projection.snapshot()) // 重推去掉 restoreBanner 的 ui.state
        }
    }

    // MARK: chat 面板动作 native 半（CHAT_L1_18 裁决语义，chat-history.md §7.7）

    /// chatJumpToTerminal（双击卡片跳转 native 半，§7.7② + CHAT_L1_18 裁决）：按 session.cwd 前缀匹配现有
    /// 终端——命中→聚焦跳转（不新开）；无命中→于 cwd 新建；cwd 缺席→仅关面板。**面板无条件关闭**回 terminal。
    private func handleChatJump(cwd: String?) {
        let terminals = projection.snapshot().terminals.map { (id: $0.id, cwd: $0.cwd) }
        switch Self.resolveChatJump(sessionCwd: cwd, terminals: terminals) {
        case let .focus(terminalId):
            projection.selectTile(terminalId)
        case let .createAt(newCwd):
            let outcome = projection.createTerminal(cwd: newCwd)
            if case let .created(terminalId, _) = outcome {
                installUserWriteHook(termId: terminalId)
                // dogfood-r2#4 对抗回修 MAJOR-1：chatJump 新建也是显式 cwd 意图，同挂 cd 钉住注入。
                enqueueCwdPinInjection(termId: terminalId, cwd: newCwd)
            }
        case .closeOnly:
            break
        }
        setPanelMode(.terminal) // §7.7① 无条件关闭面板回 terminal
    }

    /// chatResume（继续聊天 native 半，§7.7 REQ-CHAT_BROWSE-027）：于 session.cwd 新建终端 + customTitle
    /// 继承为标签 + 复用 M4b 注入路径把 sessionId 恢复上下文 + 关面板。
    private func handleChatResume(sessionId: String, cwd: String, source: ChatSource, customTitle: String?) {
        guard case let .created(terminalId, _) = projection.createTerminal(cwd: cwd) else {
            setPanelMode(.terminal) // maxReached/invalidCwd → 静默跳过（同 chatJump），面板仍无条件关闭
            return
        }
        // customTitle 继承为新终端标签（§7.7）。
        if let title = customTitle, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            projection.renameSubmit(terminalId, name: title)
        }
        switch source {
        case .claudeCode where TerminalRestoreGate.isValidSessionId(sessionId):
            enqueueChatResumeInjection(termId: terminalId, cwd: cwd, sessionId: sessionId, harness: .claude)
        case .codex where TerminalRestoreGate.isValidSessionId(sessionId):
            enqueueChatResumeInjection(termId: terminalId, cwd: cwd, sessionId: sessionId, harness: .codex)
        case .claudeCode, .codex:
            // 非法 sessionId（任一 source）→ 纯新建，装常规 onUserWrite。
            installUserWriteHook(termId: terminalId)
        }
        setPanelMode(.terminal) // §7.7① 无条件关闭面板回 terminal
    }

    /// 继续聊天注入（§7.7）：用户主动发起的 resume——复用崩溃恢复注入器（静默门 + 人键 abort），但**不** seed
    /// 锚点/不计 crash-loop/不落自动恢复取证。
    private func enqueueChatResumeInjection(
        termId: String, cwd: String, sessionId: String, harness: ResumeCommand.Harness
    ) {
        guard let session = registry.session(for: SessionID(raw: termId)) else { return }
        let flag = installRestoreUserWriteHook(termId: termId)
        let baseline = session.lastOutputMs
        let throttle = injectionThrottle
        let gate = ensureResumable       // 仅 .claude 过闸；nil = 恒 proceed（零行为变化）
        let feedback = onChatResumeFeedback
        let injectedCwd = Self.normalizeInjectedCwd(cwd) // F-B：注入 cd 落点归一
        let obsBox = resumeInjectionObservation
        let task = Task.detached { [weak session] in
            guard let session else { return }
            // chatResume 归档回填闸（仅 .claude harness；.codex 无归档回填、不过闸恒注入）。
            if harness == .claude, let gate, case let .block(code) = gate(sessionId) {
                if let feedback { DispatchQueue.main.async { feedback(sessionId, code) } }
                return
            }
            let injected = await throttle.run {
                await InitialCommandInjector.run(
                    cwd: cwd, sessionId: sessionId, harness: harness, baselineMs: baseline,
                    lastOutput: { session.lastOutputMs }, write: { session.write($0) },
                    humanInputArrived: { flag.value },
                    sizeReady: { session.hasReceivedResize }) // 尺寸就绪门（登记⑩）
            }
            if injected {
                session.noteInjectedCwd(injectedCwd)
                Self.noteResumeInjectionLanded(box: obsBox, termId: termId, session: session)
            }
        }
        restoreInjectionTasks.append(task)
    }

    /// cwd 钉住注入（dogfood-r2#4 根因 B；worktree-popover.md §4 契约改写）：`term.command create{cwd}`
    /// 建成后经静默门补写 `cd -- '<cwd>' && clear`——镜像 enqueueRestoreInjection 三件套。
    private func enqueueCwdPinInjection(termId: String, cwd: String) {
        guard let session = registry.session(for: SessionID(raw: termId)) else { return }
        let flag = installRestoreUserWriteHook(termId: termId)
        let baseline = session.lastOutputMs
        let throttle = injectionThrottle
        let injectedCwd = Self.normalizeInjectedCwd(cwd)
        let task = Task.detached { [weak session] in
            guard let session else { return }
            let injected = await throttle.run {
                await CwdPinInjector.run(
                    cwd: cwd, baselineMs: baseline,
                    lastOutput: { session.lastOutputMs }, write: { session.write($0) },
                    humanInputArrived: { flag.value || session.hasExited })
            }
            if injected { session.noteInjectedCwd(injectedCwd) }
        }
        restoreInjectionTasks.append(task)
    }

    /// R2.5 首绑补写（hub.chatTitleBackfill → fan-out → 本窗）：终端首次绑定/更换 sessionId 时，若该终端已有
    /// customName 且该 sid 尚无 title → 补写 titlesStore。无该 termId（外来窗）→ no-op。internal 供单测直调。
    func applyChatTitleBackfill(termId: String, sessionId: String) {
        guard let titles = chatTitlesStore else { return }
        guard titles.get(sessionId) == nil else { return } // 已有 title（正向链已写）→ 不覆盖
        guard let name = projection.snapshot().terminals.first(where: { $0.id == termId })?.customName,
              !name.isEmpty else { return } // 无 customName（或非本窗终端）→ 无可补写
        titles.set(sessionId, title: name)
    }

    /// 反向同步（聊天卡重命名 → 终端 tile 名；chat-history.md W8 双向语义）：该 sessionId 正锚定在还开着的
    /// 终端 → 同步改 tile 名。public：AppDelegate + e2e harness 两处消费。
    public func applyChatTitleToAnchoredTerminal(sessionId: String, title: String?) {
        let gridIds = Set(projection.snapshot().terminals.map(\.id))
        guard let termId = Self.pickReverseRenameTarget(
            anchors: activeSessionsStore.readAll(), sessionId: sessionId, gridIds: gridIds)
        else { return }
        projection.renameSubmit(termId, name: title ?? "")
    }

    /// 反向同步落点选择（纯函数，供单测直断 MINOR-4/5 边角）：滤 sid 匹配 ∩ grid（projection 维序）成员，
    /// 取 (lastActiveTs, termId) 字典序最大——ts 主序、termId 稳定 tie-break。
    static func pickReverseRenameTarget(
        anchors: [String: TerminalSessionAnchor], sessionId: String, gridIds: Set<String>
    ) -> String? {
        anchors
            .filter { $0.value.sessionId == sessionId && gridIds.contains($0.key) }
            .max(by: { ($0.value.lastActiveTs, $0.key) < ($1.value.lastActiveTs, $1.key) })?
            .key
    }

    // MARK: - 测试缝（@testable；生产事件走 HookSocketListener / record 闭包，本缝不改生产路径）

    /// 登记⑩测试缝：最近一次 resume/恢复注入落地时的会话网格与尺寸就绪态（装配级断言面）。
    public var lastResumeInjectionForTest: ResumeInjectionObservation? { resumeInjectionObservation.value }

    /// 观测当前会话锚点快照（测试断言 anchor 已绑定）。
    var chatAnchorsForTest: [String: TerminalSessionAnchor] { activeSessionsStore.readAll() }

    /// F-B 测试缝：驱一次 cwd 轮询（生产由心跳按 §5 ~1s 调 `projection.refreshCwds`）。
    func refreshCwdsForTest() { projection.refreshCwds() }

    /// F-B 测试缝：读投影快照各终端 cwd（id→cwd；projection private）。header 即渲此 cwd。
    var cwdsForTest: [String: String] {
        Dictionary(uniqueKeysWithValues: projection.snapshot().terminals.map { ($0.id, $0.cwd) })
    }

    /// 注入一条合成 hook 锚点事件驱真采集链（SessionTracker.record → 锚点更新 + R2.5 首绑补写触发）。
    func injectHookAnchorEventForTest(termId: String, sessionId: String, cwd: String, transcript: String) {
        let obj: [String: Any] = ["session_id": sessionId, "cwd": cwd, "transcript_path": transcript]
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let raw = String(data: data, encoding: .utf8) else { return }
        waitBus.publish(WaitEvent(termId: termId, event: .notification, ts: WaitClock.nowMs(), raw: raw))
    }

    /// chatJumpToTerminal 决策（纯函数，供单测；CHAT_L1_18 裁决语义 §7.7②）。
    nonisolated static func resolveChatJump(
        sessionCwd: String?, terminals: [(id: String, cwd: String)]
    ) -> ChatJumpDecision {
        guard let sessionCwd, !sessionCwd.trimmingCharacters(in: .whitespaces).isEmpty else {
            return .closeOnly
        }
        if let match = terminals.first(where: {
            cwdPrefixMatches(sessionCwd: sessionCwd, terminalCwd: $0.cwd)
        }) {
            return .focus(terminalId: match.id)
        }
        return .createAt(cwd: sessionCwd)
    }

    /// cwd 前缀匹配（CHAT_L1_18 裁决语义 §7.7②，纯函数供单测）：**终端 cwd 以 session.cwd 为前缀或相等**
    /// 即「对应项目终端」。按路径分量边界匹配；两侧去尾斜杠归一。空 session.cwd 恒不命中。
    nonisolated static func cwdPrefixMatches(sessionCwd: String, terminalCwd: String) -> Bool {
        let base = normalizeCwd(sessionCwd)
        let term = normalizeCwd(terminalCwd)
        guard !base.isEmpty else { return false }
        return term == base || term.hasPrefix(base + "/")
    }

    /// 去尾斜杠归一（根 "/" 保留），供前缀匹配路径分量边界判定。
    nonisolated private static func normalizeCwd(_ path: String) -> String {
        var s = path
        while s.count > 1, s.hasSuffix("/") { s.removeLast() }
        return s
    }

    /// 注入 cd 落点归一（F-B）：与 `UIStateProjection.createTerminal` 存 `cwds[id]` 的口径对齐 + 去尾斜杠。
    nonisolated private static func normalizeInjectedCwd(_ cwd: String) -> String {
        normalizeCwd((cwd as NSString).expandingTildeInPath)
    }

    // MARK: 面板模式切屏（task-center-panel.md §1；菜单 → AppDelegate detach → 本 setter 权威态+重推）

    /// 切面板模式（terminal|taskCenter|chatHistory）：置权威态 + 重推带 panelMode 的 ui.state。硬序①：切入非
    /// terminal 全窗面板先主动 detach 全 surface（onWillEnterFullPanel 缝，装配层注入）再翻态。
    public func setPanelMode(_ mode: PanelMode) {
        guard panelMode != mode else { return }
        if mode != .terminal { onWillEnterFullPanel?() } // 硬序①：先 detach 后翻态
        panelMode = mode
        // dogfood-r3 问题5 防残留兜底：切屏时防御清空 web overlay 上报（防 ⌘+/- 误路由到面板缩放）。
        webOverlaySources.removeAll()
        deliver(projection.snapshot()) // 重推 ui.state（mapSnapshot 恒置 panelMode = 新权威态）
    }

    /// 文件面板是否打开（AppDelegate ⌘E 后据此决定是否把 firstResponder 交 WKWebView）。
    public var isFilePanelOpen: Bool { filePanelTerminalId != nil }

    /// ⌘E（AppDelegate 菜单）→ toggle 文件面板：开=当前 selected/focused 终端、关=清。无终端 no-op。
    public func toggleFilePanel() {
        if filePanelTerminalId != nil {
            filePanelTerminalId = nil
        } else {
            let snap = projection.snapshot()
            guard let target = snap.selectedId ?? snap.focusedId else { return } // 无终端 no-op
            filePanelTerminalId = target
        }
        deliver(projection.snapshot())
    }

    /// ⌘⇧L（AppDelegate 菜单「显示 → 列表模式」）→ toggle 列表模式（term-list-mode.md）：projection 翻
    /// List↔Tiling + 立即重推 ui.state。纯原生菜单动作、非桥消息（零协议 action 新增）。
    public func toggleListMode() {
        projection.toggleListMode()
        deliver(projection.snapshot())
        onAnalyticsEvent?("term.list_mode", ["on": projection.snapshot().viewMode == .list ? "true" : "false"])
    }

    /// 重推当前 ui.state（M6 批1）：偏好变更（如 theme）经 ConfigModel.onPrefsChanged 调，令 web 拾取新值。
    public func republishState() {
        deliver(projection.snapshot())
    }

    /// Cmd+F（surface 视图 onRequestSearch）→ 打开该终端搜索条：置归属终端 + 立即重推 ui.state。
    public func openSearchBar(terminalId: String) {
        guard registry.session(for: SessionID(raw: terminalId)) != nil else { return }
        searchBarTerminalId = terminalId
        deliver(projection.snapshot())
    }

    /// terminalId（= SessionID.raw）→ 活会话；无则 nil（搜索动作对已关终端 no-op）。
    private func terminalSession(_ terminalId: String) -> TerminalSession? {
        registry.session(for: SessionID(raw: terminalId))
    }

    // MARK: 退出确认漏斗（DOGFOOD_M3_19；legacy AppCloseConfirmDialog 对等，薄 UI overlay 态照 searchBar/panelMode）

    /// AppDelegate.applicationShouldTerminate 拦截入口：置 quitConfirm 待决态（terminalCount 读 registry）+ 推
    /// ui.state.quitConfirm + 注册确认/取消回调，**不 beginShutdown**。**幂等**：待决期间重复 quit 保持首回调。
    @discardableResult
    public func requestQuitConfirm(
        onConfirmed: @escaping () -> Void, onCancelled: @escaping () -> Void
    ) -> Bool {
        guard quitConfirmPending == nil else { return true } // 已待决 → 保持首回调，仍 return true
        onQuitConfirmed = onConfirmed
        onQuitCancelled = onCancelled
        quitConfirmPending = QuitConfirm(terminalCount: registry.count)
        deliver(projection.snapshot()) // 推 ui.state.quitConfirm → web 弹对话框
        return true
    }

    /// 确认退出（ui.action.confirmQuit / web 点「退出」）：清待决态 + 触发 onConfirmed。无待决 → no-op。
    public func confirmQuit() {
        guard quitConfirmPending != nil else { return }
        let onConfirmed = onQuitConfirmed
        clearQuitConfirmState()
        onConfirmed?()
    }

    /// 取消退出（ui.action.cancelQuit / 点「取消」/点遮罩 / Esc）：清待决态 + 重推 ui.state + 触发 onCancelled。
    public func cancelQuit() {
        guard quitConfirmPending != nil else { return }
        let onCancelled = onQuitCancelled
        clearQuitConfirmState()
        deliver(projection.snapshot()) // 重推去掉 quitConfirm → web 撤下对话框
        onCancelled?()
    }

    /// 清退出确认待决态与回调（confirm/cancel 共用）：置 nil 断开 AppDelegate↔service 临时强引用环。
    private func clearQuitConfirmState() {
        quitConfirmPending = nil
        onQuitConfirmed = nil
        onQuitCancelled = nil
    }

    /// gridResize 分隔条释放 → 持久化本窗网格比（桥草案 §3.3，有意增强：legacy 不持久化）。多窗下写本窗
    /// 分组（裁决⑪每窗独立 gridLayout）+ 镜像首窗回顶层（§4.3）；旧单窗路径写顶层扁平（向后兼容）。
    private func persistGridLayout(columnRatios: [Double], rowRatios: [Double]) {
        let grid = MuxvoConfig.GridLayout(columnRatios: columnRatios, rowRatios: rowRatios)
        configModel.update { config in
            if let wid = windowId {
                config.upsertWindowEntry(windowId: wid, number: windowNumber) { $0.gridLayout = grid }
            } else {
                config.gridLayout = grid
            }
        }
    }

    // MARK: - SessionHubWindow（批C C2）：hub 心跳/registry/wait/字号广播 → 本窗投影
    //
    // fan-out 落点（§2）：hub 逐成员转发，本窗投影用 order.contains 守卫天然丢外来 id。C2 单窗 = 直调。

    public func hubFlushProjection() { projection.flush() }
    public func hubRefreshCwds() { projection.refreshCwds() }
    public func hubSampleMinimizedLastLines() { sampleMinimizedLastLines() }
    public func hubEnsureBackgroundSized() { ensureBackgroundSized() }
    public var hubLiveTerminalIds: [String] { projection.liveTerminalIds }
    public func hubNoteRegistryStateChange(_ id: SessionID, _ state: MuxvoTermCore.TerminalState) {
        projection.noteStateChange(id, state)
    }
    public func hubNoteWaiting(_ id: SessionID, _ source: WaitSource?) {
        projection.noteWaiting(id, source)
    }
    public func hubRedeliver() { deliver(projection.snapshot()) }
    public func hubApplyChatTitleBackfill(termId: String, sessionId: String) {
        applyChatTitleBackfill(termId: termId, sessionId: sessionId)
    }
    /// 全局字号广播半（§5.1）：本窗投影步进字号 + 渲染层广播，返回新字号（hub 据此单值持久化）。
    public func hubStepFontZoom(_ dir: UIStateProjection.ZoomDirection) -> Int {
        _ = projection.zoom(dir)
        let size = projection.fontSize
        onFontSizeChanged?(size)
        return size
    }
}

/// chatJumpToTerminal 决策（CHAT_L1_18 裁决语义 §7.7②，TerminalService.resolveChatJump 产出）。
enum ChatJumpDecision: Equatable {
    /// cwd 前缀命中已开终端 → 聚焦跳转（不新开）。
    case focus(terminalId: String)
    /// 无命中 → 于 session.cwd 新建终端。
    case createAt(cwd: String)
    /// cwd 缺席/空白 → 仅关面板。
    case closeOnly
}
