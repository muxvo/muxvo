// WindowManager：全部窗口上下文的装配件（批C/D，multi-window.md §1/§3/§6/§7.3）。
//
// 持 `contexts`（每项 = WindowContext，§2.2）+ activeContext 解析链（§6.1：keyWindow → last-active →
// 首窗兜底）+ 三条 broadcast sink（data.event / orch.state / orch.transcript，§7.3 fan-out 逐窗 bus）。
//
// C2 出口 = 仍只开 1 窗：`makeFirstWindow` 平移原 AppDelegate 的窗口构造段。
// **C3（本文件）**：newWindow（⌥⌘N 完整竖切）+ requestClose 关窗分流（§1.2）+ 窗口标题编号（§6.3）+
// 级联偏移（§4.4）+ last-active 刷新。新窗 composite 到共享编排/聊天/配置/fs 处理器的接线经
// `configureNewWindow` 钩子回调 AppDelegate（WindowManager 不持有这些处理器）。
//
// **C4 归属**（不在本文件）：frame 持久化 schema v2（windows[]）/ 崩溃多窗还原。
import AppKit
import MuxvoBridge
import MuxvoStorage
import MuxvoTerm
import MuxvoTermRender

@MainActor
public final class WindowManager {
    /// 全局共享子系统（跨窗唯一 registry / wait 族 / 恢复层 / …）。各窗 TerminalService 经此注入。
    public let hub: SessionHub
    /// 全部窗口上下文（建窗序稳定，不因关窗重排）。
    public private(set) var contexts: [WindowContext] = []
    /// 最近活跃窗 id（§6.1 兜底链中段）：activeContext 每次解析到真 keyWindow 时刷新（summon/D1 兜底用）。
    private var lastActiveWindowId: String?
    /// 建窗计数（windowId 生成序 + 标题编号 §6.3；关窗不回收不重排）。
    private var windowSeq = 0
    /// 最后一窗关闭（红叉/⌘Q）→ 整机退出确认漏斗（§1.2；生产 = NSApp.terminate，harness = registerQuit hook）。
    /// makeFirstWindow 的 onCloseRequested 存于此——非首窗红叉先经 requestClose 分流，仅最后一窗落回此漏斗。
    private var onLastWindowClose: () -> Void = {}
    /// 整机退出期标志（multi-window.md §1.2 isShuttingDown 门）：⌘Q / 最后一窗 terminate 期逐窗析构触发的
    /// close 回调**不得删** `config.windows[]` 分组（否则退出即清空持久化、下次冷启无窗可恢复）。用户主动关
    /// 单窗（!isShuttingDown）才删分组（裁决③不复活）。AppDelegate 退出漏斗放行前 beginShutdown() 置真。
    public private(set) var isShuttingDown = false
    /// 窗几何写回去抖定时器（§4.4，每窗一枚 ~1s）：窗 move/resize 频繁触发 → 去抖落 entry.frame。
    private var frameDebounceTimers: [String: Timer] = [:]

    /// 新窗 composite 接线钩子（§1 完整竖切）：newWindow 建窗后调，令 AppDelegate 把该窗 composite 接到共享
    /// 编排/聊天/配置/fs 处理器（WindowManager 不持有这些）。首窗由 AppDelegate 直接接线、不经此。
    public var configureNewWindow: ((WindowContext) -> Void)?

    /// 关窗确认缝（§1.2 非最后一窗有活终端 → 原生 NSAlert）。测试注入假闭包不真弹窗。默认 NSAlert.runModal。
    public var confirmCloseWindow: (_ window: NSWindow?, _ terminalCount: Int) -> Bool = { window, count in
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "关闭此窗口？"
        alert.informativeText = "该窗口有 \(count) 个正在运行的终端，关闭窗口会一并结束它们。"
        alert.addButton(withTitle: "关闭窗口")
        alert.addButton(withTitle: "取消")
        if let window {
            // 有宿主窗时用 sheet 阻塞语义不便（收割需同步结论），仍走 runModal（应用级模态，短暂）。
            _ = window
        }
        return alert.runModal() == .alertFirstButtonReturn
    }

