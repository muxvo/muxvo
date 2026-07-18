// 编排装配单缝（开源前置重构第 2 步，2026-07-18）。
//
// AppDelegate 里散落的编排接线（TaskService/bus 创建 + 崩溃和解 + OrchAssembly 生产装配 + 指挥台 +
// 审批/接管/pipeline 滞留监视器 + hook 完整性核对 + 恢复横幅 + 呼出选中 + 新窗编排接线 + 退出收尾）
// 全收进 OrchLauncher 单缝——AppDelegate 只持一个 `orchLauncher: (any OrchLauncher)?`，在既有装配点
// 委托调用。编排接缝与运行时门控（OrchGate）正交：本缝是让编排能被**物理剔除**（公开仓）。
//
// 实现分文件：
//   · OrchLauncherImpl.swift    —— 私仓专属真实现（import 编排 target；进 exclude.txt）
//   · OrchLauncherFactory.swift —— 工厂（私仓真造 / 公开仓 overlay stub 返 nil），overlay 同路径覆盖
// 公开仓（编排目录被剔除）：OrchLauncherFactory.make 返 nil → AppDelegate.orchLauncher==nil → 全部
// 委托为 no-op，核心 app 无编排、行为等价「编排装配失败降级」（终端/聊天/文件/设置照常）。
//
// 全部 internal（仅 MuxvoAppCore 内 AppDelegate 使用；e2e-harness 自装配编排不经本缝）——避免公共可见性
// 牵连 WindowManager/AnalyticsAssembly 等类型的 public 化。
import Foundation
import MuxvoDatabase

/// 编排装配缝：AppDelegate 在固定生命周期点委托本协议；实现体（私仓）持全部编排子系统。
/// 缝内方法一律不出现编排 target 类型（参数为共享类型/String）——公开仓 AppDelegate 编译不需要编排 target。
@MainActor
protocol OrchLauncher: AnyObject {
    /// DB 打开后（didFinishLaunching）：创建 TaskService/TaskEventBus；crashRecovery 时跑一次和解 + 计数回填恢复横幅。
    func attachDatabase(_ db: MuxvoDatabase, dataRoot: URL, crashRecovery: Bool)
    /// 首窗 composite 就绪后：编排全链生产装配 + 接线（OrchGate 关或装配失败 → 降级不启，终端照常）。
    func assemble(composite: CompositeRootViewController, dataRoot: URL)
    /// ⌥⌘N 新窗：把该窗 composite 接到共享 orchAssembly（stateSink/transcriptSink 已 fan-out 全窗）。
    func wireNewWindow(composite: CompositeRootViewController, service: TerminalService)
    /// 菜单「新建指挥台」：开台编排（装配就绪后惰性可用；未就位 no-op）。
    func openConsole()
    /// 呼出点击落点的编排部分：请求 web 单发选中该任务（切屏由 AppDelegate.routeSummon 走既有 setPanelMode 路径）。
    func requestSelect(taskId: String)
    /// applicationWillTerminate：停监视器定时器 + 停编排（best-effort，不阻塞退出）。
    func shutdown()
}

/// 编排缝所需的宿主（AppDelegate）共享子系统访问器（闭包式：AppDelegate 属性保持 private）。
@MainActor
struct OrchLauncherContext {
    /// 当前窗管理器（broadcast orch state/transcript + activeContext 解析 + terminalService 取用）。
    let windowManager: () -> WindowManager?
    /// 埋点装配（终态/命令/console 嗅探，透传不改行为）。
    let analytics: () -> AnalyticsAssembly?
    /// 生产通知设施（撞 limit/零进展/滞留升级/呼出/恢复；用量预警亦用同实例，AppDelegate 强持有）。
    let orchNotifier: () -> OrchNotifier?
    /// 指挥台已开时聚焦其所在窗 + selectTile（窗焦点逻辑用共享 windowManager，故落 AppDelegate）。
    let focusConsole: (_ windowId: String?, _ terminalId: String) -> Void
    /// 装 UNUserNotificationCenter delegate = AppDelegate（真 .app 守卫内）——呼出横幅点击路由到 routeSummon。
    let installSummonDelegate: () -> Void
}
