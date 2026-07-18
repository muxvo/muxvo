// 终端渲染面宿主（M3 复合 UI 下层）：TerminalArea 的 M3 改造——由 layoutReport 驱动的
// terminalId→surface NSView 字典，把 web 上报的洞几何套到下层原生视图上，供上层透明 webview 合成。
//
// ★ M3 提升 ProbeCore/渲染器时的架构合同（M0 报告「风险与发现」三条设计输入）：
// 1. render state 归会话所有、多视图共读——视图是无状态投影，attach 时从会话读
//    render state；绝不让多个视图各持 render state 同时 update 互抢 terminal dirty
//    （ghostty_render_state_update 会消费 dirty 状态）。
// 2. render state 更新由 dirty 驱动/节流，不得在视图 draw 路径上与 PTY feed
//    同队列 sync 竞争（探针实测该竞争使 encode 最长等待 15.4ms）。
// 3. glyph atlas 用多页 LRU；探针的 2048² 单页装满整体重建不得带入正式实现。
//
// 会话/视图分离接缝 = MuxvoKit.TerminalSurfaceProviding：真 provider（SurfaceProvider）从
// SessionRegistry 查会话建 TerminalSurfaceView attach。
import AppKit
import MuxvoBridge
import MuxvoKit
import MuxvoTermRender

// MARK: - 下层宿主视图（穿透事件汇聚）

/// C 案下层原生视图：上层 PassthroughWebView 洞区穿透下来的鼠标/键盘事件落到本视图按洞几何
/// 摆放的 TerminalSurfaceView 子视图上。本视图只做容器 + 兜底底色——**不拦事件**：默认 NSView.hitTest
/// 遍历子视图命中对应 surface，surface 自身（acceptsFirstResponder/becomeFirstResponder/keyDown，
/// 批3③ 实装）完成焦点获取与键入编码。isFlipped=false（左下原点），与 applyLayout 的 CSS→AppKit
/// 翻转一致。
final class TerminalSurfaceHostView: NSView {
    override var isFlipped: Bool { false }
}

// MARK: - 宿主视图控制器

@MainActor
final class TerminalSurfaceHostViewController: NSViewController {
    private let surfaceProvider: any TerminalSurfaceProviding

    /// 洞视图字典。键 = "terminalId#role"：同一会话的 grid 主视图与 sidebarPreview 小预览是
    /// **两个视图实例、共读同会话 render state**（M0 已验证双视图同会话），故按 role 二分键。
    private var surfaces: [String: NSView] = [:]

    /// 洞下 surface 被点击回报（DOGFOOD_M3_06，native 直报）：(terminalId, role) → CompositeRoot
    /// 映射为 tileClick / sidebarSelect 同步选中态。建 surface 时捕获 role 注入视图 onUserClick。
    var onSurfaceClick: ((String, TermRectRole) -> Void)?

    /// 洞下 surface 真人 keyDown 产出字节回报（M4b B3-3 humanControl 置位）：(terminalId, role) →
    /// CompositeRoot 对 grid 角色 worker live 洞转 HumanControlArbiter.noteHumanKey（轻接管触发）。
    /// 建 surface 时捕获 role 注入视图 onProducedKeystroke（同 onUserClick 体例）。
    var onSurfaceKeystroke: ((String, TermRectRole) -> Void)?

    /// 洞区 native 双击回报（settings-dogfood 批，PAR-13 消费端；同 onUserClick 体例）。
    var onSurfaceDoubleClick: ((String, TermRectRole) -> Void)?

    init(surfaceProvider: any TerminalSurfaceProviding) {
        self.surfaceProvider = surfaceProvider
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) 不支持") }

    override func loadView() {
        let host = TerminalSurfaceHostView()
        host.wantsLayer = true
        // 兜底底色：web 整页透明后透出的非终端区底 + 终端 surface 间「≤2 帧背景缝隙」优雅降级（S5）底色。
        // 取 web --bg-primary #0a0e14，与前端整页透明后应有的底一致（无缝）。
        host.layer?.backgroundColor = CompositeColors.bgPrimary
        view = host
    }