    public init(hub: SessionHub) {
        self.hub = hub
    }

    // MARK: 建窗（makeFirstWindow 平移 AppDelegate 装配段；newWindow C3 完整竖切；restore C4 多窗还原）

    /// 建窗启动终端来源（multi-window.md §1.1/§1.3）：
    enum StartupTerminals {
        /// 首窗读 flat config.openTerminals + **本窗独跑恢复层**（单窗路径：makeFirstWindow / harness / 单测）。
        case restoreFlat(count: Int)
        /// 新窗 count 个全新终端于默认 cwd（⌥⌘N，裁决④）。
        case fresh(count: Int)
        /// 多窗恢复：seed 本窗持久化分组，**不跑恢复层**（聚合层 §1.3 一次 planRestore）。fallbackCount =
        /// 分组空时的兜底数（首窗兑现旧 startupTerminalCount 语义、其余窗恒 1）。
        case seed(stored: [MuxvoConfig.OpenTerminal], fallbackCount: Int)
    }

    /// 建首窗（§1.1 的 N=1 形态，单窗路径）：从共享 hub 建瘦身 TerminalService → **先 createStartupTerminals**
    /// （onState 未接前，与劈开前逐位一致：恢复收起态的 emitSnapshot 不得早推）→ 再建 SurfaceProvider +
    /// MainWindowController（此刻 onState 接上）→ showWindow。返回上下文 + startupIds（COMPOSITE_DEMO 用）。
    /// `onCloseRequested` = 整机退出确认漏斗，存为 onLastWindowClose（红叉分流 §1.2 落回它）。
    @discardableResult
    public func makeFirstWindow(
        startupTerminalCount: Int,
        onCloseRequested: @escaping () -> Void
    ) -> (context: WindowContext, startupIds: [String]) {
        onLastWindowClose = onCloseRequested
        windowSeq += 1
        return makeWindow(
            startup: .restoreFlat(count: startupTerminalCount),
            windowId: "w\(windowSeq)", number: windowSeq, frame: nil,
            restoredGridLayout: nil, isFirstEverWindow: true)
    }

    /// 建首窗（§1.3 多窗还原路径）：seed 首窗持久化分组（**不跑恢复层**——聚合层 restoreAggregateInject 一次
    /// planRestore，§1.3 铁律）+ 还原 frame（entry.frame 或一次性迁移旧 autosave，§4.4）+ 编号还原（裁决⑨）。
    /// `onCloseRequested` 存为 onLastWindowClose。返回上下文 + startupIds。
    @discardableResult
    public func makeFirstWindowForRestore(
        entry: MuxvoConfig.WindowEntry,
        onCloseRequested: @escaping () -> Void
    ) -> (context: WindowContext, startupIds: [String]) {
        onLastWindowClose = onCloseRequested
        let number = entry.number ?? 1
        windowSeq = max(windowSeq, number)
        // 首窗分组空（旧扁平迁移/首启）→ 兑现旧 createStartupTerminals 的 startupTerminalCount 兜底数。
        let fallback = entry.openTerminals.isEmpty ? hub.configModel.config.startupTerminalCount : 1
        return makeWindow(
            startup: .seed(stored: entry.openTerminals, fallbackCount: fallback),
            windowId: entry.windowId, number: number, frame: entry.frame,
            restoredGridLayout: entry.gridLayout, isFirstEverWindow: true)
    }

