// 复合 UI 根视图控制器（C 案落地，M3 批3①）：删 NSSplitViewController，改为
//   下层 TerminalSurfaceHostViewController（原生渲染面）+ 上层 PanelViewController（透明 web chrome）
// 两 sibling 全窗铺满。layoutReport（web→native，经 PanelVC 的 onBridgeAction）在此统一消费：
//   更新 HoleStore（驱动 hitTest 穿透）+ 驱动 host 套洞几何（attach/detach surface）。
//
// 输入路由：洞区点击 → PassthroughWebView 穿透 → 事件落 sibling 下层 host（PanelContainerView
// 与 webView 洞区均返 nil，见各自 hitTest）；web 区点击 → webView 认领，web 收焦。
import AppKit
import MuxvoBridge
import MuxvoKit
import WebKit

/// 复合 UI 兜底色板。#0a0e14 = web `--bg-primary`：web 整页透明后透出的底色须与之无缝一致。
enum CompositeColors {
    static let bgPrimary = CGColor(red: 0x0a / 255, green: 0x0e / 255, blue: 0x14 / 255, alpha: 1)
    /// 亮色界面的兜底底（web 亮色 --bg-primary #f0f0f3，theme.css:41）。settings-dogfood 二轮：
    /// 亮色下原生兜底仍暗 → web 整页透明处（tile 格缝/非终端区）透出黑底。
    static let bgPrimaryLight = CGColor(red: 0xf0 / 255, green: 0xf0 / 255, blue: 0xf3 / 255, alpha: 1)
    /// 按界面亮暗取兜底底色（config.theme 派生；与 web --bg-primary 两态同源）。
    static func backdrop(lightTheme: Bool) -> CGColor { lightTheme ? bgPrimaryLight : bgPrimary }
}

@MainActor
public final class CompositeRootViewController: NSViewController {
    let holeStore = HoleStore()
    let host: TerminalSurfaceHostViewController
    let panel: PanelViewController
    private let terminalService: TerminalService
    /// layoutReport 陈旧丢弃高水位（DOGFOOD_M3_13 F4）。
    private var layoutGate = LayoutReportGate()

    // MARK: - orch 生产装配缝（波2a 到 CompositeRoot 层为止，闭包默认 nil；波3a AppDelegate 真接）

    /// chat.request 落点（M5 批3）：AppDelegate 接 ChatAssembly.handle（异步）。未接 → rejected(UNAVAILABLE)。
    public var onChatRequest: ((ChatRequest) async -> ChatResponse)?
    /// config.request 落点（M6 批1）：AppDelegate 接 ConfigRequestHandler.handle。未接 → rejected(UNAVAILABLE)。
    public var onConfigRequest: ((ConfigRequest) -> ConfigResponse)?
    /// app.request 落点（M6 批1）：AppDelegate 接 AppRequestHandler.handle。未接 → rejected(UNAVAILABLE)。
    public var onAppRequest: ((AppRequest) async -> AppResponse)?
    /// fs.request 落点（M6 批A FsRequestRouter 文件树/worktree/菜单，AppDelegate 装配层接线）。
    /// 未接 → rejected(UNAVAILABLE)。
    public var onFsRequest: ((FsRequest) async -> FsResponse)?
    /// 握手完成回调：波3a 接投影层 forceSnapshot（冷启动 + re-hello 重推 orch snapshot，§3）。
    public var onHandshake: (() -> Void)?
    /// app.telemetry 落点（v35 埋点批2，AppDelegate 接 AnalyticsTracker）。未接 → 事件丢弃（fire-and-forget）。
    public var onTelemetry: ((TelemetryEvent) -> Void)?
    /// grid 角色 worker live 洞真人 keyDown（M4b B3-3 humanControl 置位）：terminalId → 装配层接
    /// HumanControlArbiter.noteHumanKey（非 worker termId 由仲裁 resolveTask 侧过滤）。仅 grid 角色转发
    /// （sidebarPreview/island 不触发轻接管）。
    public var onGridKeystroke: ((String) -> Void)?

