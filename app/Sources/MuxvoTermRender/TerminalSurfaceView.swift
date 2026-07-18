// TerminalSurfaceView：产品 Metal 终端视图（terminal-rendering.md §1/§4/§5）。
//
// M0 合同①的落实：视图是**无状态投影**——不持 render state，不碰会话 queue、不调 vt C API。
// 数据流：会话 RenderCoordinator 发布不可变 TerminalFrameSnapshot → 通知观察者(main) → 本视图
// setNeedsDisplay；draw 读 session.currentFrame()（原子指针、零锁）→ TerminalRenderer build+encode。
//
// MTKView：isPaused=true + enableSetNeedsDisplay（§1.2）——仅快照变化 / 光标闪烁相位 / 焦点变化重画。
// 多视图同会话（sidebar 小预览）天然支持：各自 attach、各自订阅、都读同一份快照。
import AppKit
import MetalKit
import MuxvoKit
import MuxvoTerm
import MuxvoTermCore
import os
import QuartzCore
import simd

/// DOGFOOD_M3_02 F5 先例：MuxvoAppCore.Log 对本模块不可见，模块内建同 subsystem Logger。
/// category 复用 "surface" 与 app 侧 attach/detach 日志同类聚合。
private let surfaceLog = Logger(subsystem: "com.muxvo", category: "surface")

@MainActor
public final class TerminalSurfaceView: MTKView {
    // MARK: 依赖 / 状态

    public private(set) var session: TerminalSession?
    private var fontConfig: FontConfig   // var：字号缩放（DOGFOOD_M3_05）换新 FontConfig
    private var renderer: TerminalRenderer
    let blink = CursorBlinkController()   // internal：视图 timer 生命周期测试可注入 blinking 后 reevaluate

    // 观察者 / timer（detach 时清理——生命周期测试断言）
    private var frameObserverToken: Int?
    private var blinkTimer: Timer?

    // 网格 resize settle（DOGFOOD_M3_12，terminal-rendering.md §1.2 ☆）：瞬态几何不触 PTY、
    // 连续几何流有界节流（trailing 80ms + maxWait 150ms）。timer 为 one-shot trailing 提交。
    private let settler = GridResizeSettler()
    private var settleTimer: Timer?

    // zoom 短程尾沿 timer（F-A dogfood-r1，2026-07-09）：字号缩放的 PTY resize 专用尾沿——末次按键后
    // ~200ms 以 force 提交绕过 F7 输出静默门（CC 流式中 zoom 不被饿死、右裁窗 ∞→~200ms），连按只重挂
    // = 合并 ≤1 次 resize（17:31 连击烧帧不回归）。与 settleTimer 独立，不经 GridResizeSettler。
    private var zoomCommitTimer: Timer?

    // bounds 尾沿 force timer（T1' 第八轮，2026-07-10）：bounds 驱动提交被 F7 门扣下时武装的 one-shot
    // 尾沿——bounds 稳定后 ~200ms 以 force 提交绕门，救「流式中聚焦切换/拖拽松手永不落地」（CC spinner
    // 亚 400ms 0 gap 可持续分钟级，静默窗永不到来；m3-r7 决策包 §H2 预授权升级路径落地）。
    // 纪律：arm-if-not-armed（F7 重试间隔可 <200ms，逐次重挂会把 force 无限推迟=复发饿死）；新几何
    // 候选 disarm 重来（下次门命中重新起算）；输出永不重置。与 zoomCommitTimer 独立（字号 zoom 归其管）。
    private var boundsForceTimer: Timer?

    // 滚轮累积 + 网格
    private var scrollAccumulator = ScrollLineAccumulator()
    /// 本视图最新计算的网格账（DOGFOOD_M3_13 F2 后语义）：**本地几何账**而非「已提交账」——
    /// settle 候选挂起期也即刻更新（选区 columns / autoscroll 边缘行第二职责）。「是否已提交」
    /// 由 syncGridToBounds 的真值对账（lastGrid == session.cols 双条件）判定，不再单靠本账。
    private var lastGrid: (cols: Int, rows: Int) = (0, 0)

    /// 预览被动投影合同（DOGFOOD_M3_10）：false = 本视图**永不**驱动 session.resize（sidebarPreview 恒被动）。
    /// 默认 true（grid 主视图驱动）；host applyLayout 建 surface 时按洞 role 置位（grid→true、preview→false）。
    /// 缘由：sidebarPreview 与 grid 共读同一会话快照，但预览几何窄——若预览也下发 resize，会把共享 PTY
    /// 压成窄列，CC 按窄 cols 硬换行（\n）烧进 scrollback 不可逆（用户 2026-07-04 报「聚焦后另一终端折窄条」）。
    /// legacy 对照：compact/sidebar tile 传 suppressResize=true（../muxvo-legacy TerminalTile.tsx:159）→
    /// XTermRenderer.tsx:514 直接 BLOCK winsize 推送，预览从不动 PTY——本标志是该语义的新版落实。
    /// 被动视图其余行为不变：点击聚焦/键入/滚轮/选区照旧（syncGridToBounds 仅砍 resize、仍维护本地 lastGrid 账）。
    public var drivesSessionResize: Bool = true

    // 鼠标序列（§4/§5）：一次按下→拖动→抬起。true = 本序列被鼠标上报消费（tracking 活跃且非 Shift），
    // 拖动/抬起继续走上报而非选区。
    private var mouseConsumedByReporting = false

    // scrollbar 拇指拖拽序列（DOGFOOD_M3_11 §5 ☆）：mouseDown 命中可见拇指 → 本序列走绝对定位（.toOffset），
    // 与 mouseConsumedByReporting / 选区互斥。scrollbarGrabOffsetY = 指针相对拇指顶的偏移（拖动维持抓点）。
    // scrollbarDragTotal/Len = mouseDown 时的 vt 几何；drag 优先用最新快照 scrollbar，快照因回底掉 scrollbar
    // 时回退到这份（拖拽中 CC 持续输出、瞬时贴底场景拇指不冻结）。
    private var scrollbarDragging = false
    private var scrollbarGrabOffsetY: CGFloat = 0
    private var scrollbarDragTotal = 0
    private var scrollbarDragLen = 0

    // 选区自动滚动（尾批 item 5）：拖出上/下边缘时的 tick timer + 方向（±1 行/tick）+ 末次命中格。
    private var autoscrollTimer: Timer?
    private var autoscrollDelta = 0
    private var autoscrollHit: PointerHit?

    // overlay：scrollbar 拇指（CALayer）+ 跳到底部浮标（NSButton）
    private let scrollbarThumb = CALayer()
    private var jumpToBottomButton: NSButton?
    private var scrollbarFadeWork: DispatchWorkItem?
    private var hoverTracking: NSTrackingArea?

    /// bench 打点 hook（批 4① muxvo-term-bench 消费）：每帧 GPU 完成时回传 (generation, 完成时刻)。
    /// ⚠️ 在 Metal 完成线程（非 main）触发——消费方自行处理线程。
    public var onFrameCompleted: (@Sendable (UInt64, DispatchTime) -> Void)?

    /// Cmd+F 请求打开该终端的搜索条（批5②）：视图 performKeyEquivalent 的 .interceptSearch 落点 →
    /// 回调到 app 层置 ui.state.searchBar{terminalId}。未接线（测试/独立视图）时 Cmd+F 放行给菜单系统。
    public var onRequestSearch: (@MainActor (String) -> Void)?

    /// 用户点击本 surface（DOGFOOD_M3_06）：mouseDown 焦点跟随后回报 app 层同步 tile 选中态
    /// （native 直报，替代洞区点击穿透 web chrome 才发 tileClick 的旧路）。带 terminalId(session.id.raw)。
    /// 未接线（测试/独立视图）时点击仅本地聚焦、不回报。每次点击都发（不防抖——重复点击的 acknowledge 清红须每次到达）。
    public var onUserClick: (@MainActor (String) -> Void)?

    /// 用户双击本 surface（settings-dogfood 批，PAR-13 消费端）：mouseDown clickCount==2 时加发
    /// （与词选并行，legacy TerminalContext dblclick 同语义——选词照走，不互斥）。Shift+双击不发
    /// （shift+click=扩选手势，DOGFOOD_M3_17）。是否触发聚焦由 app 层按 doubleClickToFocus 偏好门控。
    public var onUserDoubleClick: (@MainActor (String) -> Void)?