    /// 逐 entry 建其余窗（§1.3 多窗还原）+ 聚合恢复注入。首窗须已由 makeFirstWindowForRestore 建 + AppDelegate
    /// 接线；本方法建 `additionalEntries` 各窗（seed + configureNewWindow 接线共享处理器）→ 聚合**全窗**（含
    /// 首窗）join 求并集 → 跑一次 hub.planRestore → 分发 injects 到各窗（§1.3 铁律，避免每窗撞锚点剪除）。
    public func restoreAdditionalWindowsThenInject(additionalEntries: [MuxvoConfig.WindowEntry]) {
        for entry in additionalEntries {
            let number = entry.number ?? (windowSeq + 1)
            windowSeq = max(windowSeq, number)
            let (ctx, _) = makeWindow(
                startup: .seed(stored: entry.openTerminals, fallbackCount: 1),
                windowId: entry.windowId, number: number, frame: entry.frame,
                restoredGridLayout: entry.gridLayout, isFirstEverWindow: false)
            configureNewWindow?(ctx) // §1 完整竖切：AppDelegate 接线该窗 composite 到共享处理器
        }
        // 聚合恢复层（§1.3 铁律：全窗 join 求并集只跑一次）→ 分发到各窗（applyRestorePlan 只入队属己注入）。
        let allJoins = contexts.flatMap { $0.service.pendingRestoreJoins }
        let plan = hub.planRestore(join: allJoins)
        for c in contexts { c.service.applyRestorePlan(injects: plan.injects, stats: plan.stats) }
    }

    /// 新建窗口（§1.1，⌥⌘N）：完整竖切——新 TerminalService（共享 hub.registry）+ 新 SurfaceProvider +
    /// 新 MainWindowController（内含新 CompositeRoot + PanelViewController：新 webView + 新 BridgeBus）+
    /// **默认 1 终端于 config.defaultTerminalCwd（裁决④，不读 config.openTerminals 首窗恢复域）**。建窗后
    /// 级联偏移 25px（§4.4）+ 调 configureNewWindow 接线共享处理器。返回新上下文。
    @discardableResult
    public func newWindow() -> WindowContext {
        let base = activeContext?.window // 级联基准（§4.4）：以当前活跃窗 frame 为基
        windowSeq += 1
        let (ctx, _) = makeWindow(
            startup: .fresh(count: 1),
            windowId: "w\(windowSeq)", number: windowSeq, frame: nil,
            restoredGridLayout: nil, isFirstEverWindow: false)
        cascadeFrame(of: ctx.window, from: base)
        // 级联落位后把当前几何写回本窗 entry（新窗无历史 frame，级联值即初始持久化基线，§4.4）。
        persistFrame(windowId: ctx.windowId, window: ctx.window)
        configureNewWindow?(ctx) // §1 完整竖切：AppDelegate 接线该窗 composite 到共享处理器
        return ctx
    }