    /// 消费一条 layoutReport（陈旧丢弃已在上游 CompositeRootViewController.handle 的
    /// LayoutReportGate 收口，DOGFOOD_M3_13 F4——host 只收放行后的报文，自身不判序）。
    ///  - visible 洞（role != island）：确保对应 surface 视图存在（缺则经 provider 新建 attach）并套 frame（CSS→AppKit）。
    ///  - role == island：忽略（岛是 web 交互元素，不建/不摆 surface，仅供 hitTest 抠掉穿透）。
    ///  - visible=false / rects 中缺席 / 空数组：detach（移除 surface 视图，停止占用）。
    func applyLayout(_ rects: [TermRect], stateId: String) {
        let hostHeight = view.bounds.height
        var liveKeys = Set<String>()

        for r in rects where r.visible && r.role != .island {
            let key = Self.key(terminalId: r.terminalId, role: r.role)
            liveKeys.insert(key)
            let surface: NSView
            if let existing = surfaces[key] {
                surface = existing
            } else {
                // terminalId 即 native SessionID（全链路统一）。预览被动化（DOGFOOD_M3_10 + m3-layout-r5
                // F2）：仅 grid 主视图驱动共享 PTY 网格；sidebarPreview 恒被动（窄预览若下发 resize 会把
                // CC 压窄列、硬换行烧 scrollback 不可逆）。host 是唯一知 role 处；flag 经 make 参数在
                // attach **之前**定死——曾以「返回后补置位」留出 attach 竞态窗（零 bounds 2x2 候选
                // trailing 到期真调 session.resize，现场每次聚焦一条 rejected 实录）。
                surface = surfaceProvider.makeSurfaceView(attachedTo: SessionID(raw: r.terminalId),
                                                          drivesSessionResize: r.role == .grid)
                surface.translatesAutoresizingMaskIntoConstraints = true
                // native 点击回报接线（DOGFOOD_M3_06）：捕获本洞 role，转交 onSurfaceClick（terminalId 由
                // 视图侧传入=session.id.raw）。只在新建时装一次；已存在视图沿用其原有回调。
                if let sv = surface as? TerminalSurfaceView {
                    let role = r.role
                    sv.onUserClick = { [weak self] terminalId in self?.onSurfaceClick?(terminalId, role) }
                    sv.onUserDoubleClick = { [weak self] terminalId in
                        self?.onSurfaceDoubleClick?(terminalId, role)
                    }
                    sv.onProducedKeystroke = { [weak self] terminalId in
                        self?.onSurfaceKeystroke?(terminalId, role)
                    }
                }
                view.addSubview(surface)
                surfaces[key] = surface
                Log.surface.notice("attach surface \(key, privacy: .public)")
            }
            // CSS 左上 → AppKit 左下；backing 对齐取整（0.5pt 对齐，附件 B §1.2 Retina）。
            let frame = NSRect(x: r.x, y: hostHeight - r.y - r.h, width: r.w, height: r.h)
            surface.frame = view.backingAlignedRect(frame, options: .alignAllEdgesNearest)
        }

        // 未在本次 rects 出现（或 visible=false）的 surface → detach。空 rects ⇒ 全部 detach。
        // 必须**先** view.detach()（session 置 nil）再 removeFromSuperview（terminal-rendering.md §1.2 ☆，
        // DOGFOOD_M3_12）：否则被摘视图成僵尸——仍持会话引用，在字号广播/backing 变化/摘除瞬间的
        // viewDidMoveToWindow 链上以陈旧 bounds 驱动活会话 PTY resize（取证 vt=false pty=true 铁证），
        // 值变化即 SIGWINCH 烧窄段且卡死无纠正事件；顺带闭环 RenderCoordinator 帧观察者泄漏。
        for (key, surface) in surfaces where !liveKeys.contains(key) {
            (surface as? TerminalSurfaceView)?.detach()
            surface.removeFromSuperview()
            surfaces.removeValue(forKey: key)
            Log.surface.notice("detach surface \(key, privacy: .public)")
        }
    }

    /// 字号缩放广播（DOGFOOD_M3_05）：转发到 provider——provider 弱登记了所有经它建的 surface（grid 主视图
    /// + sidebarPreview 小预览），逐个 updateFontSize，且更新其后新建视图的默认字号。host.surfaces 是 provider
    /// liveSurfaces 的子集（当前 attach 的），故不必在此重复遍历。
    func applyFontSize(_ size: Int) { surfaceProvider.applyFontSize(size) }

    /// 当前 attach 的 surface 视图数（冒烟/测试观测用）。
    var attachedSurfaceCount: Int { surfaces.count }

    /// 当前 attach 的 surface 视图 frame（键 = "terminalId#role"）。e2e 评测关只读取证：
    /// 断言 surface frame 与洞 rect 重合（下层原生渲染面确在洞正后方）。
    var attachedSurfaceFrames: [String: NSRect] { surfaces.mapValues { $0.frame } }

    /// 当前 attach 的 surface 视图（e2e 评测关 first-responder 取证：判 window.firstResponder
    /// 是否为洞下 surface）。
    var attachedSurfaceViews: [NSView] { Array(surfaces.values) }

    /// 按键取 attach 的 surface 视图（键 = "terminalId#role"，如 "id#grid"）。DOGFOOD_M3_06 e2e
    /// 焦点路由取证消费：断言点击洞后 window.firstResponder === 该键对应 surface。缺则 nil。
    func attachedSurfaceView(forKey key: String) -> NSView? { surfaces[key] }

    private static func key(terminalId: String, role: TermRectRole) -> String {
        "\(terminalId)#\(role.rawValue)"
    }
}
