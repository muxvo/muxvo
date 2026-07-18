// SurfaceProvider：MuxvoKit.TerminalSurfaceProviding 的真实现（M3 由 nil→真 provider）。
//
// 接缝合同（MuxvoKit.swift:26-31 + terminal-rendering.md §0）：makeSurfaceView(attachedTo:) 从
// SessionRegistry 查会话 → 建 TerminalSurfaceView attach。视图无状态投影，绝不反向持有 render state。
// 多视图同会话（sidebar 小预览）：多次以同 SessionID 调 make 各得一个独立视图、都读同一份快照。
import AppKit
import MetalKit
import MuxvoKit
import MuxvoTerm

@MainActor
public final class SurfaceProvider: TerminalSurfaceProviding {
    private let registry: SessionRegistry
    /// var：字号缩放（DOGFOOD_M3_05）后新建视图采用当前字号（非默认 14）。applyFontSize 更新。
    private var font: FontConfig
    private let device: MTLDevice?
    /// 已建视图弱登记（zoom 广播用，不延寿）。makeSurfaceView 时登记；**仅视图释放才出表**——
    /// detach 后未释放的视图仍会收到广播，靠 detach() 置 session=nil 免疫（DOGFOOD_M3_12 僵尸
    /// surface 教训：detach 契约见 terminal-rendering.md §1.2 ☆，勿再假设 detach 自动出表）。
    private let liveSurfaces = NSHashTable<TerminalSurfaceView>.weakObjects()
    /// Cmd+F 回调（批5②）：视图请求打开搜索条（terminalId）→ app 层置 ui.state.searchBar。注入到每个新建视图。
    private let onRequestSearch: (@MainActor (String) -> Void)?

    /// - Parameters:
    ///   - registry: 会话注册表（批 3① 复合窗口装配时注入其持有的 registry）。
    ///   - font: 终端字体（默认 Menlo 14pt）。
    ///   - device: Metal 设备；nil 时视图 headless（无 GPU 环境不崩）。
    ///   - onRequestSearch: Cmd+F → 打开搜索条回调（批5②；nil 时 Cmd+F 放行给菜单）。
    public init(registry: SessionRegistry,
                font: FontConfig = FontConfig(),
                device: MTLDevice? = MTLCreateSystemDefaultDevice(),
                onRequestSearch: (@MainActor (String) -> Void)? = nil) {
        self.registry = registry
        self.font = font
        self.device = device
        self.onRequestSearch = onRequestSearch
    }

    /// 建一个 attach 到指定会话的终端视图。会话不存在则返回未 attach 的空视图（不崩，稍后可 attach）。
    /// drivesSessionResize 必须在 attach **之前**置位（m3-layout-r5 F2）：attach 内首轮
    /// syncGridToBounds 即按最终角色行事，预览永不产生 resize 候选。
    public func makeSurfaceView(attachedTo session: SessionID, drivesSessionResize: Bool) -> NSView {
        let view = TerminalSurfaceView(font: font, device: device)
        view.drivesSessionResize = drivesSessionResize
        view.onRequestSearch = onRequestSearch
        liveSurfaces.add(view)
        if let s = registry.session(for: session) {
            view.attach(s)
        } else {
            NSLog("[muxvo] SurfaceProvider: 会话 \(session.raw) 不存在，返回空视图")
        }
        return view
    }

    /// 便利：直接对已知会话建视图（复合窗口装配可绕 registry 查表）。
    public func makeSurfaceView(for session: TerminalSession) -> TerminalSurfaceView {
        let view = TerminalSurfaceView(font: font, device: device)
        view.onRequestSearch = onRequestSearch
        liveSurfaces.add(view)
        view.attach(session)
        return view
    }

    /// 字号缩放广播（DOGFOOD_M3_05）：更新新建视图默认字号 + 对所有存活视图应用 updateFontSize
    /// （含 grid 主视图与 sidebarPreview 小预览——两者皆经本 provider 建、皆在 liveSurfaces）。
    public func applyFontSize(_ size: Int) {
        font = FontConfig(family: font.family, size: CGFloat(size))
        for view in liveSurfaces.allObjects { view.updateFontSize(CGFloat(size)) }
    }

    /// 当前默认字号（测试可见）。
    public var currentFontSize: CGFloat { font.size }
}