    /// 建窗公共路径（makeFirstWindow / makeFirstWindowForRestore / newWindow / restore 共用）。startup 决定
    /// 终端来源；windowId/number 决定持久化分组键与标题编号（§6.3）；frame 非 nil → 还原窗几何；
    /// isFirstEverWindow → frame 缺席时一次性迁移旧 autosave 键（§4.4）。建窗即登记 `config.windows[]` entry。
    private func makeWindow(
        startup: StartupTerminals,
        windowId: String, number: Int, frame: MuxvoConfig.Frame?,
        restoredGridLayout: MuxvoConfig.GridLayout?, isFirstEverWindow: Bool
    ) -> (context: WindowContext, startupIds: [String]) {
        let service = TerminalService(hub: hub, ownsHub: false)
        service.windowId = windowId
        service.windowNumber = number
        let config = hub.configModel.config
        // 终端建立必须先于 controller（onState 未接）——恢复收起态 emitSnapshot 不早推（劈开前语义）。
        let startupIds: [String]
        switch startup {
        case let .restoreFlat(count): startupIds = service.createStartupTerminals(count: count)
        case let .fresh(count): startupIds = service.createFreshStartupTerminals(count: count)
        case let .seed(stored, fallbackCount):
            startupIds = service.seedRestoreTerminals(from: stored, fallbackCount: fallbackCount)
        }
        // 窗口标题编号（§6.3）：编号 1 = "Muxvo"、后续 "Muxvo — N"（固定编号，关窗不重排，裁决⑨）。
        let title = number == 1 ? AppInfo.displayName : "\(AppInfo.displayName) — \(number)"
        let controller = MainWindowController(
            surfaceProvider: SurfaceProvider(
                registry: service.registry,
                font: FontConfig(size: CGFloat(config.terminal.fontSize)),
                onRequestSearch: { [weak service] id in service?.openSearchBar(terminalId: id) }),
            terminalService: service,
            // 红叉拦截（DOGFOOD_M3_21 → §1.2 分流）：windowShouldClose 拒关 → 转发 requestClose(windowId)。
            onCloseRequested: { [weak self] in self?.requestClose(windowId: windowId) },
            title: title,
            frameAutosaveName: nil, // §4.4：全窗弃 autosave，frame 由 WindowManager 去抖写回 entry.frame 自管
            // §4.4 窗几何变化 → 去抖写回本窗 entry.frame。
            onFrameChanged: { [weak self] window in self?.noteFrameChanged(windowId: windowId, window: window) })
        controller.showWindow(nil)
        // frame 还原（§4.4）：entry.frame 存在 → 直接应用；首窗且缺席 → 一次性迁移旧 autosave 键兜底。
        applyRestoredFrame(controller.window, frame: frame, isFirstEverWindow: isFirstEverWindow)

        let ctx = WindowContext(windowId: windowId, service: service, windowController: controller)
        // 原生兜底底随界面亮暗建窗初值（settings-dogfood 二轮）：亮色主题下新窗不得先闪黑格缝。
        ctx.composite.applyBackdropTheme(lightTheme: config.theme == "light")
        // 登记 `config.windows[]` entry（§4，schema v2）：编号/frame/网格比 + 本窗当刻终端分组 + 镜像首窗回顶层。
        registerWindowEntry(ctx, number: number, gridLayout: restoredGridLayout)
        registerWindow(ctx)
        return (ctx, startupIds)
    }

    /// 登记/刷新本窗 `config.windows[]` entry（§4，schema v2）：编号 + 当刻窗几何 + 本窗终端分组 + 网格比。
    /// 建窗即写，令 config.windows 权威（旧扁平 config 首启即迁移；§4.2/§4.3 镜像首窗回顶层）。
    private func registerWindowEntry(
        _ ctx: WindowContext, number: Int, gridLayout: MuxvoConfig.GridLayout?
    ) {
        let terms = ctx.service.persistableOpenTerminals()
        let frame = ctx.window.map(frameOf)
        hub.configModel.update { config in
            config.upsertWindowEntry(windowId: ctx.windowId, number: number) { entry in
                entry.number = number
                entry.openTerminals = terms
                if let frame { entry.frame = frame }
                if let gridLayout { entry.gridLayout = gridLayout }
            }
        }
    }

    /// 级联偏移（§4.4）：新窗以基准窗 frame 为基向右下偏移 25px（避免叠窗）；无基准窗保持默认居中。
    private func cascadeFrame(of window: NSWindow?, from base: NSWindow?) {
        guard let window, let base else { return }
        let baseOrigin = base.frame.origin
        // 右下 = x 增、y 减（AppKit y 轴向上）。
        window.setFrameOrigin(NSPoint(x: baseOrigin.x + 25, y: baseOrigin.y - 25))
    }

    // MARK: frame 自管（§4.4，弃 setFrameAutosaveName）

    /// NSWindow.frame → 持久化 Frame（屏坐标 origin + 尺寸）。
    private func frameOf(_ window: NSWindow) -> MuxvoConfig.Frame {
        let f = window.frame
        return MuxvoConfig.Frame(
            x: Double(f.origin.x), y: Double(f.origin.y),
            width: Double(f.size.width), height: Double(f.size.height))
    }