    /// 真人 keyDown 于本 surface 产出字节（M4b B3-3 humanControl 置位 allow-list 唯一入口，SEC-M5）：
    /// 带 terminalId(session.id.raw)。装配层对 grid 角色 worker live 洞接 HumanControlArbiter.noteHumanKey。
    /// **机器注入（SendPlan / 终端 DA-DSR 自应答走 session.write，非 keyDown）绝不经此**——结构保证「未
    /// 枚举来源不触发置位」（deny-list 漏枚举自锁 DoS 防线）。未接线（测试/独立视图）时不回报。
    public var onProducedKeystroke: (@MainActor (String) -> Void)?

    /// 输入链控制器（批3③，检查点⑩接线）：attach 时装配，detach 时拆除。
    /// keyDown/IME/粘贴/焦点编码经它走（TerminalSurfaceView+Input.swift 转发）。
    public private(set) var inputController: TerminalInputController?
    /// keyDown 一轮 interpretKeyEvents 是否已产生 insertText（IME/直插均算）——未产生才 encode。
    var imeHandledKeystroke = false

    /// 光标 cell 的屏幕矩形（IME 候选窗定位，CursorRectProviding）。无快照/无窗口回零矩形。
    func cursorRectOnScreenImpl() -> NSRect {
        guard let snapshot = session?.currentFrame(), let window else { return .zero }
        let m = renderer.glyphCache.metrics // 物理 px（@scale）
        let scale = window.backingScaleFactor
        let cw = CGFloat(m.widthPx) / scale, ch = CGFloat(m.heightPx) / scale
        // 终端行 0 在顶；AppKit 视图 y 自底向上 → 翻转。钳制态锚底（F6）：内容上移
        // contentYOffsetPx，光标视图位随之上移（与绘制/命中同一偏移源）。
        let x = CGFloat(snapshot.cursor.x) * cw
        let yTop = CGFloat(snapshot.cursor.y) * ch - CGFloat(contentYOffsetPx) / renderer.glyphCache.scale
        let local = NSRect(x: x, y: bounds.height - yTop - ch, width: cw, height: ch)
        let inWindow = convert(local, to: nil)
        return window.convertToScreen(inWindow)
    }

    // MARK: 构造

    /// - Parameters:
    ///   - session: 立即 attach 的会话；nil 则建成空视图，后续 attach()。
    ///   - font: 字体（默认 Menlo 14pt）。
    ///   - device: Metal 设备；nil（无 GPU）时视图存活但不绘制（headless）。
    public init(session: TerminalSession? = nil,
                font: FontConfig = FontConfig(),
                device: MTLDevice? = MTLCreateSystemDefaultDevice()) {
        self.fontConfig = font
        let cache = GlyphCacheRegistry.shared.cache(font: font, scale: 2, device: device)
        self.renderer = TerminalRenderer(glyphCache: cache, device: device)

        super.init(frame: .zero, device: device)
        colorPixelFormat = TerminalRenderer.colorPixelFormat
        framebufferOnly = true
        isPaused = true
        enableSetNeedsDisplay = true
        autoResizeDrawable = true
        clearColor = MTLClearColor(red: 0.118, green: 0.118, blue: 0.118, alpha: 1)  // §4.2 dark 占位
        wantsLayer = true
        setupScrollbarThumb()

        if let session { attach(session) }
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("TerminalSurfaceView 只支持代码构造") }

    // MARK: attach / detach（生命周期干净——观察者移除 / timer 停）

    /// attach 会话：订阅帧观察者(main→setNeedsDisplay)、触发首帧、按当前尺寸给会话定网格。
    public func attach(_ s: TerminalSession) {
        detach()
        session = s
        scrollAccumulator.reset()
        lastGrid = (0, 0)
        frameObserverToken = s.addFrameObserver(deliverOn: .main) { [weak self] snap in
            MainActor.assumeIsolated { self?.frameDidPublish(snap) }
        }
        // 输入链装配（批3③，⑩接线）：会话即编码接缝+写入通道；候选窗定位由本视图提供。
        inputController = TerminalInputController(
            encoding: s, writer: s, host: self, cursorRectProvider: self, config: .init())
        syncGridToBounds()
        s.requestImmediateFrame()
        reevaluateBlinkTimer()
        needsDisplay = true
    }

    /// 帧投递落点（观察者 main 回调）：常规帧走 needsDisplay 合并；配色相对上次投递变化
    /// （主题切换 / OSC 10/11/4 覆盖）时**显式 draw() 强制出帧**——isPaused+enableSetNeedsDisplay
    /// 驱动下，idle/非 key 面的 needsDisplay 不保证真正出帧，切主题时未聚焦 tile 会留在旧色
    /// （点击聚焦经 resize 才被逼出新帧），连续切换还会闪出未消费的上一主题快照（terminal-theme.md §5）。
    /// 常规 feed 帧仅多一次 TerminalColors == 比较，零常驻开销。
    private func frameDidPublish(_ snapshot: TerminalFrameSnapshot) {
        needsDisplay = true
        let colors = snapshot.colors
        defer { lastPublishedColors = colors }
        guard let last = lastPublishedColors, last != colors else { return }
        forcedPresentCountForTest += 1   // 计数在 window 守卫之前：headless 测试可断言边沿检测
        guard window != nil, !isHiddenOrHasHiddenAncestor else { return }  // 隐藏面重挂时 attach 首绘兜底
        // ≥16ms 合并窗（对抗 MINOR-2 加固）：恶意 OSC 10/11 高频交替不得迫成无 vsync 合并的
        // 显式 draw 风暴；用户级主题切换（人手节奏 ≫16ms）恒走即时路径。窗内边沿由尾沿 draw 收敛。
        let now = DispatchTime.now().uptimeNanoseconds
        if now &- lastForcedDrawNs >= Self.forcedDrawMinIntervalNs {
            lastForcedDrawNs = now
            draw()
        }
        // 尾沿 draw（合并窗内后续边沿收敛 + currentDrawable 瞬时不可得的丢帧兜底，二合一；
        // 同快照幂等、pending 单发无常驻 timer）。
        scheduleTrailingForcedDraw()
    }

