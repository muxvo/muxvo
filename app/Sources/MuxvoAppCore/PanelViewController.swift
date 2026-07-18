// 面板区（M3 复合 UI 上层）：透明 PassthroughWebView 全窗铺满承载 web/ 前端 chrome，
// 洞区 hitTest 穿透到下层 TerminalSurfaceHostView，其余交 web。
// BridgeBus 接线（M1 任务 6）：configuration 注册 .page world handler + didCommit 重置握手门，
// 共两处一行不动；加载/占位逻辑保持。bus 由本 VC 持有（生命周期与 webView 配置严格绑定）。
// onAction（M3）：layoutReport 等动作经 onBridgeAction 转交 CompositeRoot 消费；真状态源批4③。
import AppKit
import MuxvoBridge
import WebKit

/// 透明面板容器：webView 洞区穿透（hitTest 返 nil）后，本容器不认领事件（返 nil），
/// 让事件继续落到 CompositeRoot 里的 sibling 下层 host。仅当真实子视图（webView 非洞区 /
/// 占位 label）认领时才返回该子视图。
private final class PanelContainerView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        let result = super.hitTest(point)
        // super 返回自身 = 无子视图认领（webView 穿透了、placeholder 隐藏）→ 返 nil 让事件落下层 host。
        return result === self ? nil : result
    }
}

/// 本地安装（bundle）前端资源服务：把 muxvo-asset://app/<path> 映射到 bundle 内 web 目录。
/// 以真 web origin 供 index.html/assets（module MIME 正确 + 同源 CORS），规避 file:// 的
/// ES module 执行限制。只读、防目录穿越；WKWebView 在主线程回调，同步小文件读取即可。
@MainActor
private final class BundleWebSchemeHandler: NSObject, WKURLSchemeHandler {
    private let webDir: URL
    init(webDir: URL) { self.webDir = webDir.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL)); return
        }
        var rel = url.path
        if rel.isEmpty || rel == "/" { rel = "/index.html" }
        let fileURL = webDir.appendingPathComponent(rel).standardizedFileURL
        // 防目录穿越：解析后仍须在 webDir 子树内。
        guard fileURL.path == webDir.path || fileURL.path.hasPrefix(webDir.path + "/"),
              let data = try? Data(contentsOf: fileURL) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let headers = [
            "Content-Type": Self.mimeType(for: fileURL.pathExtension),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        guard let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse)); return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        // module script 必须是 JS MIME，否则浏览器拒绝执行
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        default: return "application/octet-stream"
        }
    }
}

@MainActor
final class PanelViewController: NSViewController, WKNavigationDelegate {
    private static let defaultURL = "http://localhost:5198"
    private static let loadTimeoutSeconds: Double = 20
    /// 本地安装（bundle）时前端资源经自定义 scheme 服务：WKWebView 拒绝从 file:// 执行
    /// ES module（origin=null + module MIME 严格校验），故用 WKURLSchemeHandler 以真 web
    /// origin 提供 index.html/assets（含动态 import 的 bridge/client chunk）。dev 路径不受影响。
    private static let appScheme = "muxvo-asset"
    private static let bundledIndexURL = URL(string: "muxvo-asset://app/index.html")!

    private let holeStore: HoleStore
    /// `private(set)`（保持 internal getter）纯为 e2e 评测关 harness 只读取证
    /// （MuxvoE2ETests @testable 对 webView evaluateJavaScript 查 DOM 态）。生产语义不变。
    private(set) var webView: PassthroughWebView!
    private var placeholder: NSTextField!
    private var timeoutTask: Task<Void, Never>?
    private var bridgeBus: BridgeBus!