    /// frame 还原（§4.4）：entry.frame 存在 → 应用；首窗且缺席 → 一次性迁移旧 `MuxvoMainWindow` autosave 键
    /// （用户调好的尺寸不丢）。迁移后的几何由随后的 registerWindowEntry 从 window.frame 读回落 entry.frame
    /// （此后不再依赖旧键）。返回是否应用了 frame（真机/单测取证）。
    @discardableResult
    func applyRestoredFrame(_ window: NSWindow?, frame: MuxvoConfig.Frame?, isFirstEverWindow: Bool) -> Bool {
        guard let window else { return false }
        if let frame {
            window.setFrame(
                NSRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height), display: true)
            return true
        }
        // 一次性迁移旧 autosave（NSUserDefaults「NSWindow Frame MuxvoMainWindow」）→ 应用到 window，
        // 由 registerWindowEntry 读回落 entry.frame。
        guard isFirstEverWindow else { return false }
        return window.setFrameUsingName(Self.legacyFirstWindowAutosaveName)
    }

    /// 旧首窗 frame autosave 名（C4 前 setFrameAutosaveName 用；§4.4 一次性迁移读此键的 NSUserDefaults 记录）。
    static let legacyFirstWindowAutosaveName = "MuxvoMainWindow"

    /// 窗几何变化去抖回调（§4.4）：move/resize 频繁触发 → 每窗 ~1s 去抖 → 落 entry.frame。
    private func noteFrameChanged(windowId: String, window: NSWindow) {
        frameDebounceTimers[windowId]?.invalidate()
        let timer = Timer(timeInterval: 1.0, repeats: false) { [weak self, weak window] _ in
            MainActor.assumeIsolated {
                guard let self, let window else { return }
                self.frameDebounceTimers[windowId] = nil
                self.persistFrame(windowId: windowId, window: window)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        frameDebounceTimers[windowId] = timer
    }

    /// 立即把某窗当刻几何写回 entry.frame（§4.4；新窗级联落位 / 去抖到期共用）。
    private func persistFrame(windowId: String, window: NSWindow?) {
        guard let window, !windowId.isEmpty else { return }
        let frame = frameOf(window)
        hub.configModel.update { config in
            config.upsertWindowEntry(windowId: windowId) { $0.frame = frame }
        }
    }

    // MARK: 登记 / 注销（§1）

    /// 登记一窗上下文（建窗后调）：入 contexts + 置为最近活跃。
    public func registerWindow(_ ctx: WindowContext) {
        contexts.append(ctx)
        lastActiveWindowId = ctx.windowId
    }

    /// 注销一窗上下文（§1.2 关窗调）：从 contexts 剔除 + 最近活跃回落。
    public func unregisterWindow(_ ctx: WindowContext) {
        contexts.removeAll { $0 === ctx }
        if lastActiveWindowId == ctx.windowId { lastActiveWindowId = contexts.last?.windowId }
    }

    // MARK: 关窗分流（§1.2，用户裁决②③）

    /// 红叉/⌘W 关窗请求分流（§1.2）：
    ///   - 最后一窗 → 既有整机退出确认漏斗（onLastWindowClose；不是单窗收割）。
    ///   - 非最后一窗 + 有活终端 → 原生 NSAlert 确认 → 收割本窗全部会话 + 关窗；取消 → 不关。
    ///   - 非最后一窗 + 零终端 → 直接关窗（无对话框）。
    public func requestClose(windowId: String) {
        guard let ctx = contexts.first(where: { $0.windowId == windowId }) else { return }
        if contexts.count <= 1 {
            onLastWindowClose() // 最后一窗：整机退出漏斗（quitConfirm，terminal-session.md 现有语义）
            return
        }
        let liveCount = ctx.service.windowTerminalIds.count
        if liveCount > 0, !confirmCloseWindow(ctx.window, liveCount) {
            return // 取消 → 不关
        }
        closeWindow(ctx)
    }

    /// 关闭并收割一窗（§1.2 非最后一窗确认后 / 零终端直接）：收割本窗全部会话（逐 id 优雅关闭 + 从全局池
    /// 收割，防泄漏全局 40 名额）→ 停本窗服务（注销 hub 登记 + 取消在飞注入）→ 注销上下文 → 真关 NSWindow →
    /// **删本窗持久化分组**（裁决③不复活；isShuttingDown 期不删，防退出误清空 §1.2 门）→ 存活首窗镜像回顶层。
    private func closeWindow(_ ctx: WindowContext) {
        ctx.service.harvestAllSessions()
        ctx.service.stop()
        frameDebounceTimers[ctx.windowId]?.invalidate()
        frameDebounceTimers[ctx.windowId] = nil
        unregisterWindow(ctx)
        // NSWindowController.close() 直闭窗（不经 windowShouldClose 拦截器，避免二次分流）。
        ctx.windowController.close()
        // 用户主动关单窗（!isShuttingDown）→ 删 `config.windows[]` 分组（裁决③不复活，下次冷启不重建该窗）。
        // 删后镜像首窗回顶层（§4.3；存活首窗覆盖收割窗残留，flat 无 clobber）。整机退出期（isShuttingDown）
        // 逐窗析构不删分组（§1.2 门；否则退出即清空持久化、下次冷启无窗可恢复）。
        if !isShuttingDown {
            let widToRemove = ctx.windowId
            hub.configModel.update { config in
                config.windows.removeAll { $0.windowId == widToRemove }
                config.mirrorFirstWindowToTop()
            }
        }
    }

    /// 整机退出期标志置真（§1.2 isShuttingDown 门）：AppDelegate 退出漏斗（confirmQuit → 优雅关停序）放行
    /// 前调，令随后的逐窗析构 close 回调**不删** `config.windows[]` 分组（保多窗持久化过 ⌘Q，下次冷启还原）。
    public func beginShutdown() {
        isShuttingDown = true
    }

    // MARK: activeContext 解析（§6.1：keyWindow → last-active → 首窗兜底）

    /// 菜单命令 / 全局快捷键的目标窗（§6.1）：NSApp.keyWindow 对应 context → 无则最近活跃 → 再无则首窗兜底。
    /// 解析到真 keyWindow 时顺带刷新 lastActiveWindowId（§6.1 last-active；summon/D1 无 keyWindow 时兜底）。
    public var activeContext: WindowContext? {
        let keyId = NSApp.keyWindow.flatMap { kw in
            contexts.first(where: { $0.windowController.window === kw })?.windowId
        }
        if let keyId { lastActiveWindowId = keyId }
        return Self.resolveActiveContext(
            keyWindowId: keyId, lastActiveId: lastActiveWindowId, contexts: contexts)
    }

    /// activeContext 解析纯函数（§6.1，供单测 MW_menu_routes_key_window）：给定 keyWindow id + last-active id
    /// + contexts → 目标 context。keyWindow 命中优先 → last-active 命中 → 首窗兜底 → 空 contexts 返 nil。
    public static func resolveActiveContext(
        keyWindowId: String?, lastActiveId: String?, contexts: [WindowContext]
    ) -> WindowContext? {
        if let k = keyWindowId, let c = contexts.first(where: { $0.windowId == k }) { return c }
        if let l = lastActiveId, let c = contexts.first(where: { $0.windowId == l }) { return c }
        return contexts.first
    }

    // MARK: broadcast sink（§7.3 编排推送 fan-out 逐窗 bus）

    /// data.event fan-out（chat/config/resource 推送；§7 全局编辑态 fan-out 全窗）。
    public func broadcastDataEvent(_ event: DataEvent) {
        for c in contexts { c.composite.pushDataEvent(event) }
    }
}