    public init(surfaceProvider: any TerminalSurfaceProviding, terminalService: TerminalService) {
        self.terminalService = terminalService
        holeStore.self // 保持初始化顺序显式
        host = TerminalSurfaceHostViewController(surfaceProvider: surfaceProvider)
        panel = PanelViewController(holeStore: holeStore)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) 不支持") }

    // MARK: - e2e 评测关只读取证接缝（M3 dogfood②-C）
    // 只读转发到内部 host/panel/holeStore，供 harness 可执行取证；无 setter、生产语义不变。

    /// 当前 attach 的 surface 视图数。
    public var attachedSurfaceCount: Int { host.attachedSurfaceCount }
    /// 当前 attach 的 surface 视图 frame（键 = "terminalId#role"）。
    public var attachedSurfaceFrames: [String: NSRect] { host.attachedSurfaceFrames }
    /// 当前 attach 的 surface 视图（判 window.firstResponder 是否洞下 surface）。
    public var attachedSurfaceViews: [NSView] { host.attachedSurfaceViews }
    /// 按键取 attach 的 surface 视图（键 = "terminalId#role"，如 "id#grid"）。DOGFOOD_M3_06 e2e
    /// 焦点路由取证消费：断言点击洞后 firstResponder === 该键 surface。
    public func attachedSurfaceView(forKey key: String) -> NSView? { host.attachedSurfaceView(forKey: key) }
    /// 当前洞 + 岛 rect 快照（CSS 坐标）。
    public var layoutRects: [TermRect] { holeStore.snapshot() }
    /// 面板模式切屏主动 detach（M3_04/M3_12 铁律）：**生产 `AppDelegate.setPanelMode` 与 e2e harness
    /// 共用此单一缝**（3a×3c 收敛，杜绝并行拷贝漂移——harness 测的即生产走的同一路径）。任务中心屏无
    /// 终端网格 → 无 layoutReport → reactive detach 不触发（新挂载屏 useLayoutReport 依「从未有洞
    /// 不刷空报」防刷屏语义也不会补发空报），故切入 taskCenter 时经此主动清全部 surface
    /// （转发 host.applyLayout 空 rects，铁律「先 view.detach() 再 removeFromSuperview」在 applyLayout 内保证），
    /// 且必须与 layoutReport 消费同款「洞清单 + host 几何一致更新」单点收口——漏清 holeStore 则
    /// PassthroughWebView 于陈旧终端洞区恒穿透到已清空 host，任务中心整面板鼠标事件死
    /// （M4a 收官验收现场缺陷，2026-07-06）。
    public func detachAllSurfacesForPanelMode() {
        holeStore.update(stateId: "panelmode-detach", rects: [])
        host.applyLayout([], stateId: "panelmode-detach")
    }

    // MARK: - orch native→web 推送转交（波3a 投影层 Publisher / 节流器接此）

    /// ResourceWatcher sink 落点（M6 批1）：data.event（configResourcesChanged）→ panel → bus。
    public func pushDataEvent(_ event: DataEvent) { panel.pushDataEvent(event) }
    /// 本窗桥 bus 只读取证缝（multi-window.md §7.3 fan-out 单测 MW_push_fanout_all_windows）：view 未加载 → nil。
    var busForTest: BridgeBus? { panel.busForTest }
    /// 对 web 面板 webView 求值 JS（DOM 态取证 / 驱动交互）。
    public func evaluateJS(_ js: String, _ completion: @escaping (Any?, Error?) -> Void) {
        panel.webView.evaluateJavaScript(js, completionHandler: completion)
    }
    /// 对 web 面板 webView 做区域快照（洞区透明像素采样）。
    public func snapshotWebView(_ config: WKSnapshotConfiguration,
                               _ completion: @escaping (NSImage?, (any Error)?) -> Void) {
        panel.webView.takeSnapshot(with: config, completionHandler: completion)
    }
    /// web 面板 webView bounds（像素采样缩放换算）。
    public var webViewBounds: NSRect { panel.webView.bounds }
    /// 关闭 webView 窗口 occlusion 检测（前台可执行通常无需；保留兜底）。
    public func disableWebViewOcclusionDetection() {
        let sel = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        guard panel.webView.responds(to: sel) else { return }
        typealias Fn = @convention(c) (NSObject, Selector, ObjCBool) -> Void
        let fn = unsafeBitCast(panel.webView.method(for: sel), to: Fn.self)
        fn(panel.webView, sel, ObjCBool(false))
    }