    /// 桥入向动作出口（CompositeRoot 装配）：本 VC 把 bus.onAction 原样转交，
    /// layoutReport→洞几何、其余动作→真状态源（批4③）均在上层消费。
    var onBridgeAction: ((UIAction) -> Void)?
    /// term.command 落点（CompositeRoot 接 TerminalService.handleTermCommand）。未接 → 回 rejected.internal。
    var onTermCommand: ((TermCommandRequest) -> TermCommandResponse)?
    /// chat.request 落点（M5 批3，CompositeRoot 接 ChatAssembly；异步——查询在后台执行器）。未接 → rejected(UNAVAILABLE)。
    var onChatRequest: ((ChatRequest) async -> ChatResponse)?
    /// config.request 落点（M6 批1，CompositeRoot 接 ConfigRequestHandler）。未接 → rejected(UNAVAILABLE)。
    var onConfigRequest: ((ConfigRequest) -> ConfigResponse)?
    /// app.request 落点（M6 批1，CompositeRoot 接 AppRequestHandler；异步——目录选择器）。未接 → rejected(UNAVAILABLE)。
    var onAppRequest: ((AppRequest) async -> AppResponse)?
    /// fs.request 落点（M6 批A FsRequestRouter 文件树/worktree/菜单，AppDelegate 装配层接线）。
    /// 未接 → rejected(UNAVAILABLE)。
    var onFsRequest: ((FsRequest) async -> FsResponse)?
    /// 握手完成回调（冷启动 + re-hello）：CompositeRoot 接投影层 forceSnapshot（§3）。
    var onHandshake: (() -> Void)?
    /// app.telemetry 落点（v35 埋点批2，CompositeRoot 接 AnalyticsTracker）。未接 → 事件丢弃（fire-and-forget）。
    var onTelemetry: ((TelemetryEvent) -> Void)?

    init(holeStore: HoleStore) {
        self.holeStore = holeStore
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) 不支持") }

    /// 面板加载源解析序（dogfood 本地安装）：
    /// 1. MUXVO_WEB_URL env —— dev 显式覆盖（不变）
    /// 2. app 包内 Resources/web/index.html 存在 —— 自定义 scheme 加载（双击即开，无需 dev server）
    /// 3. 兜底 localhost:5198 —— swift run dev 无 env 时的现状
    private enum PanelSource {
        case remote(URL)
        case bundled(webDir: URL)
    }

    private static func resolvePanelSource() -> PanelSource {
        if let raw = ProcessInfo.processInfo.environment["MUXVO_WEB_URL"],
           let url = URL(string: raw) {
            return .remote(url)
        }
        // e2e 评测关 / dev：显式指定 bundled web 目录（如 web/dist），走 muxvo-asset:// scheme
        // 加载真实静态构建，无需 .app bundle。仅 env 门控；生产不设此变量、解析序不变。
        if let dir = ProcessInfo.processInfo.environment["MUXVO_WEB_BUNDLE_DIR"] {
            let webDir = URL(fileURLWithPath: dir, isDirectory: true)
            if FileManager.default.fileExists(
                atPath: webDir.appendingPathComponent("index.html").path) {
                return .bundled(webDir: webDir)
            }
        }
        if let resourceDir = Bundle.main.resourceURL {
            let webDir = resourceDir.appendingPathComponent("web", isDirectory: true)
            if FileManager.default.fileExists(
                atPath: webDir.appendingPathComponent("index.html").path) {
                return .bundled(webDir: webDir)
            }
        }
        return .remote(URL(string: defaultURL)!)
    }

    private let panelSource = PanelViewController.resolvePanelSource()

