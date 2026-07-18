// MuxvoKit：跨模块接缝。刻意保持极小——只放多个 target 都要引用的协议与 ID 类型。
import AppKit

// MARK: - 关停接缝（单退出路径纪律）

public enum ShutdownReason: Sendable {
    case userQuit
    case systemShutdown
}

/// AppDelegate.applicationShouldTerminate 的唯一对接面。
/// 真实现 = MuxvoStorage.LifecycleShutdownCoordinator
/// （按序跑 ShutdownStep → 最后写 graceful-exit 标志）。
/// 纪律：app 内除 applicationShouldTerminate 外不得有任何 exit()/NSApp.terminate 旁路。
public protocol ShutdownCoordinating: AnyObject, Sendable {
    func beginShutdown(reason: ShutdownReason, completion: @escaping @Sendable () -> Void)
}

// MARK: - 会话/视图分离接缝（M3 提升 ProbeCore 时的对接面）

public struct SessionID: Hashable, Codable, Sendable {
    public let raw: String
    public init(raw: String) { self.raw = raw }
}

/// 终端渲染面提供者。视图是无状态投影：attach 时从会话读 render state，绝不反向持有。
/// （M0 报告设计输入①：render state 归会话所有、多视图共读。）
@MainActor
public protocol TerminalSurfaceProviding: AnyObject {
    /// drivesSessionResize：视图是否驱动共享 PTY 网格（grid 主视图 true / sidebarPreview 恒 false）。
    /// 必须由调用方在建视图时经参数定死（m3-layout-r5 F2）：flag 先于 attach 生效——此前 host 在
    /// makeSurfaceView 返回后补置位，attach 瞬间视图以默认 true + 零 bounds 把 2x2 候选灌进
    /// settler，trailing 到期真调 session.resize 靠 <10×2 防御侥幸拦下（2026-07-07 现场实录）。
    func makeSurfaceView(attachedTo session: SessionID, drivesSessionResize: Bool) -> NSView
    /// 字号缩放广播（DOGFOOD_M3_05）：更新新建视图默认字号 + 对所有存活 surface 应用新字号。
    func applyFontSize(_ size: Int)
}
