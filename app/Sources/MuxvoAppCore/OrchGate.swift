// OrchGate：编排功能启用门（上线批 2026-07-16）——编排未做好，本次发布不上线，**默认关死**。
//
// 仿 AnalyticsGate（MuxvoAnalytics/AnalyticsTransport.swift）纯函数形态，但方向相反：Analytics
// 默认由 release plist 键注入开启，本门无 plist 键——任何构建默认关，仅 env `MUXVO_ORCH=1`
// 打开（dev 继续开发编排 / 真机回归口）。
//
// 关死后的两处消费点：
//   1. AppDelegate.assembleOrchestrationIfPossible 体首短路——装配整链（CP server/scheduler/
//      ConsoleTerminalManager/审批滞留与 hook 完整性监视器/UN delegate）全不启动；web 若发 orch
//      消息落 PanelViewController 既有 UNAVAILABLE 兜底（与「装配失败降级」同一条已验证路径）。
//   2. AppDelegate.buildMenu 传 showOrchMenus——「新建指挥台 ⌘⇧N」「任务中心 ⌘⇧T」两菜单项
//      不建，键位随菜单项一并失效。
//
// 不受影响：用量预警（OrchNotifier 建于 didFinishLaunching，独立于编排装配）；e2e-harness
// （自装配 + 自建菜单，不经 AppDelegate，评测关照常覆盖编排 items）；web 侧零改动（taskCenter
// 仅在收到 native panelMode 推送时渲染，native 入口关死即全关）。
import Foundation

public enum OrchGate {
    /// env `MUXVO_ORCH=1` 开；其余（含未设）一律关。纯函数便于单测。
    public static func isEnabled(env: [String: String]) -> Bool {
        env["MUXVO_ORCH"] == "1"
    }

    /// 生产便捷口（AppDelegate 装配/buildMenu 用）。
    public static var isEnabled: Bool {
        isEnabled(env: ProcessInfo.processInfo.environment)
    }
}
