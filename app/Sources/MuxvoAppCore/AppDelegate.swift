import AppKit
import MuxvoAuth
import MuxvoBridge
import MuxvoChatHistory
import MuxvoConfigCenter
import MuxvoDatabase
import MuxvoKit
import MuxvoPerf
import MuxvoStorage
import MuxvoTerm
import MuxvoTermRender
import MuxvoUpdater
import UserNotifications

@MainActor
public final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    public override init() { super.init() }

    // 启动成功后换成 LifecycleShutdownCoordinator；启动失败路径保持 Noop（单退出路径不破坏）
    private var shutdownCoordinator: any ShutdownCoordinating = NoopShutdownCoordinator()
    /// 批C C2：全局共享子系统（registry/wait 族/恢复层/gitCache/dockBadge/心跳/字号/chat 注入配置）。
    private var sessionHub: SessionHub?
    /// 批C C2：全部窗口上下文装配件（C2 恒 1 窗）。菜单/快捷键经 activeContext 惰性解析。
    /// 全部窗口上下文装配（multi-window.md §1）。internal（非 private）：D1 呼出路由单测
    /// MW_summon_routes_active_window 注入两窗 wm 断言 routeSummon 落最近活跃窗（裁决⑥）。
    var windowManager: WindowManager?
    /// 当前活跃窗控制器（§6.1 activeContext 解析；C2 = 首窗）。惰性经 windowManager。
    private var mainWindowController: MainWindowController? { windowManager?.activeContext?.windowController }
    // checkpoint step 在 start() 时注册、DB 在 start() 后打开：holder 桥接时序（未装入则 step no-op）
    private let databaseHolder = DatabaseHolder()
    /// 编排装配单缝（开源前置重构第 2 步）：TaskService/bus/崩溃和解/OrchAssembly/指挥台/监视器/恢复横幅
    /// 全在缝内。公开仓 OrchLauncherFactory.make 返 nil → 全部委托 no-op（编排物理剔除，终端照常）。
    private var orchLauncher: (any OrchLauncher)?
    /// 当前活跃窗的终端服务（§6.1 activeContext 解析；C2 = 首窗）。菜单/快捷键闭包经此惰性路由。
    private var terminalService: TerminalService? { windowManager?.activeContext?.service }
    /// config.json 单写者中枢（M6 批1）：TerminalService 与 config.request 偏好处理器共享同一实例。
    private var configModel: ConfigModel?
    /// 配置面处理器 + 数据中枢 + 资源 watcher（M6 批1）。强持有保活（桥闭包只 weak 引 composite）。
    private var configCenter: ConfigCenter?
    private var configRequestHandler: ConfigRequestHandler?
    private var appRequestHandler: AppRequestHandler?
    // 账号面（右上角批 B5）：app 级单例 + auth 变体薄路由（强持有；composite 闭包弱捕获）。
    private var authManager: AuthManager?
    private var authRouter: AuthRequestRouter?
    private var resourceWatcher: ResourceWatcher?
    /// 自动更新装配（auto-update.md）：生产启用门内强持有（controller/engine/prompter/dock/sink）；
    /// dev 门外 = nil（AppRequestHandler updateActions=nil = legacy dev no-op 对等）。
    private var updateServices: UpdateServices?
    private var whatsNewService: WhatsNewService?
    /// M7 批4 内存监控：每 60s 采样进程常驻内存，超 2GB 推 data.event memoryWarning（PERF_L2_01/02）。
    private var memoryMonitor: MemoryMonitor?
    /// 更新「立即重启」旁路（auto-update.md §4；legacy forceClose=true 对等）：Sparkle 安装触发的
    /// terminate 不弹退出确认（autopilot/真用户点了立即重启=已明示要走），仍走优雅关停序。
    private var updateInstallBypassesQuitConfirm = false
    /// Chat 面装配（M5 批3）。装配失败 = nil（降级：chat 面回 rejected、终端照常）。强持有保活。
    private var chatAssembly: ChatAssembly?
    /// 聊天自定义标题 store（M5-R1 批2）：同一实例注入 TerminalService（重命名正向链/首绑补写）与
    /// ChatQueryEngine（customTitle wire 叠加 + setTitle/delete）。
    private var chatTitlesStore: ChatCustomTitlesStore?
    /// 归档开关上次已施加值（M5-R1 批2）：onPrefsChanged 对任意偏好变更都触发，仅 archiveEnabled 真变才
    /// 转调 archiveToggled（仿 TerminalService.lastAppliedTerminalThemeName 守卫惯例）。
    private var lastChatArchiveEnabled = true
    /// chatResume 回填失败弹窗缝（M5-R1 批2；测试注入假闭包断言触达，不真弹窗）。默认 NSAlert：
    /// 标题「无法恢复会话」+ code 对应文案（归档缺失/回填失败）。
    var presentChatResumeAlert: @MainActor (_ sessionId: String, _ code: String) -> Void = { _, code in
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "无法恢复会话"
        alert.informativeText = AppDelegate.chatResumeAlertMessage(code: code)
        alert.runModal()
    }
    /// 数据根本次 bootstrap 新建（verdict==freshInstall）：老版用户引导豁免的一次性门（welcome-overlay.md §5）。
    private var isFreshInstall = false
    /// 生产通知设施（批4 波3b R2；@MainActor：Dock/系统通知）。用量预警（limitApproaching，共享）+ 编排
    /// 四类通知（经 OrchLauncher）统一收口；非 bundle 静默降级不崩。AppDelegate 强持有（用量预警直用）。
    private var orchNotifier: OrchNotifier?
    /// 主菜单命令归口（字号缩放，DOGFOOD_M3_05）。强持有：NSMenuItem.target 是 weak，须由此保活。
    private var menuCommands: AppMenuCommands?
    /// CC 用量预警（usage-limit-alert.md §6）：statusLine 传感器安装器（菜单触发，启动只读自检）+
    /// 15s 轮询监测器（常开，文件缺失 no-op）。强持有保活 timer。
    private var statusLineInstaller: StatusLineInstaller?
    /// WaitDetector hook 安装器（wait-detector.md §7）：设置面板 hookStatus/hookEnable 请求的落点。
    /// 禁装门开（MuxvoHookInstallDisabled）= 恒 nil——面板 disabled 态的唯一来源。
    private var hookInstaller: HookInstaller?
    private var usageLimitWatcher: UsageLimitWatcher?
    /// fs.request 分发路由（M6 批A）。强持有：CompositeRoot.onFsRequest 弱捕获它。
    private var fsRouter: FsRequestRouter?
    /// 埋点装配（analytics.md，埋点批2）：tracker + 桥落点 + 原生事件入口。dev/test 启用门关 = 全 no-op。
    private var analytics: AnalyticsAssembly?

    public func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            // 七步固定序：lock → bootstrap → verdict → 删标志 → 清扫 tmp → 崩溃路径处理 → session
            let dataRoot = DataDirectory.defaultDevRoot()
            let session = try AppLifecycle.start(
                configuration: LifecycleConfiguration(
                    dataDirectoryRoot: dataRoot,
                    // 崩溃恢复路径先跑 quick_check，再收割上次崩溃残留的孤儿 PTY（terminal-session.md §7.2）。
                    integrityChecks: [
                        MuxvoDatabase.quickCheckIntegrityCheck(),
                        PtyChildrenStore.orphanReaperCheck(),
                    ],
                    // 关停序（§7.1）：先 pty-close-all 保 PTY 全静默，再 wal-checkpoint。
                    shutdownSteps: [
                        PtyChildrenStore.closeAllShutdownStep(root: dataRoot),
                        MuxvoDatabase.checkpointShutdownStep(databaseHolder),
                    ]
                )
            )
            Log.app.notice("lifecycle 启动完成 verdict=\(String(describing: session.verdict), privacy: .public)")
            shutdownCoordinator = LifecycleShutdownCoordinator(session: session)

            // DB 打开失败也走单退出路径（coordinator 已接真；holder 空 → checkpoint step no-op，
            // 其余 step 照跑、flag 照写——退出本身是干净的）
            let db = try MuxvoDatabase.open(at: session.dataDirectory.sessionDatabaseURL)
            databaseHolder.install(db)
            isFreshInstall = session.verdict == .freshInstall
            // 编排装配单缝（开源前置重构第 2 步）：建 launcher（公开仓 stub 返 nil）+ 交 DB——TaskService/bus
            // 创建 + 崩溃和解（running→queued + 恢复横幅计数）全在缝内（公开仓无编排、崩溃恢复仅 DB 完整性
            // 检查 + 孤儿 PTY 收割，无任务和解，终端照常）。
            orchLauncher = OrchLauncherFactory.make(context: makeOrchLauncherContext())
            orchLauncher?.attachDatabase(
                db, dataRoot: dataRoot, crashRecovery: session.verdict == .crashRecovery)
        } catch {
            presentStartupFailureAlert(error)
            NSApp.terminate(nil) // coordinator 仍是 Noop → 仍走 applicationShouldTerminate 单路径
            return
        }
        buildMenu()

        // 启动装配（批4③）：ConfigStore 载入 → TerminalService（ui.state 真状态源）起
        // startupTerminalCount 个真终端于 homePath（挂 pty-children 账本 record/remove）→ 真 provider
        // 共享其 registry。默认路径 = 真数据推 ui.state 走洞分支；MUXVO_COMPOSITE_DEMO=1 冒烟通道保留
        // （推合成 ui.state，不启真状态源心跳，避免与合成态争推）。
        let dataRootURL = DataDirectory.defaultDevRoot()
        // guide.md 每启覆盖拷入数据根（右上角批 B3，帮助会话注入引用此路径；源缺只 .notice 不阻启动）。
        GuideProvisioner.provision(dataRoot: dataRootURL)
        // 埋点装配（analytics.md §1/§2，埋点批2）：置于 update/auth 装配之前（其嗅探缝构建时需已在）。
        // 启用门关（dev/test 无 plist 键）= tracker 全 no-op，挂线照常零分支。
        analytics = AnalyticsAssembly(dataRoot: dataRootURL)
        let configStore = ConfigStore(
            configFileURL: dataRootURL.appendingPathComponent(ConfigStore.configFileName))
        // 单写者中枢（M6 批1）：一份 ConfigModel 同时喂 TerminalService 与（步骤4）config.request 处理器。
        let sharedConfigModel = ConfigModel(store: configStore)
        configModel = sharedConfigModel
        // 老版用户豁免新手引导（welcome-overlay.md §5，用户拍板 2026-07-16）：新版首启（数据根 fresh）
        // 且在场老版数据踪迹（~/.muxvo）→ 预置 tourCompleted=true 落盘——老版升级用户不当新人弹引导。
        // 仅 fresh 一次性（此后 config 已带值，重启不再进此分支）；update(_:) 不触发 onPrefsChanged 无副作用。
        if Self.shouldExemptTourForLegacyUser(
            freshInstall: isFreshInstall,
            legacyTraceExists: FileManager.default.fileExists(atPath: Self.legacyTracePath()),
            tourCompleted: sharedConfigModel.config.tourCompleted)
        {
            sharedConfigModel.update { $0.tourCompleted = true }
            Log.app.notice("老版数据踪迹在场（fresh 首启）→ tourCompleted 预置 true（升级用户豁免引导）")
        }
        let config = sharedConfigModel.config
        // M5-R1 批2 装配：自定义标题 store（TerminalService 与 ChatQueryEngine 共用同一实例）+ chatResume
        // 归档回填闸（chat-history.md §7.7 native 回填契约）：注入前 ChatRestore 镜像→CC 单向回填，
        // Outcome→verdict 纯函数映射；block → 跳过注入 + 主线程弹「无法恢复会话」（弹窗缝可注入）。
        let titlesStore = ChatCustomTitlesStore(root: dataRootURL)
        chatTitlesStore = titlesStore
        // worktree 自定义名 store（worktree-popover.md §5）：SessionHub（renameSubmit 写）与
        // InteractiveWorktreeService（statusSync join 读 + create/remove 清理）共用同一实例。
        // 启动回填（存量升级）：store 引入前已命名的持久化 tile（顶层扁平 + 各窗分组）补进映射（只补缺）。
        let worktreeNames = WorktreeNamesStore(root: dataRootURL)
        let persistedTerminals = sharedConfigModel.config.openTerminals
            + sharedConfigModel.config.windows.flatMap(\.openTerminals)
        worktreeNames.backfill(from: persistedTerminals.compactMap { t in
            (t.customName?.isEmpty == false) ? (cwd: t.cwd, name: t.customName!) : nil
        })
        lastChatArchiveEnabled = config.chatArchiveEnabled
        let chatRestore = ChatRestore(
            mirrorRoots: [
                DataDirectory.sharedChatHistoryRootURL(),                    // dogfood-r5 PR-4：共享归档池优先
                DataDirectory.chatHistoryDirectoryURL(under: dataRootURL),   // per-分身 legacy 兜底
            ],
            ccProjectsRoot: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".claude/projects", isDirectory: true))
        // 批C C2「共享层抽取」：全局共享 SessionHub 收 registry/wait 族/hook socket/恢复层/gitCache/
        // dockBadge/心跳/全局字号·panelZoom/chat 注入配置。各窗瘦身 TerminalService 经 WindowManager 注入
        // 共享 hub（本窗 UIStateProjection/searchBar/panelMode/quitConfirm/mapSnapshot/本窗 persist）。
        // C2 仍只 1 窗——外部行为与劈开前逐位一致。
        let hub = SessionHub(
            configModel: sharedConfigModel,
            ptyChildrenStore: PtyChildrenStore(root: dataRootURL),
            homePath: NSHomeDirectory(),
            dataRoot: dataRootURL,
            chatTitlesStore: titlesStore,
            worktreeNamesStore: worktreeNames,
            ensureResumable: { sid in Self.chatResumeVerdict(chatRestore.restore(sessionId: sid)) },
            onChatResumeFeedback: makeChatResumeFeedback())
        sessionHub = hub
        let wm = WindowManager(hub: hub)
        windowManager = wm
        // 新窗完整竖切接线钩子（multi-window.md §1）：⌥⌘N 建窗后把该窗 composite 接到共享编排/聊天/配置/fs
        // 处理器（AppDelegate 持有单实例；首窗接线内联在下方，新窗经此复用同款）。
        wm.configureNewWindow = { [weak self] ctx in self?.wireNewWindowComposite(ctx) }

        // WaitDetector Layer 0 安装 UX（wait-detector.md §7）。启动自检只读 ~/.claude/settings.json +
        // 脚本在位/指纹，NSLog drift 提示。启动路径写真文件的**唯一授权例外 = fresh 首启四条件门**
        // （§7 首启自动启用，2026-07-17 产品口径：真实单实例用户无感开箱即用）；其余写入仍须显式
        // 授权（env MUXVO_HOOK_PROMPT=1 弹授权卡 / 设置面板按钮），常规非 fresh 启动/测试永不写。
        // 禁装门（§7）：短命测试分身整体退出 hook 面（不自检、不弹、自动装/env 门也不装），
        // 防认领他分身授权 + 数据根被重置清空后「中继脚本缺失」重启用死循环（2026-07-16 真机）。
        if HookInstaller.installDisabled(
            plistValue: Bundle.main.object(forInfoDictionaryKey: HookInstaller.installDisabledKey)) {
            NSLog("[muxvo] hook 装配整体跳过（Info.plist \(HookInstaller.installDisabledKey)）")
        } else {
            let installer = HookInstaller(
                settingsURL: FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent(".claude/settings.json"),
                dataRoot: dataRootURL)
            hookInstaller = installer // 存储属性保活：设置面板 hookStatus/hookEnable 请求落点（§7）
            // opt-out / 轻提示接缝接 config store（§7）：停用记档 + 首启自动装一次性提示位。
            installer.readUserOptOut = { [weak sharedConfigModel] in
                sharedConfigModel?.config.hookUserDisabled ?? false
            }
            installer.writeUserOptOut = { [weak sharedConfigModel] disabled in
                guard let model = sharedConfigModel,
                      model.config.hookUserDisabled != disabled else { return }
                model.update { $0.hookUserDisabled = disabled }
            }
            installer.consumeAutoEnableNoticeFlag = { [weak sharedConfigModel] in
                guard let model = sharedConfigModel,
                      model.config.hookAutoEnabledNoticePending else { return false }
                model.update { $0.hookAutoEnabledNoticePending = false }
                return true
            }
            installer.logStartupSelfCheck()
            if ProcessInfo.processInfo.environment["MUXVO_HOOK_PROMPT"] == "1" {
                installer.promptAndInstallIfNeeded()
            } else {
                // 首启静默自动启用（§7 四条件门：fresh ∧ notInstalled ∧ 无他分身绑定 ∧ 未曾停用）
                // ——真实单实例用户提醒功能无感就位；成功置一次性轻提示 pending（web 首查即消费）。
                // 未装（任一条件不满足/失败静默降级）则照旧走 drift 重启用提示。两态互斥：自动装
                // 只在 notInstalled 触发，drift 提示只在 drift 触发。
                if installer.autoInstallIfEligible(isFreshInstall: isFreshInstall) {
                    sharedConfigModel.update { $0.hookAutoEnabledNoticePending = true }
                } else {
                    // drift 重启用提示（§7「提示重新启用而非静默重写」；对抗回修 MAJOR-1）：仅曾授权
                    // （已有**本根** muxvo hook 组，§7 单绑定）且 drift 时弹——hook 组升级（如
                    // SessionStart 加装）后本分身老安装缺新事件的启动激活入口；全新用户/仅他分身
                    // 绑定在场均不打扰（显式启用走设置面板/env）。
                    installer.promptReenableOnDriftIfAuthorized()
                }
            }
        }

        // CC 用量预警装配（usage-limit-alert.md §6）：notifier 提升为启动期单例（orch 装配复用同实例，
        // 编排装配失败时预警仍可用）；installer 启动只读自检（安装仅菜单/env 显式触发，绝不自动写真
        // 文件）；watcher 常开（未安装=文件缺失 no-op，中途启用无需重启）。notify = 系统横幅+Dock
        // （OrchNotifier 第五类）+ app 内非阻塞弹窗（§5 双保险，用户拍板 2026-07-11）。
        let notifier = OrchNotifier()
        orchNotifier = notifier
        let claudeJSONURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude.json")
        let usageAssembly = UsageAlertAssembly.make(
            settingsURL: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".claude/settings.json"),
            dataRoot: dataRootURL,
            makeTimer: RealDockBadge.makeTimer,
            notify: { [weak self] alert in
                // 判层日志（真机冒烟抓手，沿 resume 注入落地 .notice 先例）：链路走到组合根出口即落此行。
                NSLog("[muxvo] 用量预警触发 window=\(alert.window.rawValue) pct=\(alert.usedPct) level=\(alert.level) resetsAt=\(alert.resetsAt)")
                let email = ClaudeAccountInfo.email(claudeJSONURL: claudeJSONURL)
                self?.orchNotifier?.limitApproaching(alert: alert, accountEmail: email)
                self?.presentUsageAlertSheet(alert: alert, accountEmail: email)
            })
        statusLineInstaller = usageAssembly.installer
        usageLimitWatcher = usageAssembly.watcher
        usageAssembly.installer.logStartupSelfCheck()
        if ProcessInfo.processInfo.environment["MUXVO_STATUSLINE_PROMPT"] == "1" {
            usageAssembly.installer.promptAndInstallIfNeeded()
        }
        // 建首窗（multi-window.md §1.3 多窗还原）：读 config.windows[]（旧扁平 config → windowsForRestore
        // 合成单窗，§4.2 迁移）逐 entry 建窗。首窗 seed 本窗分组（**不跑恢复层**——聚合层 §1.3 一次 planRestore）
        // + 还原 frame/编号 → 再建 controller → showWindow。其余窗待共享处理器就位后建（下方 restoreAdditional…）。
        let restoreEntries = config.windowsForRestore(firstWindowId: "w1")
        let (ctx, startupIds) = wm.makeFirstWindowForRestore(
            entry: restoreEntries[0],
            onCloseRequested: { NSApp.terminate(nil) })
        let service = ctx.service
        let controller = ctx.windowController
        // 切入非 terminal 全窗面板前的主动 detach（单一缝，TerminalService.setPanelMode 内触发；M5-R1
        // 批4 顺修）：菜单与 web ui.action（chatOpen 等）共走。惰性经 activeContext 解引用（仅 setPanelMode 触）。
        service.onWillEnterFullPanel = { [weak self] in
            self?.mainWindowController?.compositeRoot.detachAllSurfacesForPanelMode()
        }
        NSApp.activate(ignoringOtherApps: true)

        if ProcessInfo.processInfo.environment["MUXVO_COMPOSITE_DEMO"] == "1" {
            controller.compositeRoot.pushCompositeDemoStateIfEnabled(
                terminalIds: startupIds, homePath: NSHomeDirectory(), theme: config.theme)
        } else {
            service.beginStateSource() // 真状态源：推首帧 + 启心跳泵
        }

        // 配置面服务装配（M6 批1）：ConfigCenter/处理器/watcher，独立于终端主功能。
        assembleConfigServices(
            composite: controller.compositeRoot, configModel: sharedConfigModel, service: service,
            dataRoot: dataRootURL)

        // Chat 面服务装配（M5 批3）：ChatAssembly（chat.db 查询面 + Codex memo + 镜像 + FSEvents），独立于终端主功能。
        assembleChatServices(dataRoot: dataRootURL, composite: controller.compositeRoot)

        // fs.request 装配（M6 批A）：Router 分发 readDir/showFileMenu/worktree/readFile/writeFile。
        // showFileMenu 经 CompositeRoot.popUpFileMenu 弹原生 NSMenu；worktree 变更成功 → 失效
        // GitStatusCache 该 repo 前缀并重探（徽标/按钮即时反映）。
        // 单一共享 router（多窗共用，multi-window.md §6）：showFileMenu 落**当前活跃窗** composite——fs.request
        // 来自用户正操作的 key 窗（= activeContext），故本窗弹菜单正确；worktree/readDir 无窗依赖。
        let router = FsRequestRouter(
            fsService: FsService(),
            worktreeService: InteractiveWorktreeService(names: worktreeNames),
            showFileMenu: { [weak self] x, y, isDir in
                self?.mainWindowController?.compositeRoot.popUpFileMenu(cssX: x, cssY: y, isDirectory: isDir) ?? .dismissed
            })
        router.onWorktreeMutation = { [weak service] path in
            service?.gitStatusCache.invalidate(prefix: path)
        }
        controller.compositeRoot.onFsRequest = { [weak router] req in
            guard let router else { return .rejected(code: "INTERNAL", message: "FsRequestRouter 已释放") }
            return await router.handle(req)
        }
        fsRouter = router

        // 编排生产装配（批4 波3a）：独立于终端主功能；装配失败 = 降级（编排面不可用 + 记日志），终端照常。
        // 经 OrchLauncher 单缝（公开仓 nil → no-op）；OrchGate 关或装配失败在缝内走同一降级路径。
        orchLauncher?.assemble(composite: controller.compositeRoot, dataRoot: dataRootURL)

        // 多窗还原其余窗（multi-window.md §1.3）：共享处理器（config/chat/fs/orch）已就位——逐 entry 建其余
        // 窗（seed + configureNewWindow → wireNewWindowComposite 接线本窗 composite）→ 聚合**全窗** join 求并集
        // 跑一次 hub.planRestore（§1.3 铁律，避免每窗撞锚点剪除）→ 分发 injects 到各窗。单窗（仅首窗）时
        // additionalEntries 空，仍聚合首窗一窗跑一次恢复层（= 原 createStartupTerminals 恢复语义，行为等价）。
        // COMPOSITE_DEMO 演示态（推合成 ui.state、不真恢复）跳过——单窗演示无其余窗、无 resume 注入。
        if ProcessInfo.processInfo.environment["MUXVO_COMPOSITE_DEMO"] != "1" {
            wm.restoreAdditionalWindowsThenInject(additionalEntries: Array(restoreEntries.dropFirst()))
        }

        // 埋点接线（埋点批2；装配已提前至 update/auth 之前）：首窗桥落点 + 终端观测缝在此；
        // 新窗在 wireNewWindowComposite 同款。
        if let analyticsAssembly = analytics {
            controller.compositeRoot.onTelemetry = { [weak analyticsAssembly] event in
                analyticsAssembly?.handleBridgeTelemetry(event)
            }
            service.onAnalyticsEvent = { [weak analyticsAssembly] metric, params in
                analyticsAssembly?.track(metric, params: params)
            }
            analyticsAssembly.track(
                "app.launch", params: ["restored_terminals": String(startupIds.count)])
        }
    }

    /// 配置面服务装配（M6 批1）：ConfigCenter（生产 home 根）+ ConfigRequestHandler（共享 configModel
    /// 单写者）+ AppRequestHandler（NSOpenPanel 目录选择器）+ ResourceWatcher（~/.claude 变化→data.event）。
    /// 接 composite 透传缝；onPrefsChanged 施加偏好副作用（theme 重推 ui.state；badge 模式重算见 DockBadgeController）。
    private func assembleConfigServices(
        composite: CompositeRootViewController, configModel: ConfigModel, service: TerminalService,
        dataRoot: URL
    ) {
        let center = ConfigCenter(roots: .production())
        configCenter = center
        let cfgHandler = ConfigRequestHandler(configModel: configModel, center: center)
        configRequestHandler = cfgHandler

        // 自动更新装配（auto-update.md）：update.log 恒建（rotate-on-startup；What's New/引擎共用）；
        // 更新面过生产启用门（feed URL 在场）才装配并 start()（启动即查 + 6h 轮询）。
        let updateLog = FileUpdateLogger(
            path: dataRoot.appendingPathComponent("logs", isDirectory: true)
                .appendingPathComponent("update.log"))
        if let lastSeen = configModel.config.lastSeenVersion, lastSeen != AppInfo.shortVersion {
            updateLog.info("update:relaunched v\(AppInfo.shortVersion) (from v\(lastSeen))")
            // 埋点批2（analytics.md L5）：换装后首启 = update.applied（What's New 门同判据）。
            analytics?.track("update.applied", params: ["from_version": lastSeen])
        }
        let whatsNew = WhatsNewService(
            configModel: configModel, log: updateLog,
            changelogDirectory: UpdateAssembly.changelogDirectory(), appVersion: AppInfo.shortVersion)
        whatsNewService = whatsNew
        if let wm = windowManager {
            updateServices = UpdateAssembly.makeIfEnabled(
                configModel: configModel, windowManager: wm, logger: updateLog,
                // 立即重启（Sparkle terminate）不弹退出确认、仍走优雅关停序（legacy forceClose 对等，§4）。
                onWillInstallAndRelaunch: { [weak self] in self?.updateInstallBypassesQuitConfirm = true },
                // 埋点批2（analytics.md L5）：更新漏斗嗅探（prompted/choice/downloaded/error）。
                analyticsTrack: { [weak self] metric, params in self?.analytics?.track(metric, params: params) })

            // M7 批4：内存监控周期启动（每 60s 采样常驻内存，超 2GB 推 memoryWarning，PERF_L2_01/02）。
            let monitor = MemoryAssembly.make(
                windowManager: wm,
                terminalCount: { [weak self] in self?.terminalService?.registry.count ?? 0 })
            monitor.start()
            memoryMonitor = monitor
        }

        let appHandler = AppRequestHandler(
            picker: NSOpenPanelDirectoryPicker(),
            updateActions: updateServices?.actions,
            whatsNew: whatsNew,
            // hook 面板缝（wait-detector.md §7）：禁装门分身 hookInstaller=nil → 面板 disabled 不渲染。
            hookPanel: hookInstaller,
            // M7 批3 老版聊天归档首启迁移提示（legacy-migration.md §7.2）：查询即消费一次性闩。
            // 迁移在后台 warmup 落 legacy marker（copied>0）后，**下次启动**首个 web 查询命中 → 展示
            // toast 并置 legacyChatMigrationNoticeShown=true，此后永不再提示。零命中（copied=0/marker
            // 缺）与已展示（闩 true）恒 false；隔离/禁装分身无 legacy marker 亦恒 false。
            migrationNoticeConsume: { [weak configModel] in
                guard let model = configModel,
                      !model.config.legacyChatMigrationNoticeShown else { return false }
                let markerURL = DataDirectory.legacyChatArchiveMigrationMarkerURL(under: dataRoot)
                guard let counts = ChatArchiveMigrator.migrationCounts(markerURL: markerURL),
                      counts.copied > 0 else { return false }
                model.update { $0.legacyChatMigrationNoticeShown = true }
                return true
            })
        appRequestHandler = appHandler

        // 账号面（右上角批 B5；bridge-v1.md §8 AUTH）：app 级单例 AuthManager + 薄路由。
        // token 明文 0600 落分身数据根（config.json 同级）；登录态变更 fan-out 全窗 data.event；
        // 启动异步 tryRestoreSession（存量 token → /user/me → refresh 三段，legacy 对齐）。
        let dataRoot = DataDirectory.defaultDevRoot()
        let authMgr = AuthManager(
            client: AuthBackendClient(),
            store: AuthTokenStore(fileURL: dataRoot.appendingPathComponent("auth-token.json")),
            openURL: { NSWorkspace.shared.open($0) })
        authManager = authMgr
        let router = AuthRequestRouter(manager: authMgr)
        authRouter = router
        authMgr.onStatusChanged = { [weak self, weak router] _ in
            guard let router else { return }
            let view = router.bridgeView()
            // 埋点批2（analytics.md L5）：登录态嗅探（恢复期由 beginAuthObservation 门挡，透传不拦截）。
            self?.analytics?.noteAuthStatus(loggedIn: view.loggedIn, provider: view.user?.provider)
            self?.windowManager?.broadcastDataEvent(.authStatusChanged(auth: view))
        }
        authMgr.onSessionExpired = { [weak self] in
            self?.windowManager?.broadcastDataEvent(.authSessionExpired)
        }
        Task { [weak self, weak authMgr] in
            await authMgr?.tryRestoreSession()
            // 恢复完成才启用登录嗅探（恢复登录态 ≠ 用户登录动作，不计 auth.login）。
            if let authMgr {
                self?.analytics?.beginAuthObservation(initialLoggedIn: authMgr.statusView.loggedIn)
            }
        }

        // 首窗 config.request：gridLayout 按本窗 windowId 投影/写本窗分组（裁决⑪，multi-window.md §6）。
        let firstWindowId = service.windowId
        composite.onConfigRequest = { [weak cfgHandler] req in
            cfgHandler?.handle(req, windowId: firstWindowId) ?? .rejected(code: "UNAVAILABLE", message: "配置处理器已释放")
        }
        composite.onAppRequest = { [weak appHandler, weak router] req in
            // auth 变体优先走路由（B5）；其余透传 AppRequestHandler。
            if let resp = await router?.handle(req) { return resp }
            guard let appHandler else {
                return .rejected(code: "UNAVAILABLE", message: "app 处理器已释放")
            }
            return await appHandler.handle(req)
        }

        // ~/.claude 资源变化 → data.event configResourcesChanged（watcher 已去抖合并到单资源类型）。
        // onChange 在 watcher 后台队列触发 → hop main → WindowManager fan-out 逐窗 bus（§7.3；C2 单窗 = 单播）。
        let watcher = ResourceWatcher(claudeRoot: center.roots.claudeRoot) { [weak self] resourceType in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self?.windowManager?.broadcastDataEvent(.configResourcesChanged(resourceType: resourceType))
                }
            }
        }
        watcher.start()
        resourceWatcher = watcher

        // 偏好变更副作用（config.request set{patch} → updatePrefs 触发）：badge 模式变→重算 Dock 徽标；
        // theme 等变→重推 ui.state 拾取。
        configModel.onPrefsChanged = { [weak service, weak self] cfg in
            // 全局偏好副作用经 hub 幂等施加一次（badge 模式 / 终端配色广播全活会话；§5.1 全局单值）。
            service?.applyDockBadgePrefs()
            service?.applyTerminalThemePrefs() // 终端配色变 → 广播全活会话立即换色（§5）
            // 每窗重推 ui.state 拾取新偏好（theme 等，§5.1 一窗改全窗同步）；C2 单窗 = 仅首窗。
            // 原生兜底底随界面亮暗同步（settings-dogfood 二轮：亮色下格缝透黑根治）。
            for ctx in self?.windowManager?.contexts ?? [] {
                ctx.composite.applyBackdropTheme(lightTheme: cfg.theme == "light")
                ctx.service.republishState()
            }
            // M5-R1 批2：archiveEnabled patch 副作用——真变才转调 chatAssembly.archiveToggled。
            self?.applyChatArchivePrefs(cfg.chatArchiveEnabled)
        }
    }

    /// 归档开关副作用（M5-R1 批2）：onPrefsChanged 任意偏好变更都触发，仅 archiveEnabled 真变才转调
    /// archiveToggled（开→补一轮 fullScan；关→只停新任务）。守卫惯例同 lastAppliedTerminalThemeName。
    private func applyChatArchivePrefs(_ enabled: Bool) {
        guard enabled != lastChatArchiveEnabled else { return }
        lastChatArchiveEnabled = enabled
        chatAssembly?.archiveToggled(enabled: enabled)
    }

    // MARK: - chatResume 回填闸装配件（M5-R1 批2；纯函数/工厂供单测）

    /// ChatRestore.Outcome → 注入闸裁决（chat-history.md §7.7 native 回填契约）：
    /// restored/alreadyPresent → 照常注入；archiveMissing → block(ARCHIVE_NOT_FOUND)；failed → block(RESTORE_FAILED)。
    nonisolated static func chatResumeVerdict(_ outcome: ChatRestore.Outcome) -> ChatResumeGateVerdict {
        switch outcome {
        case .restored, .alreadyPresent:
            return .proceed
        case .archiveMissing:
            return .block(code: "ARCHIVE_NOT_FOUND")
        case .failed:
            return .block(code: "RESTORE_FAILED")
        }
    }

    /// 回填失败弹窗文案（code → 人话；纯函数供单测）。
    nonisolated static func chatResumeAlertMessage(code: String) -> String {
        switch code {
        case "ARCHIVE_NOT_FOUND":
            return "会话归档缺失：本地镜像里找不到该会话的归档文件，无法回填恢复。已打开普通终端。"
        case "RESTORE_FAILED":
            return "会话回填失败：归档文件拷回 Claude Code 目录时出错，可稍后重试。已打开普通终端。"
        default:
            return "无法恢复该会话（\(code)）。已打开普通终端。"
        }
    }

    /// TerminalService.onChatResumeFeedback 装配实现（工厂供测试构造断言触达）：hop main →
    /// presentChatResumeAlert（默认 NSAlert，测试注入假闭包不真弹窗）。TerminalService 侧已 hop main，
    /// 此处再兜一层（闭包类型 @Sendable，不依赖调用方线程契约）。
    func makeChatResumeFeedback() -> @Sendable (_ sessionId: String, _ code: String) -> Void {
        { [weak self] sid, code in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.presentChatResumeAlert(sid, code) }
            }
        }
    }

    /// Chat 面服务装配（M5 批3）：ChatAssembly（chat.db 查询面 + Codex memo + 镜像 + FSEvents watcher）。
    /// 接 composite.onChatRequest（chat.request 七 kind，M5-R1 批2 增 delete/setTitle）+ onPushEvent =
    /// composite.pushDataEvent（chatSessionUpdate/
    /// chatSyncStatus）。首开异步化：查询 reconcile:false 快路即返，后台 warmup 索引进度经 chatSyncStatus 翻牌。
    /// 装配失败 = 降级（chat 面回 rejected、终端照常）；chat 面不依赖终端主功能，反之亦然。
    private func assembleChatServices(dataRoot: URL, composite: CompositeRootViewController) {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let claudeRoot = home.appendingPathComponent(".claude", isDirectory: true)
        let codexRoot = home.appendingPathComponent(".codex", isDirectory: true)
        do {
            let assembly = try ChatAssembly.make(
                dataRoot: dataRoot, claudeRoot: claudeRoot, codexRoot: codexRoot,
                sharedArchiveRoot: DataDirectory.sharedChatHistoryRootURL(),  // dogfood-r5 PR-4：中心化共享归档池
                titlesStore: chatTitlesStore,
                // M7 升级迁移（legacy-migration.md）：共享根被 env/plist 覆盖 = 隔离/验收池 → 不迁（传 nil，
                // migrator 不构造、marker 不落，日后以默认根启动补迁）；未覆盖 = 正式默认池，首启把老版
                // ~/.muxvo/chat-archive 一次性只读并入（防线二；防线一 = 本参默认 nil，测试/e2e 不传）。
                legacyMuxvoArchiveRoot: DataDirectory.sharedRootIsOverridden()
                    ? nil : DataDirectory.legacyMuxvoChatArchiveRootURL())
            // 全局聊天编辑态 → data.event fan-out 逐窗 bus（§7；C2 单窗 = 单播）。
            assembly.onPushEvent = { [weak self] event in self?.windowManager?.broadcastDataEvent(event) }
            // 标题真变化 → chatTitleUpdate 推送（W8 强绑定：保活面板即时刷新，含终端重命名正向链/首绑
            // 补写/聊天卡 setTitle 全部写点——store onChange 单点）。写入方线程不一（renameSubmit=main /
            // setTitle=chat workQueue），统一异步 hop main（照 ResourceWatcher 先例）。序语义（对抗 MINOR-6
            // 如实登记）：单写者线程内推送与写序一致；跨线程双写者同 sid 的 ms 级窗口，onChange 锁外 fire
            // 可与锁内写序倒挂 → web 终态或暂停旧值，下次真变更/重开面板自愈（等值 no-op 防环闸不受影响）。
            chatTitlesStore?.onChange = { [weak self] sessionId, title in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        self?.windowManager?.broadcastDataEvent(.chatTitleUpdate(sessionId: sessionId, title: title))
                    }
                }
            }
            // 反向同步（W8 双向，用户拍板 2026-07-11）：聊天卡重命名 → 该 sid 正锚定的存活终端 tile 名跟随。
            assembly.onCustomTitleSet = { [weak self] sessionId, title in
                self?.terminalService?.applyChatTitleToAnchoredTerminal(sessionId: sessionId, title: title)
            }
            // 归档开关（M5-R1 批2）：warmup/FSEvent/toggled 触发点恒 @MainActor 求值，读共享 ConfigModel。
            if let model = configModel {
                assembly.archiveEnabled = { model.config.chatArchiveEnabled }
            }
            composite.onChatRequest = { [weak assembly] req in
                guard let assembly else {
                    return .rejected(code: "UNAVAILABLE", message: "Chat 服务已释放")
                }
                return await assembly.handle(req)
            }
            assembly.start() // FSEvents：CC 源 + Codex 源变化 → data.event 推送 + 后台增量刷新
            chatAssembly = assembly
            Log.app.notice("Chat 面装配完成")
        } catch {
            Log.app.error("Chat 面装配失败（降级：chat 面不可用，终端照常）：\(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - 编排缝上下文（开源前置重构第 2 步）

    /// 编排缝上下文：把 AppDelegate 的共享子系统访问器（属性保持 private）以闭包交给 OrchLauncher——
    /// windowManager/analytics/orchNotifier 惰性解引用、指挥台聚焦落窗、呼出 UN delegate 装配。
    private func makeOrchLauncherContext() -> OrchLauncherContext {
        OrchLauncherContext(
            windowManager: { [weak self] in self?.windowManager },
            analytics: { [weak self] in self?.analytics },
            orchNotifier: { [weak self] in self?.orchNotifier },
            focusConsole: { [weak self] windowId, terminalId in
                self?.focusConsoleTerminal(windowId: windowId, terminalId: terminalId)
            },
            installSummonDelegate: { [weak self] in self?.installSummonDelegate() })
    }

    /// 呼出点击路由 delegate 装配（§4）：真 .app 守卫（swift run/裸可执行 UNUserNotificationCenter.current()
    /// 会崩，同 OrchNotifier R2 硬约束；谓词见 RealAppBundleGuard 头注——bundleIdentifier 判法被 -sectcreate
    /// 嵌 plist 骗过）——AppDelegate 作 UN delegate，点击 summon 横幅 → didReceive → routeSummon 开任务中心。
    private func installSummonDelegate() {
        if RealAppBundleGuard.isCurrentProcessRealApp {
            UNUserNotificationCenter.current().delegate = self
        }
    }

    /// 切屏漏斗（批4 波3a×3b；M5 批3 扩 chatHistory）：菜单 toggle → 本方法。两步硬序（现收口在
    /// TerminalService.setPanelMode 单一缝内，M5-R1 批4 顺修）：
    /// ① 切入任一**非 terminal 全窗面板**（taskCenter / chatHistory）时 native 主动 detach 全部 surface
    ///    （先于态更新，不依赖 web 上报，task-center-panel.md §1 / chat-history.md §7.6）。经
    ///    service.onWillEnterFullPanel（装配时注入 compositeRoot.detachAllSurfacesForPanelMode）——菜单
    ///    与 web ui.action（chatOpen 等）**同一条缝**（此前 detach 内联在本方法，tab 路径漏 detach →
    ///    陈旧 surface 悬挂 + holeStore 残留恒穿透，e2e item34 抓获；铁律「先 view.detach() 再
    ///    removeFromSuperview」在其转发的 applyLayout 内保证）。
    ///    聊天历史屏同任务中心屏 = web 全窗 overlay，无终端网格 → 无 layoutReport → reactive detach 不触发，
    ///    故须主动清（漏清 holeStore 则 PassthroughWebView 于陈旧终端洞区恒穿透、面板鼠标事件死）。
    /// ② 3b 权威 panelMode 态 + 重推带 panelMode 的 ui.state（通知 web 切屏）。切回 terminal 时 web 重报
    ///    layoutReport 自动 re-attach（现有路径），故 detach 只在切入非 terminal 面板做。
    public func setPanelMode(_ mode: PanelMode) {
        terminalService?.setPanelMode(mode)
        if mode != .terminal {
            analytics?.track("panel.opened", params: ["panel": mode.rawValue])
        }
    }

    /// 「任务中心」菜单 action（无参 toggle）：读当前权威 panelMode 翻转 → setPanelMode（detach + 态 + UIState）。
    private func toggleTaskCenterMode() {
        guard let ts = terminalService else { return }
        setPanelMode(ts.panelMode == .taskCenter ? .terminal : .taskCenter)
    }

    // MARK: - 多窗口（multi-window.md §1，⌥⌘N）

    /// 「文件 → 新建窗口 ⌥⌘N」菜单 action（multi-window.md §1.1 裁决①）：WindowManager.newWindow 完整竖切
    /// （新 service+webView+bus+默认 1 终端于 defaultTerminalCwd + 级联偏移）→ configureNewWindow 钩子回调
    /// wireNewWindowComposite 接线该窗 composite。前台激活令新窗成为 key 窗。
    private func newWindow() {
        guard let ctx = windowManager?.newWindow() else { return }
        ctx.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        analytics?.track("window.opened")
    }

    /// 指挥台已开聚焦落点（multi-window.md §7.1 裁决⑤）：定位指挥台所在窗（windowId），激活该窗
    /// （makeKeyAndOrderFront + NSApp.activate）+ 该窗 service.selectTile(指挥台终端 id)。窗已不在（关窗
    /// 收割后本不应到此——收割触 onExit 已清 openConsole）→ 退回 activeContext 兜底（best-effort，不崩）。
    private func focusConsoleTerminal(windowId: String?, terminalId: String) {
        let ctx = windowManager?.contexts.first { $0.windowId == windowId } ?? windowManager?.activeContext
        ctx?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        ctx?.service.selectTile(terminalId)
    }

    /// 新窗 composite 接线（multi-window.md §1 完整竖切；configureNewWindow 钩子落点）：把该窗 composite 接到
    /// AppDelegate 持有的**共享**编排/聊天/配置/fs 单实例处理器（与首窗同款，首窗接线内联在 didFinishLaunching）。
    /// 时序：新窗由用户菜单在启动后开，config/chat/fs 同步就绪、orch 异步装配通常已完成——故此处直读已就绪
    /// 实例；orch 未就绪（极早期开窗）则该窗编排面暂不可用（降级，与首窗装配失败同语义，不崩）。
    private func wireNewWindowComposite(_ ctx: WindowContext) {
        let composite = ctx.windowController.compositeRoot
        let service = ctx.service
        // 切屏主动 detach（M5-R1 批4 单一缝；每窗一份，落本窗 composite）。
        service.onWillEnterFullPanel = { [weak composite] in composite?.detachAllSurfacesForPanelMode() }
        // 配置面（M6 批1）：共享 cfgHandler/appHandler。gridLayout 按本窗 windowId 投影/写本窗分组（裁决⑪）。
        if let cfgHandler = configRequestHandler {
            let wid = ctx.windowId
            composite.onConfigRequest = { [weak cfgHandler] req in
                cfgHandler?.handle(req, windowId: wid) ?? .rejected(code: "UNAVAILABLE", message: "配置处理器已释放")
            }
        }
        if let appHandler = appRequestHandler {
            let router = authRouter
            composite.onAppRequest = { [weak appHandler, weak router] req in
                // auth 变体优先走路由（B5，与首窗同款分流）。
                if let resp = await router?.handle(req) { return resp }
                guard let appHandler else { return .rejected(code: "UNAVAILABLE", message: "app 处理器已释放") }
                return await appHandler.handle(req)
            }
        }
        // Chat 面（M5 批3）：共享 assembly（onPushEvent 已 fan-out 全窗）。
        if let assembly = chatAssembly {
            composite.onChatRequest = { [weak assembly] req in
                guard let assembly else { return .rejected(code: "UNAVAILABLE", message: "Chat 服务已释放") }
                return await assembly.handle(req)
            }
        }
        // fs.request（M6 批A）：共享 router（showFileMenu 已落 activeContext composite）。
        if let router = fsRouter {
            composite.onFsRequest = { [weak router] req in
                guard let router else { return .rejected(code: "INTERNAL", message: "FsRequestRouter 已释放") }
                return await router.handle(req)
            }
        }
        // 编排面（批4 波3a）：共享 assembly（stateSink/transcriptSink 已 fan-out 全窗，§7.3）。经 OrchLauncher
        // 单缝（公开仓 nil / orch 未装配 → no-op，该窗编排面暂不可用，降级与首窗装配失败同语义）。
        orchLauncher?.wireNewWindow(composite: composite, service: service)
        // 埋点桥落点 + 终端观测缝（埋点批2）：与首窗同款（共享 tracker，事件不分窗）。
        if let analytics {
            composite.onTelemetry = { [weak analytics] event in analytics?.handleBridgeTelemetry(event) }
            service.onAnalyticsEvent = { [weak analytics] metric, params in
                analytics?.track(metric, params: params)
            }
        }
        // 新窗真状态源就位（推首帧 + hub 心跳幂等已起）：与首窗 beginStateSource 同款。
        service.beginStateSource()
    }

    // MARK: - 呼出点击路由（interactive-worker.md §4）

    /// UNUserNotificationCenterDelegate：点击 summon 横幅（用户交互）→ 取 taskId → 开任务中心。系统在点击
    /// 时已激活 app 前台；此处切任务中心（awaiting_approval 任务在收件箱直呈，选中即 liveHole 一击 attach）。
    public nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // nonisolated 满足协议要求；先取 taskId（Sendable String），路由跳 MainActor 异步执行。
        // completionHandler 立即回（路由是 fire-and-forget 切屏，无需等其完成）。
        let taskId = SummonRouting.summonTaskId(fromUserInfo: response.notification.request.content.userInfo)
        if let taskId {
            Task { @MainActor in self.routeSummon(taskId: taskId) }
        }
        completionHandler()
    }

    /// 末次呼出路由 taskId（路由单测断言用；AppDelegate 全装配难脱窗构造，故 didReceive 薄薄一层调本方法）。
    var lastRoutedSummonTaskId: String?

    /// 呼出点击落点（§4）：激活前台 + 切任务中心（既有 setPanelMode 路径）+ 请求 web 单发选中该任务
    /// （B5 欠账已清：native→web 选择通道 = OrchStatePush.select，seq 幂等）。terminalService 缺席（脱窗
    /// 测试）= 仅记 taskId、不切屏（不崩）；编排缝缺席（公开仓/脱窗测试）= 仅切屏、不选中。
    /// 切屏部分（setPanelMode(.taskCenter)）纯共享，不依赖编排 target——故 routeSummon 留 AppDelegate。
    func routeSummon(taskId: String) {
        lastRoutedSummonTaskId = taskId
        // NSApplication.shared（非 NSApp）：生产等价，脱窗测试懒建实例不崩（NSApp 全局在无 app 时为 nil）。
        NSApplication.shared.activate(ignoringOtherApps: true)
        // multi-window.md §7.2 裁决⑥：呼出落**最近活跃窗**（activeContext = keyWindow→last-active→首窗兜底，
        // §6.1）——激活该窗（makeKeyAndOrderFront）+ 切该窗任务中心 + requestSelect。不新开窗、不猜 worker
        // 原属窗（V1 worker 无窗归属）。activeContext 解析一次复用（避免二度解析结论漂移）；缺席（脱窗测试）
        // = 仅记 taskId、不切屏（不崩，与单窗期行为一致）。
        if let ctx = windowManager?.activeContext {
            ctx.window?.makeKeyAndOrderFront(nil)
            ctx.service.setPanelMode(.taskCenter)
        }
        orchLauncher?.requestSelect(taskId: taskId) // 编排缝：请求选中该任务（缺席 → no-op，仅切屏）
    }

    /// ⌘E 菜单 action（M6 批A）：toggle 文件面板（TerminalService 翻 filePanel 权威态 + 重推）。开面板时
    /// 把 firstResponder 交给 WKWebView——否则 web 面板收不到 Esc（关面板走 web 键路由）。
    private func toggleFilePanelMode() {
        guard let service = terminalService else { return }
        service.toggleFilePanel()
        if service.isFilePanelOpen {
            mainWindowController?.compositeRoot.focusPanelWebView()
        }
    }

    /// 「聊天历史」菜单 action（无参 toggle，chat-history.md §7.6）：读当前权威 panelMode 翻转 →
    /// setPanelMode（detach + 态 + UIState）。非 chatHistory 态（含 taskCenter）→ 切入 chatHistory；已在
    /// chatHistory → 切回 terminal。面板内 Esc/关闭钮走 chatClose ui.action（TerminalService 直落 .terminal）。
    private func toggleChatHistoryMode() {
        guard let ts = terminalService else { return }
        setPanelMode(ts.panelMode == .chatHistory ? .terminal : .chatHistory)
    }

    public func applicationWillTerminate(_ notification: Notification) {
        // 兜底同步收口：正常路径 pty-close-all ShutdownStep 已据账本收割；此处停心跳泵 + 幂等清扫
        // 防 coordinator 异常路径遗留活 PTY。
        windowManager?.beginShutdown() // §1.2 门兜底：非漏斗路径（系统关机等）到此也置真，逐窗析构不删分组
        // 全部窗服务停机（多窗：逐窗取消在飞恢复注入 + 注销 hub 登记；ownsHub=false 不连带停 hub）。
        for wctx in windowManager?.contexts ?? [] { wctx.service.stop() }
        sessionHub?.stop() // 批C C2：停全局心跳泵 + hook socket + 强制落盘会话锚点
        sessionHub?.registry.shutdownForTeardown()
        resourceWatcher?.stop() // 停 ~/.claude FSEvent 流（M6 批1）
        resourceWatcher = nil
        chatAssembly?.stop() // 停 CC/Codex 源 FSEvent 流（M5 批3）
        chatAssembly = nil
        // 编排收尾（best-effort，fire-and-forget）：停监视器定时器 + 停订阅/调度器/CP pump/server（缝内）。
        // 进程退出 OS 兜底回收 socket/线程，故不阻塞退出路径（终端关停不依赖编排收尾）。公开仓 nil = no-op。
        orchLauncher?.shutdown()
    }

    public func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    // 单退出路径：app 内一切退出（⌘Q、关窗、系统关机）都汇到这里，
    // 经 ShutdownCoordinating 完成有序关停后才放行。不得有 exit()/terminate 旁路。
    //
    // DOGFOOD_M3_19 退出确认（legacy AppCloseConfirmDialog 对等）：启动完好时先拦截，置 quitConfirm 待决
    // 态 + 推 ui.state（web 弹整 app 版对话框），确认(confirmQuit) 才走既有优雅关停序、取消(cancelQuit)
    // reply(false) 存活；待决期间重复 quit 经 requestQuitConfirm 幂等（绝不双 reply）。红叉经
    // applicationShouldTerminateAfterLastWindowClosed=true 汇入此唯一漏斗。白名单：启动失败路径
    // （Noop coordinator / service 未就位，web 未必加载）维持现状直退，不等确认。
    public func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let coordinatorIsNoop = shutdownCoordinator is NoopShutdownCoordinator
        guard !updateInstallBypassesQuitConfirm, // 更新立即重启：跳确认、直进优雅关停（§4 旁路）
              Self.shouldDeferQuitForConfirm(
                coordinatorIsNoop: coordinatorIsNoop, hasService: terminalService != nil,
                // 防僵尸兜底（DOGFOOD_M3_21）：窗口不可见（程序化 close/极端路径）时确认卡无处渲染，
                // 卡 .terminateLater = 僵尸持锁 → 直退。
                windowVisible: mainWindowController?.window?.isVisible == true),
              let service = terminalService else {
            return performShutdown() // 白名单：直退（无确认）
        }
        service.requestQuitConfirm(
            onConfirmed: { [weak self] in _ = self?.performShutdown() }, // 确认 → 既有优雅关停序（内 reply(true)）
            onCancelled: { NSApp.reply(toApplicationShouldTerminate: false) }) // 取消 → 存活
        return .terminateLater
    }

    /// 退出确认拦截判据（DOGFOOD_M3_19；DOGFOOD_M3_21 增 windowVisible 轴，纯函数供单测）：仅在启动完好
    /// ——coordinator 非 Noop（lifecycle 已起、有真优雅关停序）且 terminalService 就位（能推 ui.state 弹窗）
    /// 且主窗口在场可见（确认卡有处渲染）——才拦截等 web 确认。任一不满足 → 直退（启动失败 web 未必加载；
    /// 窗口不可见时等确认 = 永远等不到 = 僵尸持锁）。
    static func shouldDeferQuitForConfirm(coordinatorIsNoop: Bool, hasService: Bool, windowVisible: Bool) -> Bool {
        !coordinatorIsNoop && hasService && windowVisible
    }

    /// 老版用户豁免新手引导判定（welcome-overlay.md §5 WEL_legacy_user_exempt，纯函数供单测）：
    /// 仅「新版首启（fresh）+ 老版踪迹在场 + 尚未完成引导」三真才预置——非 fresh（既有用户重启）
    /// 与已完成者不动，避免覆盖任何既有状态。
    nonisolated static func shouldExemptTourForLegacyUser(
        freshInstall: Bool, legacyTraceExists: Bool, tourCompleted: Bool
    ) -> Bool {
        freshInstall && legacyTraceExists && !tourCompleted
    }

    /// 老版数据踪迹路径（老版 Electron 数据 `~/.muxvo`；env `MUXVO_LEGACY_TRACE_PATH` 覆盖——
    /// 单测/真机反向验证缝，生产不设）。
    nonisolated static func legacyTracePath(env: [String: String] = ProcessInfo.processInfo.environment) -> String {
        env["MUXVO_LEGACY_TRACE_PATH"] ?? (NSHomeDirectory() as NSString).appendingPathComponent(".muxvo")
    }

    /// 优雅关停序执行（DOGFOOD_M3_19 抽出，与确认漏斗共用）：beginShutdown 完成后 reply(true) 放行退出。
    /// 返回 .terminateLater（等异步关停）。
    @discardableResult
    private func performShutdown() -> NSApplication.TerminateReply {
        // multi-window.md §1.2 isShuttingDown 门：整机退出放行前置真——随后逐窗析构触发的 close 回调不删
        // config.windows[] 分组（保多窗持久化过 ⌘Q，下次冷启还原全窗，防退出误清空）。
        windowManager?.beginShutdown()
        let coordinator = shutdownCoordinator
        let beginShutdown = {
            coordinator.beginShutdown(reason: .userQuit) {
                DispatchQueue.main.async {
                    NSApp.reply(toApplicationShouldTerminate: true)
                }
            }
        }
        // 埋点退出收口（analytics.md §3）：app.quit + 限时 2s flush 串在优雅关停序之前（有界不悬挂；
        // 启用门关 = flushForQuit 即返，路径等价原状）。
        if let analytics {
            Task { @MainActor in
                await analytics.flushForQuit()
                beginShutdown()
            }
        } else {
            beginShutdown()
        }
        return .terminateLater
    }

    /// 用量预警 app 内弹窗（usage-limit-alert.md §5 双保险之二）：主窗口 sheet **异步非阻塞**呈现——
    /// **严禁 runModal**（会卡主线程冻结终端渲染/PTY）。无主窗口（极早期/已关窗）→ 跳过（横幅已发）。
    /// 文案与横幅共用 UsageAlertText（措辞 1:1 不漂移）。只提示、绝不迁移任何状态。
    private func presentUsageAlertSheet(alert: UsageAlert, accountEmail: String?) {
        guard let window = mainWindowController?.window else { return }
        let sheet = NSAlert()
        sheet.alertStyle = .warning
        sheet.messageText = UsageAlertText.title(alert)
        sheet.informativeText = UsageAlertText.body(alert, accountEmail: accountEmail)
        sheet.addButton(withTitle: "知道了")
        sheet.beginSheetModal(for: window) { _ in }
    }

    private func buildMenu() {
        // 字号缩放 action → TerminalService.applyZoomRouted（dogfood-r3 问题5：全页面板在前缩面板
        // panelZoom，终端网格为主视图缩终端字号 applyZoom 现状不变）。惰性读 self.terminalService：buildMenu
        // 早于 service 创建，但菜单 action 仅在用户交互时触发，届时 service 已就位。与 web term.command zoom
        // 两路归一（web 路径仍直缩终端字号——其发送方只存在于终端网格形态）。
        let commands = AppMenuCommands(
            onZoom: { [weak self] dir in self?.terminalService?.applyZoomRouted(dir) },
            // 「文件 → 新建终端 ⌘N」（DOGFOOD_M3_20，2026-07-07 用户新增）：菜单 → createTerminalFromMenu（与
            // FAB / term.command create 同链 projection.createTerminal(cwd:nil)）。惰性读 service（同 onZoom）。
            onNewTerminal: { [weak self] in self?.terminalService?.createTerminalFromMenu() },
            // 「文件 → 新建窗口 ⌥⌘N」（multi-window.md §1.1 裁决①）：菜单 → WindowManager.newWindow（完整竖切）。
            onNewWindow: { [weak self] in self?.newWindow() },
            // 上限置灰（与 FAB disabled 语义对齐；multi-window.md §3.2 每窗独立判）：本窗 snapshot.maxReached
            // = 本窗满 20 ∨ 全局满 40 → false；service 未就位 → 放行（默认可用）。activeContext 化：置灰随 key 窗。
            isNewTerminalEnabled: { [weak self] in
                guard let service = self?.terminalService else { return true }
                return !service.currentMaxReached
            },
            // 「任务中心」切屏（批4 波3a×3b 漏斗）：菜单 → 翻 panelMode → detach + TerminalService 态+UIState。
            onToggleTaskCenter: { [weak self] in self?.toggleTaskCenterMode() },
            // 「文件面板」⌘E（M6 批A）：菜单 → toggle filePanel + 开面板交焦 WKWebView。
            onToggleFilePanel: { [weak self] in self?.toggleFilePanelMode() },
            // 「聊天历史」切屏（M5 批3 漏斗，chat-history.md §7.6）：菜单 → 翻 panelMode(.chatHistory) 同上路径。
            onToggleChatHistory: { [weak self] in self?.toggleChatHistoryMode() },
            // 「列表模式」⌘⇧L（批B，term-list-mode.md）：菜单 → TerminalService.toggleListMode 翻 List↔Tiling + 重推。
            onToggleListMode: { [weak self] in self?.terminalService?.toggleListMode() },
            // 「文件 → 新建指挥台」（M4b' T6）：菜单 → OrchLauncher.openConsole（装配就绪后惰性可用；未就位/公开仓 no-op）。
            onNewConsole: { [weak self] in self?.orchLauncher?.openConsole() },
            // 「CC 用量预警」（usage-limit-alert.md §6）：App 菜单启用/停用（installer 按 selfCheck 分流；
            // 惰性读 installer——buildMenu 早于装配，菜单交互时必已就位，未就位 no-op）。
            onUsageAlertMenu: { [weak self] in self?.statusLineInstaller?.handleMenuAction() },
            usageAlertMenuTitle: { [weak self] in
                self?.statusLineInstaller?.menuTitle() ?? "启用 CC 用量预警…"
            },
            // 编排入口门控（上线批 2026-07-16，OrchGate 头注）：gate off = 「新建指挥台 ⌘⇧N」
            // 「任务中心 ⌘⇧T」两项不建，键位随之失效。
            showOrchMenus: OrchGate.isEnabled)
        menuCommands = commands
        NSApp.mainMenu = commands.buildMainMenu()
    }

    private func presentStartupFailureAlert(_ error: any Error) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        switch error {
        case let LifecycleError.alreadyRunning(otherPID):
            alert.messageText = "\(AppInfo.displayName) 已在运行"
            alert.informativeText =
                otherPID.map { "另一实例（PID \($0)）持有数据目录锁，请先退出它。" }
                ?? "另一实例持有数据目录锁，请先退出它。"
        case let DataDirectoryError.schemaTooNew(found, supported):
            alert.messageText = "数据目录版本过新"
            alert.informativeText = "数据目录 schema 为 v\(found)，本程序最高支持 v\(supported)。请使用更新版本的 app。"
        default:
            alert.messageText = "启动失败"
            alert.informativeText = String(describing: error)
        }
        alert.runModal()
    }
}

/// 启动失败路径的安全网占位（直接放行退出）。正常路径在 applicationDidFinishLaunching
/// 里被 LifecycleShutdownCoordinator 替换。
final class NoopShutdownCoordinator: ShutdownCoordinating {
    func beginShutdown(reason: ShutdownReason, completion: @escaping @Sendable () -> Void) {
        Log.app.notice("beginShutdown(noop) reason=\(String(describing: reason), privacy: .public) —— lifecycle 未启动，直接放行")
        completion()
    }
}