    /// 纯为 e2e（dogfood-r6-fix hover 取证/常绿锚）：把一枚 mouseMoved 直投 webView.mouseMoved(with:)，
    /// 模拟 AppKit tracking area 对真实光标移动的派发——驱动 WebKit hover 链（:hover / mouseenter 进 DOM）。
    /// window.sendEvent 对 .mouseMoved 走 firstResponder 路由，合成场景下不达 webView，故须此直投缝。
    /// windowPoint 为窗口坐标（左下原点，与 EventSynth 同参考系）。
    public func e2eInjectMouseMoved(windowPoint: NSPoint, in window: NSWindow) {
        guard let ev = NSEvent.mouseEvent(
            with: .mouseMoved, location: windowPoint, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, eventNumber: 0, clickCount: 0, pressure: 0) else { return }
        panel.webView.mouseMoved(with: ev)
    }

    // MARK: - fs.request 菜单 anchor（M6 批A，plan-native §1.3 / §5.2）

    /// showFileMenu 的 native 弹菜单缝：AppDelegate 以闭包把此方法交给 FsRequestRouter（Router 可注入
    /// 假 anchor 单测，本 VC 不长胖）。坐标换算见 `menuAnchorPoint`：macOS WKWebView `isFlipped==true`
    /// （与 CSS 同款左上原点），而 `menu.popUp(at:in:)` 的 at 点落在接收 view **自身**坐标系 → CSS (x,y)
    /// 直传即可。条件式两态兼容（防 WebKit 未来翻转语义变化）。
    /// dogfood-r4 修此前的双翻镜像 bug——原式 `bounds.height − cssY` 把已是左上原点的 CSS 坐标当左下原点又翻
    /// 一次，误差 = |H − 2·cssY|，恰在垂直中部（cssY≈H/2）≈0，故 M6 批A/B 验收（右键点靠中部的行）未察觉，
    /// 靠上/下的行则镜像错位。注意 PassthroughWebView.hitTest 的 `bounds.height − point.y` 与此**无关**且正确：
    /// 那里的 point 在**非 flipped 的 superview** 坐标系，本来就要翻。
    /// menu.popUp 同步跑嵌套 event-tracking runloop，选中项 action 在收起前触发 → 返回所选动作（未选 = dismissed）。
    public func popUpFileMenu(cssX: Double, cssY: Double, isDirectory: Bool) -> FileMenuAction {
        let target = FileMenuTarget()
        let menu = NSMenu()
        func add(_ title: String, _ action: FileMenuAction) {
            let item = NSMenuItem(
                title: title, action: #selector(FileMenuTarget.pick(_:)), keyEquivalent: "")
            item.target = target
            item.representedObject = action.rawValue
            menu.addItem(item)
        }
        add("复制路径", .copyPath)
        add("在 Finder 中打开", .revealInFinder)
        if !isDirectory { add("用默认应用打开", .openWithDefaultApp) } // 文件才有（legacy/PRD 017-019）
        let point = Self.menuAnchorPoint(
            cssX: cssX, cssY: cssY,
            boundsHeight: Double(panel.webView.bounds.height),
            isFlipped: panel.webView.isFlipped)
        menu.popUp(positioning: nil, at: point, in: panel.webView)
        return target.picked ?? .dismissed
    }

    /// 文件菜单 anchor 坐标换算（纯函数，供单测；popUpFileMenu 调用）：
    ///  - isFlipped（macOS WKWebView 常态，左上原点）→ CSS (x,y) 直传，与 view 坐标同向。
    ///  - 非 flipped（左下原点，防御 WebKit 语义变化）→ 纵轴翻 `boundsHeight − cssY`。
    static func menuAnchorPoint(
        cssX: Double, cssY: Double, boundsHeight: Double, isFlipped: Bool
    ) -> NSPoint {
        isFlipped ? NSPoint(x: cssX, y: cssY) : NSPoint(x: cssX, y: boundsHeight - cssY)
    }

    /// ⌘E 开文件面板时把键焦点交给 web（否则 web 收不到 Esc 关面板）。
    public func focusPanelWebView() {
        view.window?.makeFirstResponder(panel.webView)
    }

    /// 界面亮暗随动原生兜底底（settings-dogfood 二轮，terminal-theme.md §5.1 注记）：web 整页透明，
    /// tile 格缝/非终端区透出的是本层与 host 层底色——亮色界面必须同步换亮，否则格缝全黑。
    /// 建窗初值（WindowManager）与 config.theme 变更（AppDelegate.onPrefsChanged）两处调，幂等。
    public func applyBackdropTheme(lightTheme: Bool) {
        let color = CompositeColors.backdrop(lightTheme: lightTheme)
        view.layer?.backgroundColor = color
        host.view.layer?.backgroundColor = color
    }

    public override func loadView() {
        let container = NSView()
        container.wantsLayer = true
        // 兜底底色（web 整页透明后非终端区透出的底，与 host 同款 #0a0e14）。host 铺满遮住本层，
        // 此处为纵深保险（host 一旦不满铺时仍是 web --bg-primary，不露系统灰）。
        container.layer?.backgroundColor = CompositeColors.bgPrimary

        addChild(host)
        addChild(panel)

        // 下层先加（在下），上层透明 webview 后加（在上）。均全窗铺满。
        for child in [host.view, panel.view] {
            child.frame = container.bounds
            child.autoresizingMask = [.width, .height]
            container.addSubview(child)
        }
        view = container
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        panel.onBridgeAction = { [weak self] action in self?.handle(action) }
        // 真状态源接线（批4③）：term.command → TerminalService；其快照 → panel.pushState（经 bus 入队/flush）。
        panel.onTermCommand = { [weak self] req in
            self?.terminalService.handleTermCommand(req)
                ?? .rejected(code: .internal, message: "TerminalService 已释放")
        }
        // orch 透传链（波2a 到 CompositeRoot seam）：panel 闭包 → 本 VC 公开缝（波3a 真接编排服务）。
        // chat.request 透传（M5 批3）：panel 闭包 → 本 VC 公开缝（AppDelegate 真接 ChatAssembly）。
        panel.onChatRequest = { [weak self] req in
            guard let handler = self?.onChatRequest else {
                return .rejected(code: "UNAVAILABLE", message: "Chat 服务未接线")
            }
            return await handler(req)
        }
        // config.request / app.request 透传（M6 批1）：panel 闭包 → 本 VC 公开缝（AppDelegate 真接处理器）。
        panel.onConfigRequest = { [weak self] req in
            self?.onConfigRequest?(req) ?? .rejected(code: "UNAVAILABLE", message: "配置服务未接线")
        }
        panel.onAppRequest = { [weak self] req in
            guard let handler = self?.onAppRequest else {
                return .rejected(code: "UNAVAILABLE", message: "app 服务未接线")
            }
            return await handler(req)
        }
        // fs.request 透传（合流：图片 + 文件树/worktree/菜单，AppDelegate 装配层按变体分发）。
        panel.onFsRequest = { [weak self] req in
            guard let handler = self?.onFsRequest else {
                return .rejected(code: "UNAVAILABLE", message: "fs 服务未接线")
            }
            return await handler(req)
        }
        panel.onHandshake = { [weak self] in self?.onHandshake?() }
        panel.onTelemetry = { [weak self] event in self?.onTelemetry?(event) }
        terminalService.onState = { [weak self] state in self?.panel.pushState(state) }
        // 字号缩放渲染消费（DOGFOOD_M3_05）：applyZoom → 广播新字号 → host→provider→各 surface.updateFontSize。
        terminalService.onFontSizeChanged = { [weak self] size in self?.host.applyFontSize(size) }
        // 洞区 native 点击直报选中态（DOGFOOD_M3_06）：surface 焦点跟随点击后回报 (terminalId, role) →
        // 映射为 ui.action（grid→tileClick / sidebarPreview→sidebarSelect）走与 web 同一 handleAction 路。
        host.onSurfaceClick = { [weak self] terminalId, role in
            guard let self, let action = Self.surfaceClickAction(terminalId: terminalId, role: role) else { return }
            self.terminalService.handleAction(action)
        }
        // 洞区 native 真人 keyDown → humanControl 置位（M4b B3-3）：仅 grid 主视图转发（人正在其中打字的
        // worker live 洞）；sidebarPreview/island 不触发轻接管。装配层接 HumanControlArbiter.noteHumanKey。
        host.onSurfaceKeystroke = { [weak self] terminalId, role in
            guard let self, role == .grid else { return }
            self.onGridKeystroke?(terminalId)
        }
        // 洞区 native 双击 → 聚焦（settings-dogfood 批，PAR-13 消费端）：doubleClickToFocus 偏好门控
        // （事件时读 config，改设置即时生效），grid 主视图映射 maximizeTile 走与 web 同一 handleAction 路。
        host.onSurfaceDoubleClick = { [weak self] terminalId, role in
            guard let self,
                  let action = Self.surfaceDoubleClickAction(
                      terminalId: terminalId, role: role,
                      enabled: self.terminalService.doubleClickToFocusEnabled) else { return }
            self.terminalService.handleAction(action)
        }
    }

    /// 洞区 native 点击 → ui.action 映射（DOGFOOD_M3_06，供单测）：
    ///  - grid 主视图 → tileClick（选中 tile；wait-detector §3 tileClick 隐含 acknowledge 清红免费获得）。
    ///  - sidebarPreview 小预览 → sidebarSelect（激活 sidebar，幂等）。
    ///  - island 不建 surface（applyLayout 已过滤），不会有点击回报 → nil 兜底跳过。
    /// 与 web 动作同经 TerminalService.handleAction，不另开路径。
    static func surfaceClickAction(terminalId: String, role: TermRectRole) -> UIAction? {
        switch role {
        case .grid: return .tileClick(terminalId: terminalId)
        case .sidebarPreview: return .sidebarSelect(terminalId: terminalId)
        case .island: return nil
        }
    }

    /// 洞区 native 双击 → ui.action 映射（settings-dogfood 批，供单测）：仅 doubleClickToFocus 开
    /// 且 grid 主视图 → maximizeTile（进 Focused，幂等——Focused 下重双击原地重进）；sidebarPreview
    /// 不接（预览被动化，双击语义归 term-grid §2 sidebar 互换未实现项，不混入本开关）。
    static func surfaceDoubleClickAction(terminalId: String, role: TermRectRole, enabled: Bool) -> UIAction? {
        guard enabled, role == .grid else { return nil }
        return .maximizeTile(terminalId: terminalId)
    }

    // MARK: - 桥入向动作消费

    /// layoutReport stateId 单调序解析（DOGFOOD_M3_13 F4）：真状态源 id 形如 "s<n>"（pushCounter
    /// 单调，TerminalService）→ n；其他（demo/fixture 屏名）→ nil = 不参与陈旧丢弃（latest-wins
    /// 兼容冒烟/截图路径）。
    nonisolated static func layoutSeq(_ stateId: String) -> UInt64? {
        guard stateId.count > 1, stateId.hasPrefix("s") else { return nil }
        return UInt64(stateId.dropFirst())
    }

    /// 视口一致性判定（DOGFOOD_M3_13 F5b）：web 报文携带测量时刻的 window.innerWidth/Height，
    /// 与 native webView.bounds 比对——失配 = web 在陈旧/错误视口下测量（H-window 类），报文
    /// 不得用于 surface 几何与 PTY resize。容差 max(4pt, 1%)（滚动条/亚 pt 取整抖动）。
    /// 字段缺席（旧 web/fixture 路径）→ 放行（向后兼容）。丢弃零损失：正确视口就位必触发
    /// web resize 监听重报。
    nonisolated static func viewportMatches(
        reportW: Double?, reportH: Double?, bounds: CGSize
    ) -> Bool {
        guard let w = reportW, let h = reportH else { return true }
        let tolW = max(4.0, bounds.width * 0.01)
        let tolH = max(4.0, bounds.height * 0.01)
        return abs(w - bounds.width) <= tolW && abs(h - bounds.height) <= tolH
    }

    /// internal（非 private）：LayoutReportGateTests 行为级直驱（照 surfaceClickAction 测试缝先例）。
    func handle(_ action: UIAction) {
        switch action {
        case let .layoutReport(stateId, rects, viewportW, viewportH):
            // 视口一致性守卫（DOGFOOD_M3_13 F5b）：陈旧/错误视口下测量的报文整体拒收——
            // H-window 类错误几何从源头挡住（settle 只防抖不辨合法性，稳定 >80ms 的错误 rect
            // 仍会提交，此闸补最后一环）。
            guard Self.viewportMatches(reportW: viewportW, reportH: viewportH,
                                       bounds: panel.webView.bounds.size) else {
                Log.bridge.notice("layoutReport 视口失配丢弃 state=\(stateId, privacy: .public) 报=\(Int(viewportW ?? -1))x\(Int(viewportH ?? -1)) webView=\(Int(self.panel.webView.bounds.width))x\(Int(self.panel.webView.bounds.height))")
                return
            }
            // 陈旧丢弃（DOGFOOD_M3_13 F4，还 host TODO(批4③) 欠账）：入站换序的旧报文直接丢——
            // 正确报文已应用/必再来（web resize 监听保证），丢弃零损失。
            guard layoutGate.admit(stateId: stateId) else {
                Log.bridge.notice("layoutReport 陈旧丢弃 state=\(stateId, privacy: .public)（高水位 s\(self.layoutGate.highWater)）")
                return
            }
            // 单点收口：洞清单（hitTest 穿透）+ host 洞几何（attach/detach）一致更新。
            // 报文级 .notice 取证（DOGFOOD_M3_13 F1）：每 rect 明细 + 当刻 webView.bounds 与
            // window.frame——错误视口（H-window 类）在持久化日志里直接可见，事后 log show 可还原
            // 「web 在什么视口下测的哪些洞」。量级有界（RO+rAF 合帧 + diff 才发，仅几何变化期）。
            let rectDigest = rects.map { r in
                "\(r.terminalId.prefix(8))#\(r.role.rawValue) \(Int(r.x)),\(Int(r.y)) \(Int(r.w))x\(Int(r.h))\(r.visible ? "" : " hidden")"
            }.joined(separator: " | ")
            let wf = view.window?.frame ?? .zero
            Log.bridge.notice(
                "layoutReport state=\(stateId, privacy: .public) rects=\(rects.count) webView=\(Int(self.panel.webView.bounds.width))x\(Int(self.panel.webView.bounds.height)) window=\(Int(wf.width))x\(Int(wf.height)) [\(rectDigest, privacy: .public)]")
            holeStore.update(stateId: stateId, rects: rects)
            host.applyLayout(rects, stateId: stateId)
        case .tileClick, .sidebarSelect, .maximizeTile, .restoreTiling, .renameSubmit,
             .minimizeTile, .restoreTile, .restoreAllMinimized,
             .acknowledgeWaiting, .reorder, .gridResize,
             .searchQuery, .searchNext, .searchPrev, .searchClose,
             .chatOpen, .chatClose, .chatJumpToTerminal, .chatResume, .exitTaskCenter,
             .confirmQuit, .cancelQuit,
             .fileOpen, .fileClose, .setShowHiddenFiles, .panelOverlayReport,
             .dismissRestoreBanner, .toggleListMode, .helpOpen:
            // 非 layoutReport 动作 → 真状态源（选中/焦点/重命名/维序/持久化等）。
            // chat 三动作（chatClose/chatJumpToTerminal/chatResume）经此路由到 TerminalService.handleAction
            // 真实装（M5 批3 native 半：切屏漏斗 + 跳转/续聊 CHAT_L1_18 裁决语义，chat-history.md §7.6/§7.7）。
            // confirmQuit/cancelQuit（DOGFOOD_M3_19）：web 退出对话框动作经此同路由到 handleAction。
            terminalService.handleAction(action)
        }
    }

    // MARK: - 冒烟 demo（env 门控，默认关闭）

    /// 推一条 content 缺席的合成 ui.state（用真启动会话 id）→ web 渲染 .tile-term-hole 透明洞
    /// → layoutReport 回流 → host 占位色透出洞区。**仅冒烟 demo**：真状态源是批4③ 的事。
    /// 默认关闭（本批 web 显示 demo fixture 属预期）；置 MUXVO_COMPOSITE_DEMO=1 启用。
    func pushCompositeDemoStateIfEnabled(terminalIds: [String], homePath: String, theme: String) {
        guard ProcessInfo.processInfo.environment["MUXVO_COMPOSITE_DEMO"] == "1",
              !terminalIds.isEmpty else { return }
        let isDark = theme != "light"
        let palette = Palette(
            background: isDark ? "#1e1e1e" : "#ffffff",
            foreground: isDark ? "#cccccc" : "#1e1e1e"
        )
        // git 门控字段与真状态源同源填（M6 批A）：env-gated 冒烟 demo 亦经 GitStatusCache 同步查
        // （homePath 一般非 git → 探针回 nil；有则点亮），与 mapSnapshot 一致不留第二处恒 nil 缺口。
        let git = terminalService.gitStatusCache.lookup(cwd: homePath)
        let terminals = terminalIds.map { id in
            TerminalSnapshot(
                id: id, state: .running, cwd: homePath,
                customName: nil, isGitRepo: git.isGitRepo, worktreeRegistered: git.worktreeRegistered,
                content: nil // 缺席 → web 走 .tile-term-hole 透明洞分支
            )
        }
        let state = UIState(
            id: "composite-demo", desc: "批3① 复合结构冒烟：content 缺席 → 洞分支",
            theme: isDark ? .dark : .light, homePath: homePath, viewMode: .tiling,
            focusedId: nil, selectedId: terminalIds.first, activeSidebarId: nil,
            maxReached: false, dragging: nil, dragOver: nil, editing: nil,
            waitingNotification: nil, searchBar: nil,
            // 裁决①-panelMode 不变量：CompositeRoot 亦是 UIState 构造点——绝不省略 mode。env-gated 冒烟
            // demo 恒 terminal（内容缺席洞分支演示，永不 taskCenter），显式置以补「每个构造点恒置」字面缺口。
            panelMode: .terminal, quitConfirm: nil, restoreBanner: nil, terminals: terminals, palette: palette
        )
        panel.pushState(state)
    }
}

// MARK: - layoutReport 陈旧丢弃闸（DOGFOOD_M3_13 F4）

/// 高水位闸：入站 layoutReport 每消息独立 Task 无 FIFO 契约，换序时陈旧报文后至会覆盖新鲜几何
///（frame 打回旧值；若陈旧值稳定 >settle 窗还会提交烧写）且 web diff 门闩死到下次真实变化。
/// 语义：seq < 高水位 → 丢弃；== → 放行（拖动期同 id 多报常态，绝不丢同 id）；> → 放行并推高；
/// 非 "s<n>" 形 id → 恒放行且不动高水位。否决「!=最新 push 即丢」——web 渲染恒滞后一拍会误杀。
/// 注：高水位随 CompositeRoot 生命周期（TerminalService 同生命周期 pushCounter 单调不清零；
/// 整页刷新 re-hello 不重置 service，无需复位）。
struct LayoutReportGate {
    private(set) var highWater: UInt64 = 0

    /// true = 放行；false = 陈旧丢弃。
    mutating func admit(stateId: String) -> Bool {
        guard let seq = CompositeRootViewController.layoutSeq(stateId) else { return true }
        if seq < highWater { return false }
        highWater = seq
        return true
    }
}

// MARK: - fs.request 文件菜单选中捕获（M6 批A）

/// NSMenu.popUp 期间收下用户所选动作（item.representedObject 存 FileMenuAction.rawValue）。
/// popUp 同步跑嵌套 runloop，pick(_:) 在菜单收起前触发，故 popUp 返回后 picked 已就位。
@MainActor
private final class FileMenuTarget: NSObject {
    var picked: FileMenuAction?
    @objc func pick(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String { picked = FileMenuAction(rawValue: raw) }
    }
}
