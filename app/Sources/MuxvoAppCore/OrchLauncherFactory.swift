// 公开仓 overlay stub（编排物理剥离，开源前置重构第 2 步）。
// 导出（export-public.sh）时经 rsync 覆盖私仓 app/Sources/MuxvoAppCore/OrchLauncherFactory.swift（同路径）——
// 编排缝工厂恒返 nil → AppDelegate.orchLauncher==nil，编排全部委托 no-op，核心 app 无编排、行为等价
// 「编排装配失败降级」（终端/聊天/文件/设置照常）。本 stub 零编排 import（不依赖 OrchLauncherImpl）。
enum OrchLauncherFactory {
    @MainActor
    static func make(context _: OrchLauncherContext) -> (any OrchLauncher)? { nil }
}
