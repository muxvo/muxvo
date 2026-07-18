import AppKit
import MuxvoKit

/// 红叉关窗拦截器（DOGFOOD_M3_21）：windowShouldClose **拒关并转发退出请求**——与 ⌘Q 汇入同一
/// applicationShouldTerminate 漏斗，窗口在场时弹确认卡。legacy mainWindow.on('close') preventDefault
/// 对等（index.ts:202-218）。_19 曾依赖 last-window-closed 汇入，但红叉路径窗口**先关**、确认卡无处
/// 渲染，app 卡 .terminateLater 成僵尸（持 instance.lock 再启不能——用户真机实锤）。
/// NSWindow.delegate 是 weak——由 MainWindowController 强持有本拦截器保活。
@MainActor
final class WindowCloseInterceptor: NSObject, NSWindowDelegate {
    private let onCloseRequested: () -> Void
    /// 窗几何变化回调（multi-window.md §4.4）：WindowManager 去抖写回本窗 `WindowEntry.frame`。nil = 不管
    /// frame（单窗 autosave 旧路径 / 脱窗测试）。
    private let onFrameChanged: ((NSWindow) -> Void)?
    init(onCloseRequested: @escaping () -> Void, onFrameChanged: ((NSWindow) -> Void)? = nil) {
        self.onCloseRequested = onCloseRequested
        self.onFrameChanged = onFrameChanged
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        onCloseRequested()
        return false
    }
    // §4.4：move/resize 结束 → 去抖写回 entry.frame（WindowManager 自管，弃 setFrameAutosaveName）。
    func windowDidMove(_ notification: Notification) { notifyFrame(notification) }
    func windowDidEndLiveResize(_ notification: Notification) { notifyFrame(notification) }
    private func notifyFrame(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        onFrameChanged?(window)
    }
}

@MainActor
public final class MainWindowController: NSWindowController {
    /// C 案复合窗口（M3 批3①）：删 NSSplitViewController（autosave MuxvoMainSplit 随之废弃）。
    /// 下层原生渲染面 + 上层透明 web chrome 由 CompositeRootViewController 装配。
    public let compositeRoot: CompositeRootViewController
    /// 红叉拦截器（DOGFOOD_M3_21）：delegate 弱引用，须强持有。nil = 未装（旧行为，红叉直接关窗）。
    private var closeInterceptor: WindowCloseInterceptor?

    /// - Parameters:
    ///   - title: 窗口标题（multi-window.md §6.3 编号：首窗 "Muxvo"、后续 "Muxvo — 2"…；默认首窗名）。
    ///   - frameAutosaveName: NSWindow frame 跨启动 autosave 键。**schema v2（C4）起全窗传 nil**——多窗下
    ///     按名 autosave 会串窗/竞态，frame 改由 WindowManager 去抖写回 `WindowEntry.frame` 自管（§4.4）；
    ///     首窗真几何由装配层一次性迁移旧 autosave 键补（§4.4）。仅 harness/旧单测默认参兜底。
    ///   - onFrameChanged: 窗 move/resize 结束回调（§4.4，WindowManager 去抖写回 entry.frame）。
    public convenience init(
        surfaceProvider: any TerminalSurfaceProviding, terminalService: TerminalService,
        onCloseRequested: (() -> Void)? = nil,
        title: String? = nil,
        frameAutosaveName: String? = "MuxvoMainWindow",
        onFrameChanged: ((NSWindow) -> Void)? = nil
    ) {
        // 1440×900 与视觉回归基准同尺寸
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title ?? AppInfo.displayName // nil = 首窗默认名（AppInfo internal，不入公开默认值）
        window.minSize = NSSize(width: 1024, height: 640)
        let root = CompositeRootViewController(
            surfaceProvider: surfaceProvider, terminalService: terminalService)
        self.init(window: window, compositeRoot: root)
        window.contentViewController = root
        // ⚠️ H-window（DOGFOOD_M3_13 根因）：contentViewController 赋值让 AppKit 按 root 视图
        // 当刻尺寸重设窗口——CompositeRoot.loadView 是零 frame NSView() → 窗口坍缩被 minSize
        // 钳到 1024×612 内容区，web 首帧在错误视口测量、窄洞 rect 烧 PTY（用户 stty 28×31 实锤）。
        // 赋值后必须重设内容尺寸再居中；勿在赋值前 center()（坍缩会使居中失效）。
        window.setContentSize(NSSize(width: 1440, height: 900))
        window.center()
        // 窗口 frame 跨启动恢复（NSUserDefaults autosave）：用户调过的窗口尺寸/位置下次冷启动
        // 保留，消除「每次启动都要手动拉大」的窄窗口期。setFrameAutosaveName 若有存档会立即
        // 应用（覆盖上面的默认 1440×900——首启无存档则保持默认）。e2e harness 显式 setFrame
        // 不受影响（E2EScenario.swift:77-78）。多窗新窗传 nil → 不设 autosave（§4.4，WindowManager 级联自管）。
        if let frameAutosaveName {
            window.setFrameAutosaveName(frameAutosaveName)
        }
        // 红叉拦截（DOGFOOD_M3_21）：装了回调才拦（生产 = NSApp.terminate 同 ⌘Q 漏斗）；nil = 旧行为
        // （harness/测试装配兼容——它们经 registerQuit/coordinator 直驱，不走红叉）。同一 delegate 兼带
        // §4.4 窗几何变化回调（onFrameChanged；WindowManager 去抖写回 entry.frame）。
        if onCloseRequested != nil || onFrameChanged != nil {
            let interceptor = WindowCloseInterceptor(
                onCloseRequested: onCloseRequested ?? {}, onFrameChanged: onFrameChanged)
            closeInterceptor = interceptor
            window.delegate = interceptor
        }
    }

    private init(window: NSWindow, compositeRoot: CompositeRootViewController) {
        self.compositeRoot = compositeRoot
        super.init(window: window)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) 不支持") }
}