    private func scheduleTrailingForcedDraw() {
        guard !trailingForcedDrawPending else { return }
        trailingForcedDrawPending = true
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .nanoseconds(Int(Self.forcedDrawMinIntervalNs))
        ) { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.trailingForcedDrawPending = false
                guard self.window != nil, !self.isHiddenOrHasHiddenAncestor else { return }
                self.lastForcedDrawNs = DispatchTime.now().uptimeNanoseconds
                self.draw()
            }
        }
    }

    /// 配色边沿显式 draw 最小间隔（合并窗，≈一帧 @60Hz）。
    private static let forcedDrawMinIntervalNs: UInt64 = 16_000_000
    private var lastForcedDrawNs: UInt64 = 0
    private var trailingForcedDrawPending = false

    /// 上次投递帧的配色（frameDidPublish 边沿检测基线；detach 清零防跨会话误判）。
    private var lastPublishedColors: TerminalColors?
    /// 测试可见：配色边沿显式 present 计数（SurfaceThemePresentTests 断言缝）。
    private(set) var forcedPresentCountForTest = 0
    /// 测试可见：边沿基线是否已由首次投递建立（消除「applyTheme 抢在首投递前」的断言竞态）。
    var lastPublishedColorsForTest: TerminalColors? { lastPublishedColors }

    /// detach：移除观察者、停 timer、清 overlay。幂等。
    public func detach() {
        if let token = frameObserverToken { session?.removeFrameObserver(token) }
        frameObserverToken = nil
        lastPublishedColors = nil
        stopBlinkTimer()
        stopAutoscroll()
        hideJumpToBottom()
        scrollbarDragging = false   // 拖拽中被 detach（如 layoutReport 剔除）：序列标志不得泄漏到下个会话
        disarmSettleTimer()         // settle 候选/timer 不得跨会话泄漏（DOGFOOD_M3_12）
        disarmZoomCommitTimer()     // zoom 尾沿 timer 不得跨会话泄漏（F-A dogfood-r1）
        disarmBoundsForceTimer()    // bounds 尾沿 force timer 同契约（T1' 2026-07-10）
        settler.cancel()
        inputController = nil
        session = nil
    }

    // 无 deinit 兜底：Swift 6 下 deinit 不能触 main-actor 隔离的 blinkTimer。
    // 清理契约 = detach()；漏 detach 时 timer 回调发现 self 已释放会自行 invalidate（见 startBlinkTimer）。

    // MARK: 焦点 / 键入（输入链批 3③ 的对接 API）

    /// 焦点变化。批 3③ 在获/失焦时调（或经 becomeFirstResponder/resignFirstResponder 自检）。
    public func setFocused(_ focused: Bool) {
        _ = blink.setFocused(focused)
        reevaluateBlinkTimer()
        needsDisplay = true
    }

    /// 键入前调（输入链批 3③）：①离底则先回底（§5 键入自动回底）②重置光标闪烁相位（§4.3）。
    /// 合二为一给输入链一个调用点；写 PTY 由输入链自身完成。
    public func prepareForKeystroke() {
        session?.ensureViewportAtBottom()
        if blink.resetPhase() { needsDisplay = true }
    }

    /// 仅重置闪烁相位（不回底）——输入链需要细粒度控制时用。
    public func resetBlinkPhase() {
        if blink.resetPhase() { needsDisplay = true }
    }

    public override var acceptsFirstResponder: Bool { true }

    /// interpretKeyEvents 对非文本键触发命令 selector；空实现防 beep（编码由 keyDown 收尾，
    /// 见 TerminalSurfaceView+Input.swift）。放 class body 内：extension 中 override 会被
    /// 当作 NSStandardKeyBindingResponding 的新 witness 触发隔离冲突。
    public override func doCommand(by selector: Selector) {}
    public override func becomeFirstResponder() -> Bool {
        // focusChanged 内部转发 host.setFocused + mode 1004 门控编码（无控制器时直接 setFocused）
        if let inputController { inputController.focusChanged(true) } else { setFocused(true) }
        return super.becomeFirstResponder()
    }
    public override func resignFirstResponder() -> Bool {
        if let inputController { inputController.focusChanged(false) } else { setFocused(false) }
        // IME 加固（DOGFOOD_M3_06）：组字中被夺焦时清 preedit——让输入法丢弃 marked text + 清视图侧
        // IME 态，避免 markedText 残留（多 tile 切焦 / 点 web 同样触发）。仅组字中动，非组字 no-op。
        if inputController?.isComposing == true {
            inputContext?.discardMarkedText()
            inputController?.imeUnmarkText()
            needsDisplay = true   // preedit overlay 清除后重绘
        }
        return super.resignFirstResponder()
    }

    // MARK: 滚轮（§5）

    public override func scrollWheel(with event: NSEvent) {
        guard let session else { return super.scrollWheel(with: event) }
        let cellHeightPoints = Double(renderer.glyphCache.metrics.heightPx) / Double(window?.backingScaleFactor ?? 2)
        let delta = scrollAccumulator.accumulate(
            deltaY: Double(event.scrollingDeltaY),
            precise: event.hasPreciseScrollingDeltas,
            cellHeightPoints: cellHeightPoints)
        guard delta != 0 else { return }
        session.scrollViewport(.delta(delta))
        showScrollbar()   // 滚动即显示（§5）
    }

    // MARK: 选区 / 鼠标（§4/§5）

    /// 一次鼠标事件命中的 cell 格 + surface 像素坐标（backing px，左上原点）。
    private struct PointerHit { let col: Int; let row: Int; let surfaceX: Double; let surfaceY: Double }

    private func pointerHit(_ event: NSEvent) -> PointerHit {
        let scale = window?.backingScaleFactor ?? 2
        let m = renderer.glyphCache.metrics                       // 物理 px @scale
        let cwPts = CGFloat(m.widthPx) / scale
        let chPts = CGFloat(m.heightPx) / scale
        let p = convert(event.locationInWindow, from: nil)        // 视图坐标（pt，y 自底向上）
        // 钳制态锚底（F6）：视图顶 = 网格 y 偏移行，命中坐标平移与绘制同源（contentYOffsetPx）。
        let offYPts = CGFloat(contentYOffsetPx) / renderer.glyphCache.scale
        let yTop = bounds.height - p.y + offYPts                  // 网格顶为 0
        let col = cwPts > 0 ? Int(floor(p.x / cwPts)) : 0
        let row = chPts > 0 ? Int(floor(yTop / chPts)) : 0
        return PointerHit(col: max(0, col), row: max(0, row),
                          surfaceX: Double(p.x * scale), surfaceY: Double(yTop * scale))
    }

    private func mouseReport(_ event: NSEvent, action: TerminalMouseReport.Action,
                             button: TerminalMouseReport.Button, hit: PointerHit) -> TerminalMouseReport {
        let f = event.modifierFlags
        return TerminalMouseReport(
            action: action, button: button,
            shift: f.contains(.shift), control: f.contains(.control),
            option: f.contains(.option), command: f.contains(.command),
            surfaceX: hit.surfaceX, surfaceY: hit.surfaceY)
    }

    /// tracking 活跃且非 Shift → 编码上报并写 PTY，返回 true（本序列已消费）。否则 false（走选区）。
    private func tryReportMouse(_ event: NSEvent, action: TerminalMouseReport.Action,
                               button: TerminalMouseReport.Button, hit: PointerHit) -> Bool {
        guard let session else { return false }
        let m = renderer.glyphCache.metrics
        let report = mouseReport(event, action: action, button: button, hit: hit)
        guard let bytes = session.encodeMouseReport(
            report, screenWidthPx: Int(drawableSize.width), screenHeightPx: Int(drawableSize.height),
            cellWidthPx: m.widthPx, cellHeightPx: m.heightPx) else { return false }
        if !bytes.isEmpty { session.write(bytes) }
        return true
    }

    public override func mouseDown(with event: NSEvent) {
        guard let session else { return super.mouseDown(with: event) }
        // F1 焦点跟随点击（DOGFOOD_M3_06）：先夺焦（焦点/1004 focus-in 先于 mouse report；AppKit 把
        // 后续 drag/up 粘住 mouseDown 视图，press-drag 不被打断；双击词选时已是 FR 由守卫跳过）+ 每次
        // 点击回报 app 层同步选中态。放在 tryReportMouse 之前。
        if window?.firstResponder !== self { window?.makeFirstResponder(self) }
        onUserClick?(session.id.raw)
        // scrollbar 拇指命中（DOGFOOD_M3_11 §5 ☆）：焦点跟随之后、tryReportMouse 之前（硬约束——vt tracking
        // 活跃时拇指点击不得被上报吃掉）。可见（opacity>0）+ 现场重算 thumbFrame（bounds+最新快照，非 layer.frame）
        // + 命中带 → 起拖拽序列、抑制淡出、消费本次按下。
        if scrollbarThumb.opacity > 0, let sb = session.currentFrame()?.scrollbar,
           let thumb = ScrollbarGeometry.thumbFrame(viewSize: bounds.size, total: sb.total,
                                                    offset: sb.offset, len: sb.len) {
            let p = convert(event.locationInWindow, from: nil)
            if ScrollbarGeometry.dragHitRect(thumb: thumb, viewSize: bounds.size).contains(p) {
                scrollbarDragging = true
                scrollbarGrabOffsetY = min(thumb.height, max(0, thumb.maxY - p.y))  // 相对拇指顶偏移，clamp 防 slop 跳变
                scrollbarDragTotal = sb.total
                scrollbarDragLen = sb.len
                scrollbarFadeWork?.cancel()   // 淡出抑制（拖住不动无新帧仍不淡）
                scrollbarThumb.opacity = 1
                return
            }
        }
        // 双击回报（settings-dogfood 批）：scrollbar 命中之后、tryReportMouse 之前——legacy DOM dblclick
        // 不受 xterm mouse-tracking 抑制，此处同语义（vim 等 tracking 活跃时双击聚焦仍可用）。词选并行不互斥。
        if event.clickCount == 2, !event.modifierFlags.contains(.shift) {
            onUserDoubleClick?(session.id.raw)
        }
        let hit = pointerHit(event)
        if tryReportMouse(event, action: .press, button: .left, hit: hit) {
            mouseConsumedByReporting = true
            return
        }
        mouseConsumedByReporting = false
        let timeNs = UInt64(max(0, event.timestamp) * 1_000_000_000)   // event.timestamp = 单调秒
        // Shift+左键 → 扩展选区（DOGFOOD_M3_17，§4 ☆）：落点在 scrollbar 拇指命中之后、§5 Shift 旁通之内
        // （tracking 活跃时 MouseReporter 对 Shift 返 nil 放行到此，extend 语义一致）。
        session.selectionPress(col: hit.col, row: hit.row,
                               surfaceX: hit.surfaceX, surfaceY: hit.surfaceY, timeNs: timeNs,
                               shiftExtend: event.modifierFlags.contains(.shift))
    }

    public override func mouseDragged(with event: NSEvent) {
        guard let session else { return super.mouseDragged(with: event) }
        // scrollbar 拇指拖拽（DOGFOOD_M3_11）：绝对定位，先于选区/上报。每事件按最新快照几何反算指针 y→目标 offset
        // （无漂移积累）；快照因回底掉 scrollbar 时回退 mouseDown 捕获的 total/len。
        if scrollbarDragging {
            let latest = session.currentFrame()?.scrollbar
            let total = latest?.total ?? scrollbarDragTotal
            let len = latest?.len ?? scrollbarDragLen
            let p = convert(event.locationInWindow, from: nil)
            if let target = ScrollbarGeometry.offsetForThumbDrag(
                viewSize: bounds.size, total: total, len: len,
                pointerY: p.y, grabOffsetY: scrollbarGrabOffsetY) {
                session.scrollViewport(.toOffset(target))
            }
            return
        }
        let hit = pointerHit(event)
        if mouseConsumedByReporting {
            _ = tryReportMouse(event, action: .motion, button: .left, hit: hit)
            return
        }
        session.selectionDrag(
            col: hit.col, row: hit.row, surfaceX: hit.surfaceX, surfaceY: hit.surfaceY,
            columns: max(1, lastGrid.cols), cellWidthPx: renderer.glyphCache.metrics.widthPx,
            screenHeightPx: Int(drawableSize.height))
        // 拖出上/下边缘 → 自动滚动（尾批 item 5）：起/停 tick timer；rawYTop 未 clamp 判方向。
        let rawYTop = Double(bounds.height - convert(event.locationInWindow, from: nil).y)
        evaluateAutoscroll(rawYTop: rawYTop, hit: hit)
    }

    public override func mouseUp(with event: NSEvent) {
        // scrollbar 拇指拖拽抬起（DOGFOOD_M3_11）：退出序列 + 重武装淡出。拖拽期无选区/autoscroll，无需清理。
        if scrollbarDragging {
            scrollbarDragging = false
            showScrollbar()
            return
        }
        stopAutoscroll()   // 抬起即停自动滚动（item 5）
        guard let session else { return super.mouseUp(with: event) }
        let hit = pointerHit(event)
        if mouseConsumedByReporting {
            _ = tryReportMouse(event, action: .release, button: .left, hit: hit)
            mouseConsumedByReporting = false
            return
        }
        session.selectionRelease(col: hit.col, row: hit.row)
    }

    // MARK: 选区自动滚动 tick（§5 边缘拖动，尾批 item 5）

    /// 评估拖动是否越过上/下边缘：越界则记方向/命中并起 tick timer，回到边缘内则停。
    private func evaluateAutoscroll(rawYTop: Double, hit: PointerHit) {
        guard let dir = SelectionAutoscroll.direction(yTop: rawYTop, viewHeight: Double(bounds.height)) else {
            stopAutoscroll(); return
        }
        autoscrollDelta = dir
        autoscrollHit = hit
        startAutoscrollTimer()
    }

    private func startAutoscrollTimer() {
        guard autoscrollTimer == nil else { return }
        let t = Timer(timeInterval: 0.05, repeats: true) { [weak self] timer in
            if self == nil { timer.invalidate(); return } // 漏 stop 的自清兜底
            MainActor.assumeIsolated { self?.autoscrollTick() }
        }
        RunLoop.main.add(t, forMode: .common)
        autoscrollTimer = t
    }

    /// 一 tick：视口滚 1 行 + 把选区扩到新露出的边缘行（viewport row 钳到网格内：上边→0、下边→rows-1）。
    private func autoscrollTick() {
        guard let session, autoscrollDelta != 0, let hit = autoscrollHit else { return }
        session.scrollViewport(.delta(autoscrollDelta))
        let edgeRow = autoscrollDelta < 0 ? 0 : max(0, lastGrid.rows - 1)
        session.selectionDrag(
            col: hit.col, row: edgeRow, surfaceX: hit.surfaceX, surfaceY: hit.surfaceY,
            columns: max(1, lastGrid.cols), cellWidthPx: renderer.glyphCache.metrics.widthPx,
            screenHeightPx: Int(drawableSize.height))
        showScrollbar()
    }

    private func stopAutoscroll() {
        autoscrollTimer?.invalidate()
        autoscrollTimer = nil
        autoscrollDelta = 0
        autoscrollHit = nil
    }

    /// 测试可见：自动滚动 timer 是否在运行。
    var autoscrollActive: Bool { autoscrollTimer != nil }

    /// 测试可见：scrollbar 拇指拖拽序列是否进行中（淡出抑制断言，照 autoscrollActive 先例）。
    var scrollbarDraggingForTest: Bool { scrollbarDragging }

    /// 测试可见：淡出 work 是否已排且未取消（对抗验收 B1——拖拽期帧路径击穿淡出抑制的直证探针）。
    var scrollbarFadePendingForTest: Bool {
        if let w = scrollbarFadeWork { return !w.isCancelled }
        return false
    }

    // MARK: draw（读快照 → build → encode → present）

    public override func draw(_ dirtyRect: NSRect) {
        autoreleasepool { renderFrame() }
    }

    private func renderFrame() {
        guard renderer.canRender,
              let session,
              let snapshot = session.currentFrame(),
              let rpd = currentRenderPassDescriptor,
              let drawable = currentDrawable
        else { return }

        // 快照驱动 clearColor（有效 bg，§4.2）与光标闪烁门控（blinking 位 §4.3）。
        let bg = snapshot.colors.background
        clearColor = MTLClearColor(red: Double(bg.r) / 255, green: Double(bg.g) / 255,
                                   blue: Double(bg.b) / 255, alpha: 1)
        if blink.setBlinking(snapshot.cursor.blinking) { reevaluateBlinkTimer() }
        let cursorMode = blink.mode(visible: snapshot.cursor.visible,
                                    inViewport: snapshot.cursor.inViewport,
                                    styleHollow: snapshot.cursor.style == .blockHollow)

        let instances = renderer.buildInstances(snapshot, cursorMode: cursorMode)

        guard let cq = commandQueueForDraw() else { return }
        let cb = cq.makeCommandBuffer()
        guard let cb else { return }
        // 钳制态锚底（F6）：会话网格大于视图时，坐标空间取网格 px、经 MTLViewport 负 y 原点上移
        // contentYOffsetPx——底部行贴视图底沿可见，顶部/右侧越界由 GPU 天然裁切。非钳制态
        // （网格 ≤ 视图）偏移为 0、viewport == drawable，与既有行为逐像素一致。
        let m2 = renderer.glyphCache.metrics
        let vp = SIMD2<Float>(max(Float(drawableSize.width), Float(snapshot.cols * m2.widthPx)),
                              max(Float(drawableSize.height), Float(snapshot.rows * m2.heightPx)))
        renderer.encode(instances, viewportSizePx: vp, originYPx: Float(contentYOffsetPx),
                        descriptor: rpd, commandBuffer: cb)

        // bench 打点：GPU 完成回调回传 (generation, 完成时刻)。
        // ⚠️ 闭包必须显式 @Sendable：在 MainActor 方法体内形成的非 Sendable 闭包会继承 actor
        // 隔离并携带动态检查——Metal 完成线程触发时 dispatch_assert_queue 失败 SIGTRAP
        // （2026-07-02 批4 bench 实崩定位，.ips Thread com.Metal.CompletionQueueDispatch）。
        // @Sendable 闭包不继承 actor 隔离；捕获物（cb2 本身 @Sendable、gen 值类型）均安全。
        let gen = instances.generation
        if let cb2 = onFrameCompleted {
            cb.addCompletedHandler { @Sendable _ in cb2(gen, DispatchTime.now()) }
        }
        cb.present(drawable)
        cb.commit()
        renderer.glyphCache.frameBoundary()  // 帧边界：驱逐（若有压力）+ 帧号推进（§3）

        updateScrollbarOverlay(snapshot)
    }

    /// 视图侧独立 command queue（renderer 的 queue 私有；此处另建一条给 present 路径）。
    private var _drawQueue: MTLCommandQueue?
    private func commandQueueForDraw() -> MTLCommandQueue? {
        if let q = _drawQueue { return q }
        _drawQueue = device?.makeCommandQueue()
        return _drawQueue
    }

    // MARK: 光标闪烁 timer

    private func reevaluateBlinkTimer() {
        if blink.timerShouldRun { startBlinkTimer() } else { stopBlinkTimer() }
    }

    private func startBlinkTimer() {
        guard blinkTimer == nil else { return }
        let t = Timer(timeInterval: CursorBlinkController.period, repeats: true) { [weak self] timer in
            // 回调恒在 main RunLoop；timer 只在隔离块外触碰（Swift 6 sending 约束）。
            if self == nil { timer.invalidate(); return } // 漏 detach 的自清兜底
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.blink.advancePhase() { self.needsDisplay = true }
            }
        }
        RunLoop.main.add(t, forMode: .common)
        blinkTimer = t
    }

    private func stopBlinkTimer() {
        blinkTimer?.invalidate()
        blinkTimer = nil
    }

    /// 测试可见：timer 是否在运行。
    var blinkTimerActive: Bool { blinkTimer != nil }
    /// 是否持有会话（detach 契约断言口，DOGFOOD_M3_12；host 测试非 @testable 故 public）。
    public var isAttached: Bool { session != nil }
    var currentCursorMode: CursorRenderMode {
        guard let snap = session?.currentFrame() else { return .hidden }
        return blink.mode(visible: snap.cursor.visible, inViewport: snap.cursor.inViewport,
                          styleHollow: snap.cursor.style == .blockHollow)
    }

    // MARK: 尺寸 / scale

    public override func layout() {
        super.layout()
        syncGridToBounds()
        layoutOverlay()
    }

    public override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        refreshGlyphCacheForScale()
        installHoverTracking()
    }

    public override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        refreshGlyphCacheForScale()
    }

    /// backing scale 变化 → 换该 scale 的共享字形缓存（合同③：不另建、复用 registry），重算网格。
    private func refreshGlyphCacheForScale() {
        let scale = window?.backingScaleFactor ?? 2
        renderer.glyphCache = GlyphCacheRegistry.shared.cache(font: fontConfig, scale: scale, device: device)
        lastGrid = (0, 0)  // 度量变 → 强制重定网格
        syncGridToBounds()
        needsDisplay = true
    }

    /// 字号缩放消费（DOGFOOD_M3_05，terminal-input.md §8）：换新 FontConfig（同 family、新 size）→
    /// 从 registry 取对应 scale 的共享字形缓存（Registry 按 (family,size,scale) 键取**新实例**，非重建
    /// 旧 cache——合同③ GlyphCache.fullRebuildCount 不受影响，换的是缓存实例不是重建单个缓存）→ cell 度量
    /// 随新字号变化 → 走既有 syncGridToBounds/resize 路径按新度量重报 cols/rows（cell 变大→同 view 尺寸
    /// 格子变少→TIOCSWINSZ）→ 重绘。绘制合同①仍守：draw 只读快照、零锁、零 C 调用，本方法在 main 换缓存指针。
    public func updateFontSize(_ size: CGFloat) {
        guard size != fontConfig.size else { return }
        fontConfig = FontConfig(family: fontConfig.family, size: size)
        let scale = window?.backingScaleFactor ?? 2
        renderer.glyphCache = GlyphCacheRegistry.shared.cache(font: fontConfig, scale: scale, device: device)
        // zoom 短程尾沿强制提交（2026-07-09 dogfood 裁决：绕输出门防饿死+合并连击防烧帧）：字形每按
        // 即变（上方已换缓存度量），PTY resize 改走末次按键后 ~200ms 的 zoom 专用尾沿 timer，到期以
        // force 提交绕过 F7 输出静默门——CC 流式（spinner 亚 400ms 持续重绘）中 zoom 不再被门饿死永不
        // 落地（右裁窗 ∞→~200ms 无感），连按只重挂 timer = 合并 ≤1 次 resize（17:31 连击烧帧不回归）。
        // 旧 settle 候选度量口径已失效撤销；被动视图（预览也收全量 zoom 广播）只记本地账不驱 PTY（M3_10）。
        // bounds 尾沿 force 同撤（T1'）：字号变后旧度量口径的 force 目标已失效，zoom 尾沿接管本手势。
        settler.cancel()
        disarmSettleTimer()
        disarmBoundsForceTimer()
        if session != nil {
            if drivesSessionResize {
                armZoomCommitTimer()
            } else if let g = gridSizeFromBounds() {
                lastGrid = g // 被动账（选区/autoscroll 第二职责，真实几何不钳）
            }
        }
        needsDisplay = true
    }

    /// 当前字号（缩放广播/测试可见）。
    public var currentFontSize: CGFloat { fontConfig.size }
    /// 当前 cell 高（物理 px @scale；缩放度量变化测试可见）。
    var cellHeightPxForTest: Int { renderer.glyphCache.metrics.heightPx }
    /// 当前 cell 宽/高（物理 px @scale；网格换算取证——单测 + e2e item1 共用，harness 非 @testable 故 public）。
    public var cellSizePxForTest: (w: Int, h: Int) {
        (renderer.glyphCache.metrics.widthPx, renderer.glyphCache.metrics.heightPx)
    }

    /// 当前 scrollbar 拇指 frame（视图坐标，AppKit 左下原点；DOGFOOD_M3_11 e2e item7 拖拽取点用，harness
    /// 非 @testable 故 public）。无快照/无 scrollbar/无可滚 → nil。命中判定同源（现场 bounds+最新快照重算）。
    public func scrollbarThumbFrameForTest() -> CGRect? {
        guard let sb = session?.currentFrame()?.scrollbar else { return nil }
        return ScrollbarGeometry.thumbFrame(viewSize: bounds.size, total: sb.total,
                                            offset: sb.offset, len: sb.len)
    }

    /// settle 时钟（毫秒，DOGFOOD_M3_12）：默认真实单调钟；测试注入假时钟确定性驱动
    /// settle 窗（照 StateDebouncer/GridResizeSettler 注入惯例）。
    public var settleNowMs: () -> UInt64 = { DispatchTime.now().uptimeNanoseconds / 1_000_000 }

    /// trailing settle 到期提交（timer 回调与测试共用入口；未到期按 dueInMs 重挂）。
    public func flushGridSettle() {
        disarmSettleTimer()
        let now = settleNowMs()
        if settler.flush(nowMs: now) != nil {
            // 提交前以现时 bounds 复核（m3-layout-r5 F2·消 TOCTOU）：候选录制后 frame 可能已变
            // （timer 与 layout 次序无契约；现场 2x2 记录曾与 flush 时刻 boundsPt 严重不符）。
            // 候选仅作触发，提交值 = 现时几何（过 F6 下限钳制）；退化则弃（后续 layout 重录）。
            guard let g = drivingGridSizeFromBounds() else { return }
            commitGrid(cols: g.cols, rows: g.rows, settled: "trailing")
        } else if let due = settler.dueInMs(nowMs: now), due > 0 {
            armSettleTimer(afterMs: due) // 假时钟未推满/真 timer 早醒：按剩余量重挂
        }
    }

    /// one-shot trailing timer（照 blinkTimer 惯例：.common 模式——trailing 提交多发生在鼠标
    /// tracking runloop 模式（分隔条/窗口拖动松手前后），default 模式 timer 会僵死）。
    private func armSettleTimer(afterMs ms: UInt64) {
        settleTimer?.invalidate()
        let t = Timer(timeInterval: Double(ms) / 1000.0, repeats: false) { [weak self] timer in
            if self == nil { timer.invalidate(); return }
            MainActor.assumeIsolated { self?.flushGridSettle() }
        }
        RunLoop.main.add(t, forMode: .common)
        settleTimer = t
    }

    private func disarmSettleTimer() {
        settleTimer?.invalidate()
        settleTimer = nil
    }

    /// zoom 短程尾沿窗（F-A dogfood-r1，2026-07-09；v1 常量）：字号连击末次按键后此值提交 PTY resize。
    /// 单按截断窗 ~此值（无感）；连按每次重挂 timer → 仅末次幸存回调 force 提交一次（合并 ≤1 帧 Ink 烧写）。
    static let zoomCommitTrailingMs: UInt64 = 200

    /// zoom 尾沿到期提交（timer 回调与测试共用入口，照 flushGridSettle 先例）：以现时 bounds 复算目标
    /// 网格（TOCTOU 安全，候选录制后 frame 可能已变）+ force 绕 F7 输出静默门直落——流式中 zoom 不饿死。
    /// 被动视图/退化 bounds → no-op（drivingGridSizeFromBounds 返 nil）。
    public func flushZoomCommit() {
        disarmZoomCommitTimer()
        guard drivesSessionResize, let g = drivingGridSizeFromBounds() else { return }
        commitGrid(cols: g.cols, rows: g.rows, settled: "zoom", force: true)
    }

    /// one-shot 短程尾沿 timer（照 armSettleTimer 惯例挂 .common——zoom 可发生在菜单/鼠标 tracking
    /// runloop 模式）。连按重挂 = 合并（前一 timer invalidate，仅末次到期的回调 force 提交一次）。
    private func armZoomCommitTimer() {
        zoomCommitTimer?.invalidate()
        let t = Timer(timeInterval: Double(Self.zoomCommitTrailingMs) / 1000.0, repeats: false) { [weak self] timer in
            if self == nil { timer.invalidate(); return }
            MainActor.assumeIsolated { self?.flushZoomCommit() }
        }
        RunLoop.main.add(t, forMode: .common)
        zoomCommitTimer = t
    }

    private func disarmZoomCommitTimer() {
        zoomCommitTimer?.invalidate()
        zoomCommitTimer = nil
    }

    /// bounds 尾沿 force 窗（T1' 2026-07-10；v1 常量，与 zoomCommitTrailingMs 同值但独立，可单独调参）：
    /// F7 门首次扣下 bounds 提交后此值到期 force 落地。真机若觉每手势 ≤1 帧残影过密可上调（多等自然
    /// 静默窗、聚焦铺满变慢）——默认 200ms 取「体感即时」。
    static let boundsForceTrailingMs: UInt64 = 200

    /// bounds 尾沿到期提交（timer 回调与测试共用入口，照 flushZoomCommit 先例）：以现时 bounds 复算
    /// 目标网格（TOCTOU 安全，候选录制后 frame 可能已变）+ force 绕 F7 输出静默门直落——流式中聚焦
    /// 切换/拖拽松手不再饿死。落地后收编 settler 候选（残余失配由 syncGridToBounds 真值对账自愈）。
    /// 被动视图/退化 bounds → no-op（drivingGridSizeFromBounds 返 nil，留 layout 自愈）。
    public func flushBoundsForceCommit() {
        disarmBoundsForceTimer()
        guard drivesSessionResize, let g = drivingGridSizeFromBounds() else { return }
        commitGrid(cols: g.cols, rows: g.rows, settled: "trailing-force", force: true)
        settler.cancel()
        disarmSettleTimer()
    }

    /// arm-if-not-armed（T1' 头号实现纪律）：已武装则不重挂——F7 重试间隔 max(80, 400-idle) 可
    /// <200ms，若每次门命中都重挂，force 会被重试链无限推迟（回到饿死本身）。重挂只由新几何候选触发
    /// （syncGridToBounds disarm 后下次门命中再挂）；输出永不重置。one-shot 挂 .common（照
    /// armSettleTimer 惯例：bounds 提交多发生在拖拽 tracking runloop 模式）。
    private func armBoundsForceTimerIfNeeded() {
        guard boundsForceTimer == nil else { return }
        let t = Timer(timeInterval: Double(Self.boundsForceTrailingMs) / 1000.0, repeats: false) { [weak self] timer in
            if self == nil { timer.invalidate(); return }
            MainActor.assumeIsolated { self?.flushBoundsForceCommit() }
        }
        RunLoop.main.add(t, forMode: .common)
        boundsForceTimer = t
    }

    private func disarmBoundsForceTimer() {
        boundsForceTimer?.invalidate()
        boundsForceTimer = nil
    }

    /// bounds 尾沿 force timer 武装态（测试可见：A13 静默守恒 / A14 flap 撤销断言用）。
    public var boundsForceTimerArmedForTest: Bool { boundsForceTimer != nil }

    /// bounds 尾沿 force timer 到期时刻（测试可见：A12b 直测 arm-if-not-armed——门重试链再命中
    /// fireDate 必须不后移；对抗验收 MINOR-1 回修，防「每命中重挂→force 被无限推迟」回归无测覆盖）。
    public var boundsForceTimerFireDateForTest: Date? { boundsForceTimer?.fireDate }

    /// 网格下限（m3-layout-r5 F6·用户拍板 A 案 2026-07-07；F8 改物理空间本体·2026-07-07 深夜；
    /// **m3-r7 O1a·宽度下限退役·用户裁决 2026-07-09**）：高度向每个会话恒拥有至少 **396pt 物理
    /// 排版高度**（= 24 行 @ 默认 Menlo14 cell 33px@2x；矮 tile 显示裁切窗口、光标跟随锚底 F6b，
    /// Ink 上擦预算依赖行数下限）；下限**行数** = 纸高在当前 cell 度量下的容量，随字号自动换算。
    /// 宽度向 680pt「纸宽」已退役：它使一切 <680pt 的 tile（三列平铺 472pt 实测）恒按 80 列排版、
    /// 左锚右裁 25 列/31%，且变窄永不 reflow——六轮未根治「右侧遮挡」的恒态主因（m3-r7 红档
    /// m3-r7-red-e2e-item39.md + 标尺像素证据 + 真机日志 crossover 恰 680pt：665pt 钳 52 列 /
    /// 694pt 跟随 53 列）。宽度恒 bounds 主导（窄 tile 列数=真实容量、reflow 全可见）；误拖极窄由
    /// gridSizeFromBounds <10×2 退化防御兜底。F8「随字号换算」语义保留在高度轴。v1 常量。
    static let gridFloorHeightPt: CGFloat = 396
    /// 高度下限行数换算（纯函数，layout/flush/zoom 三路径同源）。宽度轴无下限（O1a）。
    static func gridFloorRows(cellH: Int, scale: CGFloat) -> Int {
        max(1, Int(gridFloorHeightPt * scale) / max(1, cellH))
    }

    /// 钳制态内容 y 偏移（物理 px，正值 = 内容上移）——**光标跟随钳制，贴底优先**（F6b，活体案例四
    /// 勘误：初版恒锚底把新 spawn shell 的顶部提示符裁掉 → 新建 tile 全黑）。语义 = 可见窗口必须
    /// 含光标行：offset = clamp((cursor.y+1)×ch − viewHpx, 0, maxOff)；空会话/光标在顶 → 0（锚顶），
    /// 满屏光标在底 → maxOff（锚底），光标出 viewport（scrollback 回看）→ maxOff。仅驱动视图且
    /// 「会话网格高于视图」时非零；renderFrame / pointerHit / cursorRectOnScreenImpl 三处**共用此
    /// 单一来源**（防钳制态下绘制与命中/光标坐标偏斜）。列锚左恒无 x 偏移（GPU 右侧天然裁切）。
    var contentYOffsetPx: Int {
        guard drivesSessionResize, let session else { return 0 }
        let ch = renderer.glyphCache.metrics.heightPx
        guard ch > 0 else { return 0 }
        let viewHpx = Int(bounds.height * renderer.glyphCache.scale)
        // 网格行数优先取快照（与绘制同源）；快照未备时退 session 账（两者仅在 resize 后瞬窗不同）。
        let snap = session.currentFrame()
        let rows = snap?.rows ?? Int(session.rows)
        let maxOff = max(0, rows * ch - viewHpx)
        guard maxOff > 0 else { return 0 }
        guard let cursor = snap?.cursor, cursor.inViewport else { return maxOff }
        return min(maxOff, max(0, (cursor.y + 1) * ch - viewHpx))
    }
    /// 测试可见（钳制锚底断言）。
    public var contentYOffsetPxForTest: Int { contentYOffsetPx }

    /// 驱动路径的目标网格 = 列随 bounds 真实容量（O1a 宽度下限退役，2026-07-09 用户裁决）、
    /// 行过高度下限钳制（F8 随 cell 度量换算）。被动预览不经此（本地账用真实几何，选区第二职责）。
    private func drivingGridSizeFromBounds() -> (cols: Int, rows: Int)? {
        guard let g = gridSizeFromBounds() else { return nil }
        let m = renderer.glyphCache.metrics
        return (g.cols, max(g.rows, Self.gridFloorRows(cellH: m.heightPx, scale: renderer.glyphCache.scale)))
    }

    /// bounds→网格换算单一来源（m3-layout-r5 F2）：度量未备或退化 bounds → nil，不产生任何账/候选。
    /// 退化门槛 = 会话防御下限（<10×2，TerminalSession.resize 同门槛）：attach 瞬间 frame 未套的
    /// 0pt 中态（曾以 2x2 候选进 settler、trailing 到期真调 session.resize 靠防御侥幸拦下——
    /// 2026-07-07 现场每次聚焦一条 `resize rejected 2x2`）从源头消失。
    /// 权威分子 = bounds(pt) × 字形缓存 scale：与分母 metrics（同一 cache 实例 @同一 scale 测得）
    /// 构造性同源。drawableSize 由 MTKView 惰性刷新，首帧竞态窗口内可为 contentsScale=1 的
    /// 陈旧半值，绝不作网格依据（DOGFOOD_M3_07 左上 1/4 根因）。
    private func gridSizeFromBounds() -> (cols: Int, rows: Int)? {
        let cw = renderer.glyphCache.metrics.widthPx
        let ch = renderer.glyphCache.metrics.heightPx
        guard cw > 0, ch > 0 else { return nil }
        let scale = renderer.glyphCache.scale
        let cols = Int(bounds.width * scale) / cw
        let rows = Int(bounds.height * scale) / ch
        guard cols >= 10, rows >= 2 else { return nil }
        return (cols, rows)
    }

    /// 输出静默门阈值（m3-layout-r5 F7；T1' 2026-07-10 语义自「饿死门」改「合并窗」）：会话最近一次
    /// PTY 输出距今小于此值 = 「流式中」，尺寸变更推迟——流式中的 Ink 活动帧是整条未完成消息（可达
    /// 几百行），reflow 会把整帧烧进 scrollback（活体案例五：三次聚焦进出 × CC 流式 = 长提示词重复 3 份）。
    /// 原契约「推迟到输出停顿、无上限」的假设（400ms < CC token 流典型停顿，静默窗数秒内必命中）被
    /// 真机证伪：CC「Waiting for background agent」spinner 亚 400ms 0 gap 重绘可持续分钟级——聚焦
    /// 切换/拖拽松手的网格提交被无限饿死（第八轮 dogfood 测试3 实证）。T1' 新契约：门只合并不饿死——
    /// 首次扣下时武装 boundsForceTrailingMs 尾沿 force，bounds 稳定后 ≤~(settle+force) 必落地；
    /// 烧录守「每手势 ≤1 份」既有地板（与字号 zoom 豁免 F-A 同价）。`yes` 类 0 间隙程序自「滞留至
    /// 停止」改「稳定即落」（该类程序本就最不怕 reflow）。
    static let outputQuietMs: UInt64 = 400

    /// 网格提交收口：vt+TIOCSWINSZ（session.resize 原子收口）+ lastGrid 账 + 取证日志。
    /// settled 取证维度：zoom=字号短程尾沿 force 绕静默门（F-A，见 flushZoomCommit）、trailing-force=
    /// bounds 尾沿 force 绕静默门（T1'，见 flushBoundsForceCommit）、maxwait=连续流内联（已退役，见
    /// syncGridToBounds）、trailing=静默到期。
    /// force=true 仅两条尾沿用（zoom / trailing-force，均已在视图层合并 ≤1 次不逐帧烧写）；其余缺省 false。
    private func commitGrid(cols: Int, rows: Int, settled: String, force: Bool = false) {
        guard let session else { return }
        // 被动视图任何路径不得提交（m3-layout-r5 F2 带式保险：角色先于 attach 置位后本 guard
        // 常态不可达，防将来调用序重排复活 DOGFOOD_M3_10 预览压窄）。
        guard drivesSessionResize else { return }
        // 输出静默门（F7，T1' 起=合并窗非饿死门）：目标尺寸会真变网格 且 会话输出活跃 → 候选回炉
        // settler、按剩余静默量重挂 timer 重试（输出一停即落地）；同时武装 bounds 尾沿 force
        // （arm-if-not-armed，见 armBoundsForceTimerIfNeeded）——输出不停也在 ~200ms 后 force 落地，
        // 流式中聚焦切换/拖拽松手不再被亚 400ms spinner 无限饿死（第八轮）。同尺寸幂等提交不涉门
        // （session.resize 短路无害）；从未输出过的会话（msSinceLastOutput=nil，含隔离测试装配）恒
        // 放行——A8 守恒（该路径也永不武装 force timer——A13 守恒）。
        // force=true（zoom 尾沿 F-A / bounds 尾沿 T1'）绕本门直落：两者均已在视图层经 ~200ms 尾沿
        // 合并、每手势 ≤1 次不逐帧烧写，故豁免静默门（连击/连变风暴另由各自尾沿防）。
        if !force,
           cols != Int(session.cols) || rows != Int(session.rows),
           let idle = session.msSinceLastOutput(), idle < Self.outputQuietMs {
            _ = settler.record(cols: cols, rows: rows, nowMs: settleNowMs(), allowMaxWait: false)
            armSettleTimer(afterMs: max(GridResizeSettler.settleMs, Self.outputQuietMs &- idle))
            armBoundsForceTimerIfNeeded()
            surfaceLog.debug("grid sync 静默门推迟 [\(String(session.id.raw.prefix(8)), privacy: .public)] \(cols)x\(rows) idleMs=\(idle)")
            return
        }
        // 走到此处必然提交：任何在途 bounds 尾沿 force 已被本次提交收编（防到期重复提交同值——
        // 幂等虽无害，但多一条取证日志行会污染时间线）。
        disarmBoundsForceTimer()
        let cw = renderer.glyphCache.metrics.widthPx
        let ch = renderer.glyphCache.metrics.heightPx
        guard cw > 0, ch > 0 else { return }
        let beforeCols = Int(session.cols)
        let beforeRows = Int(session.rows)
        let accepted = session.resize(cols: UInt16(min(cols, 1000)), rows: UInt16(min(rows, 1000)),
                                      cellWidthPx: UInt32(cw), cellHeightPx: UInt32(ch))
        if accepted { lastGrid = (cols, rows) }
        // .notice 持久化（DOGFOOD_M3_13 F1）+ 提交前会话真值（before）+ 会话短 ID（m3-layout-r5 F5：
        // 多会话时间线归属此前靠事件相邻性推断，不可持续）——事后 log show 可还原
        // 「谁在什么几何下把会话从什么值改成什么值」全时间线。
        surfaceLog.notice("grid sync [\(String(session.id.raw.prefix(8)), privacy: .public)] \(cols)x\(rows) before=\(beforeCols)x\(beforeRows) boundsPt=\(Int(self.bounds.width))x\(Int(self.bounds.height)) scale=\(self.renderer.glyphCache.scale) cellPx=\(cw)x\(ch) accepted=\(accepted) settled=\(settled, privacy: .public)")
    }

    /// 按 bounds 与 cell 度量给会话定网格（网格未变则不下发）。
    private func syncGridToBounds() {
        guard let session else { return }
        // 换算单一来源（F2）：退化 bounds（装配中态）不产生任何账/候选，直接返回。
        guard let raw = gridSizeFromBounds() else { return }
        // 被动视图（sidebarPreview，DOGFOOD_M3_10）：绝不下发 resize，但仍记本地 lastGrid（选区 columns
        // / autoscroll 边缘行的第二职责，用本视图自身**真实几何**——不过 F6 钳制）。角色现已先于
        // attach 置位（F2），残留候选常态不存在；hasPending 清除为带式保险。debug 级日志（防刷屏）。
        guard drivesSessionResize else {
            lastGrid = raw
            if settler.hasPending { settler.cancel(); disarmSettleTimer() }
            disarmBoundsForceTimer() // 带式保险（被动视图 commitGrid 有 guard，本 timer 常态不可能武装）
            surfaceLog.debug("grid sync passive-skip \(raw.cols)x\(raw.rows) boundsPt=\(Int(self.bounds.width))x\(Int(self.bounds.height))")
            return
        }
        // 网格下限钳制（F6/F8；O1a 起仅高度轴，2026-07-09 用户裁决）：列随 bounds 真实容量
        //（宽度下限退役——三列窄 tile 恒裁根因），行低于 396pt 纸高容量时钳到该容量（默认字号=24 行）。
        let m = renderer.glyphCache.metrics
        let floorRows = Self.gridFloorRows(cellH: m.heightPx, scale: renderer.glyphCache.scale)
        let (cols, rows) = (raw.cols, max(raw.rows, floorRows))
        // 早退双条件（DOGFOOD_M3_13 F2 真值对账）：几何 == 视图私账 lastGrid **且** 私账 == 会话
        // 真值（stateLock 短临界区读，主线程安全）。只信私账曾把「外因烧窄」钉死成永久（E1-Top1：
        // 唯一纠正入口被 cols==lastGrid 挡住且 cancel 掉候选）——真值失配时必须走提交路径自愈。
        let truthMatches = Int(session.cols) == cols && Int(session.rows) == rows
        if cols == lastGrid.cols && rows == lastGrid.rows && truthMatches {
            // 几何回到已提交值且会话在位（settle 窗内宽→窄→宽 flap 归零）：撤销未提交候选。
            // cancel 同样以真值一致为门槛——失配期间的纠正候选不得被 flap 撤销。
            // bounds 尾沿 force 同撤（T1' A14）：flap 归零后无事可提交，到期 force 只会幂等重提同值。
            if settler.hasPending { settler.cancel(); disarmSettleTimer() }
            disarmBoundsForceTimer()
            return
        }
        if cols == lastGrid.cols && rows == lastGrid.rows {
            // settle 在途的瞬态失配是常态（候选已在录、timer 已挂）：不重录不告警（m3-layout-r5 F3）。
            // 重录会重置 trailing 且 settle-only 无 maxWait 兜底——≥12.5Hz 同几何 layout 流可把提交
            // 饿死无上限（2026-07-07 现场 09:28:07 单秒 19 条失配重录实录）。静止期真失配（外因烧写，
            // E1-Top1）无在途候选，仍走重提交自愈。
            if settler.hasPending { return }
            surfaceLog.notice("grid sync 真值失配 [\(String(session.id.raw.prefix(8)), privacy: .public)] view=\(cols)x\(rows) session=\(Int(session.cols))x\(Int(session.rows)) → 重提交（自愈）")
        }
        // 首帧/度量重置（lastGrid==(0,0)）不再直通（DOGFOOD_M3_13 F3 收编）：错误视口下的首帧
        // rect 曾绕过 settler 直达 PTY（H-window 实录 333×569→31 列烧写）。attach /
        // refreshGlyphCacheForScale 路径统一经 settler——trailing 80ms 内视口纠正即零烧写；
        // zoom（用户离散动作、bounds 为视图自身真值）保留立即提交，见 updateFontSize。
        // 一切连续几何流一律 settle-only（m3-layout-r5 F1，撤 DOGFOOD_M3_16 的 inLiveResize 豁免）：
        // 窗口边拖拽期 maxWait 每 ~150ms 内联提交一个中间宽度，逐个命中活动 Ink 帧烧录永久残骸
        // （2026-07-07 现场四次拖拽实录，每拖 ~10 次已应用 resize ×3 tile）。原豁免所引
        // PRD REQ-TERM_GRID-011 只管辖竖向分隔条、不覆盖窗口 resize（错挂，五轮考证）。用户裁决
        // （2026-07-07）：拖拽中不重排、松手（报文静默 80ms）一次到位。maxWait 机制留存
        // GridResizeSettler（库级已测），生产不再启用。
        switch settler.record(cols: cols, rows: rows, nowMs: settleNowMs(), allowMaxWait: false) {
        case .commitNow(let c, let r):
            commitGrid(cols: c, rows: r, settled: "maxwait") // 不可达（allowMaxWait=false）；留 case 穷举
        case .scheduled(let due):
            // lastGrid 即刻记本地账（选区 columns / autoscroll 边缘行的第二职责——settle 窗内
            // 选区几何不得瘸腿）。账已记而未提交 → 下次 layout 真值失配走 F3 门（在途不重录、
            // 静止期自愈），trailing 到期必提交，无活锁。
            // bounds 尾沿 force disarm（T1'）：新几何候选 = bounds 还在变（拖拽中/聚焦布局多报），
            // 尾沿从下次门命中重新起算——保「拖拽中不重排、稳定后一次到位」（R5 用户裁决不减力）。
            lastGrid = (cols, rows)
            disarmBoundsForceTimer()
            armSettleTimer(afterMs: due)
        }
    }

    // MARK: scrollbar overlay + 跳到底部浮标（§5）

    private func setupScrollbarThumb() {
        scrollbarThumb.backgroundColor = NSColor(calibratedWhite: 0.6, alpha: 1).cgColor
        scrollbarThumb.cornerRadius = ScrollbarGeometry.widthPx / 2
        scrollbarThumb.opacity = 0
        scrollbarThumb.zPosition = 100
        layer?.addSublayer(scrollbarThumb)
    }

    private func updateScrollbarOverlay(_ snapshot: TerminalFrameSnapshot) {
        // scrollbar 数据仅在离底/本帧滚动时由快照携带（§5）；无则视口在底，隐藏拇指 + 跳底浮标。
        if let sb = snapshot.scrollbar,
           let frame = ScrollbarGeometry.thumbFrame(viewSize: bounds.size, total: sb.total,
                                                     offset: sb.offset, len: sb.len) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            scrollbarThumb.frame = frame
            CATransaction.commit()
        }
        if snapshot.viewportActive {
            hideJumpToBottom()
        } else {
            showJumpToBottom()
            showScrollbar()
        }
    }

    private func showScrollbar() {
        scrollbarFadeWork?.cancel()
        scrollbarThumb.opacity = 1
        // 拖拽期只保持显形、不排淡出（对抗验收 B1）：帧路径（updateScrollbarOverlay 每帧离底时
        // 调本方法）会击穿 mouseDown 的一次性 cancel——按住不动 ≥1.2s 拇指在手里淡掉。
        // mouseUp 先清 scrollbarDragging 再调本方法 → 重武装自然恢复。
        guard !scrollbarDragging else { return }
        let work = DispatchWorkItem { [weak self] in self?.scrollbarThumb.opacity = 0 }
        scrollbarFadeWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: work)  // 闲置 1.2s 淡出
    }

    private func showJumpToBottom() {
        if jumpToBottomButton == nil {
            let b = NSButton(title: "▾", target: self, action: #selector(jumpToBottomTapped))
            b.bezelStyle = .circular
            b.translatesAutoresizingMaskIntoConstraints = false
            addSubview(b)
            jumpToBottomButton = b
            layoutOverlay()
        }
        jumpToBottomButton?.isHidden = false
    }

    private func hideJumpToBottom() {
        jumpToBottomButton?.isHidden = true
    }

    private func layoutOverlay() {
        guard let b = jumpToBottomButton else { return }
        let size: CGFloat = 28
        b.frame = CGRect(x: bounds.maxX - size - 14, y: bounds.minY + 14, width: size, height: size)
    }

    @objc private func jumpToBottomTapped() {
        session?.scrollViewport(.bottom)
    }

    // MARK: 悬停显示 scrollbar（§5）

    private func installHoverTracking() {
        if let t = hoverTracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds,
                               options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        hoverTracking = t
    }

    public override func mouseEntered(with event: NSEvent) {
        if session?.currentFrame()?.scrollbar != nil { showScrollbar() }
    }
}
