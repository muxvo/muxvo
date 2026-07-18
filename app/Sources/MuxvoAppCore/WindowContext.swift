// WindowContext：一套完整窗口 UI 上下文（批C/D C2，multi-window.md §1/§2.2）。
//
// 每项 = 稳定 windowId + 一份瘦身 TerminalService（本窗 UIStateProjection）+ MainWindowController
// （其 CompositeRootViewController = 本窗 WKWebView + 桥 + 渲染面）。会话本体不绑窗（§2.1，共享全局
// registry）；「哪个终端显示在哪个窗」纯属本窗 projection 投影。
//
// C2：WindowManager.contexts 恒 1 项（仍只开 1 窗）。C3/C4 才多项 + 关窗分流 + 持久化 schema v2。
import AppKit

@MainActor
public final class WindowContext {
    /// 稳定窗 id（生成即固定，不因关窗重排；§4.1/§6.3 编号规则的载体）。
    public let windowId: String
    /// 本窗瘦身 TerminalService（ui.state 真状态源的每窗胶水层）。
    public let service: TerminalService
    /// 本窗窗口控制器（复合窗口 = 下层原生渲染 + 上层透明 web chrome）。
    public let windowController: MainWindowController

    /// 本窗复合根（web chrome + 洞几何 + 桥透传）。
    public var composite: CompositeRootViewController { windowController.compositeRoot }
    /// 本窗 NSWindow（activeContext keyWindow 匹配用）。
    public var window: NSWindow? { windowController.window }

    public init(windowId: String, service: TerminalService, windowController: MainWindowController) {
        self.windowId = windowId
        self.service = service
        self.windowController = windowController
    }
}