    override func loadView() {
        let container = PanelContainerView()

        let configuration = WKWebViewConfiguration()
        // bundled 源：注册自定义 scheme handler（须在建 webView 前挂到 configuration）。
        if case let .bundled(webDir) = panelSource {
            configuration.setURLSchemeHandler(
                BundleWebSchemeHandler(webDir: webDir), forURLScheme: Self.appScheme)
        }
        let appVersion =
            (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
            ?? "0.1.0"
        let bus = BridgeBus(appVersion: appVersion)
        configuration.userContentController.addScriptMessageHandler(
            BridgeScriptMessageHandler(bus: bus), contentWorld: .page, name: "muxvo"
        )
        let webView = PassthroughWebView(frame: .zero, configuration: configuration, holeStore: holeStore)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        bus.pushSink = WebViewPushSink(webView: webView).send
        // 桥入向动作转交上层（layoutReport 消费 / 真状态源批4③）。
        bus.onAction = { [weak self] action in self?.onBridgeAction?(action) }
        // term.command → 真状态源（同步 handler；未接 → rejected.internal，非信封错误）。
        bus.onTermCommand = { [weak self] req in
            self?.onTermCommand?(req) ?? .rejected(code: .internal, message: "TerminalService 未接线")
        }
        // orch.command / orch.query → 编排服务（异步；未接 → rejected(UNAVAILABLE) 类型化 payload）。
        // chat.request → ChatAssembly（异步——查询在后台执行器；未接 → rejected(UNAVAILABLE) 类型化 payload）。
        bus.onChatRequest = { [weak self] req in
            guard let handler = self?.onChatRequest else {
                return .rejected(code: "UNAVAILABLE", message: "Chat 服务未接线")
            }
            return await handler(req)
        }
        // config.request → ConfigRequestHandler（同步；未接 → rejected(UNAVAILABLE) 类型化 payload）。
        bus.onConfigRequest = { [weak self] req in
            self?.onConfigRequest?(req) ?? .rejected(code: "UNAVAILABLE", message: "配置服务未接线")
        }
        // app.request → AppRequestHandler（异步——目录选择器；未接 → rejected(UNAVAILABLE)）。
        bus.onAppRequest = { [weak self] req in
            guard let handler = self?.onAppRequest else {
                return .rejected(code: "UNAVAILABLE", message: "app 服务未接线")
            }
            return await handler(req)
        }
        // fs.request → FsRequestRouter（文件树/worktree/菜单，装配层接线；
        // 未接 → rejected(UNAVAILABLE) 类型化 payload）。
        bus.onFsRequest = { [weak self] req in
            guard let handler = self?.onFsRequest else {
                return .rejected(code: "UNAVAILABLE", message: "fs 服务未接线")
            }
            return await handler(req)
        }
        // 握手完成 → 上层（投影层 forceSnapshot，§3）。
        bus.onHandshake = { [weak self] in self?.onHandshake?() }
        bus.onTelemetry = { [weak self] event in self?.onTelemetry?(event) }
        bridgeBus = bus

        let placeholder = NSTextField(wrappingLabelWithString: placeholderText)
        placeholder.textColor = .secondaryLabelColor
        placeholder.font = .systemFont(ofSize: 13)
        placeholder.alignment = .center
        placeholder.isHidden = true
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(placeholder)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            placeholder.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            placeholder.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            placeholder.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
        ])

        self.webView = webView
        self.placeholder = placeholder
        view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        switch panelSource {
        case let .remote(url):
            webView.load(URLRequest(url: url))
        case .bundled:
            webView.load(URLRequest(url: Self.bundledIndexURL))
        }
        timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Self.loadTimeoutSeconds))
            guard !Task.isCancelled else { return }
            self?.showPlaceholder()
        }
    }

    /// native→web 推送 ui.state（握手前入队、hello 后 flush，由 BridgeBus 负责）。
    /// 真状态源批4③ 接 TerminalService；本批仅供冒烟 demo（env 门控）驱动洞分支。
    func pushState(_ state: UIState) {
        bridgeBus.pushUIState(state)
    }


    /// native→web 推送 data.event（M6 批1，资源变化通知；ResourceWatcher 经 CompositeRoot 转交）。
    func pushDataEvent(_ event: DataEvent) {
        bridgeBus.pushDataEvent(event)
    }

    /// 本窗桥 bus 只读取证缝（multi-window.md §7.3 fan-out 单测；bridgeBus 建于 loadView，未加载 → nil）。
    /// 供 CompositeRootViewController.busForTest 转发——断言 broadcast 逐窗各入队一份（握手前入 queue，可读）。
    var busForTest: BridgeBus? { bridgeBus }

    private var placeholderText: String {
        switch panelSource {
        case let .remote(url):
            return """
            面板页面加载失败/超时。

            请先启动 web dev server：
            cd web && npm run dev   （端口 5198）

            当前地址：\(url.absoluteString)
            可用环境变量 MUXVO_WEB_URL 覆盖。
            """
        case let .bundled(webDir):
            return """
            面板页面加载失败/超时。

            app 包内前端资源加载异常：
            \(webDir.path)

            请重新安装（scripts/app.sh install）。
            """
        }
    }

    private func showPlaceholder() {
        placeholder.isHidden = false
        webView.isHidden = true
    }

    private func clearPlaceholder() {
        timeoutTask?.cancel()
        timeoutTask = nil
        placeholder.isHidden = true
        webView.isHidden = false
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // 整页刷新（含 Vite 整页 reload）重置握手门（bridge-v1.md §3）
        bridgeBus.resetHandshake()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        clearPlaceholder()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("[muxvo] panel load failed: \(error.localizedDescription)")
        showPlaceholder()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        NSLog("[muxvo] panel provisional load failed: \(error.localizedDescription)")
        showPlaceholder()
    }
}
