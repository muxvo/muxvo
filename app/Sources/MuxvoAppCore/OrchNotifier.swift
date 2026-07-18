// 生产通知设施（R2 裁决的生产实现体）：MuxvoScheduler.OrchNotifying 的具体落地。
//
// 三层（R2）：
//   · **常在基线**（零授权/entitlement，总能工作）：Dock 图标关注请求（requestUserAttention）+ 面板高亮。
//     面板高亮由 web（orch.state 快照的 waiting 分组 / RecoveryBanner / policyBanner）承载（2a/2c），非本类。
//     **不写 Dock badge**——Dock 徽标归 DockBadgeController→DockTileRenderer（终端等待计数，自绘
//     contentView 通道），两写者不争（聚合 badge 属未来增强；v1 用 requestUserAttention 作 orch 侧
//     的 Dock 关注信号，避免 clobber）。
//   · **尽力而为叠加层**：UNUserNotificationCenter 系统横幅（「人不在电脑前也能知道」，§5）——由
//     `RealAppBundleGuard`「真 .app」守卫（swift run / swift test / e2e-harness 等非 .app 进程 →
//     跳过，UNUserNotificationCenter.current() 在无 bundle proxy 进程会崩，**这是硬约束防线**，R2；
//     谓词不可用 bundleIdentifier != nil——-sectcreate 嵌 plist 令 swift run 下也非 nil，见守卫头注）；
//     requestAuthorization 懒触发一次；授权拒绝 / add 失败一律**静默降级**（回落到 Dock/面板）。
//
// 结构护栏（沿 ProgressAlerting/☆B4）：**只提示，绝不迁移状态、不杀 worker、永不 auto-deny**。
import AppKit
import Foundation
import UserNotifications
// 注：`OrchNotifying`（MuxvoScheduler 契约）的 conformance 剥到私仓专属文件
// OrchNotifier+OrchNotifying.swift（开源前置重构：公开仓 OrchNotifier 不依赖编排 target，
// 用量预警仍工作）。本类的七个方法即该协议见证，extension 空体即可满足。

/// 呼出成因固定文案（interactive-worker.md §4；核心原则二：reason 是 **app 控枚举文案、非 worker 注入面**）。
/// 三处升级点（审批 / silence / TUI 弹窗）各取一值，绝不拼接 worker 提供的工具名/内容（避免不可信面入横幅）。
public enum SummonReason {
    /// 审批升级：CC 弹原生对话框、人须到该 worker 实时终端裁决。
    public static let approval = "有操作等待你在实时终端审批"
    /// silence 疑似等待：前台非 shell + PTY 长时间无输出（可能卡在 hook 管不到的界面）。
    public static let silence = "任务疑似卡住（长时间无输出），可能在等你处理"
    /// TUI 弹窗检出：Notification hook 帧（hook 管不到的 TUI 提示）→ 呼出人处置。
    public static let tuiPopup = "任务在终端弹出了需要你响应的提示"
}

/// 呼出点击路由解析（interactive-worker.md §4）：从通知 `userInfo` 提取 summon taskId（缺键/非串 → nil）。
/// 抽为纯函数供路由单测（AppDelegate 全装配难脱窗构造，didReceive 仅薄薄一层调此 + routeSummon）。
public enum SummonRouting {
    public static func summonTaskId(fromUserInfo userInfo: [AnyHashable: Any]) -> String? {
        userInfo[OrchNotifier.summonTaskIdKey] as? String
    }
}

/// 生产 `OrchNotifying` 设施（Dock 关注常在 + Bundle 守卫的系统横幅尽力而为）。@MainActor：Dock/
/// UNUserNotificationCenter 均主线程语义。四类通知（撞 limit / 零进展 / 审批滞留 / 崩溃恢复）统一收口。
@MainActor
public final class OrchNotifier {
    /// 呼出通知 userInfo 携带 taskId 的键（interactive-worker.md §4「呼出」）：组合根（AppDelegate）装
    /// UNUserNotificationCenterDelegate 时据此从点击响应取 taskId → 开任务中心 + 选中该任务（详情
    /// liveHole 渲染即触发 layoutReport→native 自动 attach，无需显式 attach 动作）。契约常量，跨模块稳定。
    /// nonisolated：纯编译期字符串常量，供 nonisolated 的 SummonRouting/delegate 路由引用（不随 @MainActor 隔离）。
    public nonisolated static let summonTaskIdKey = "muxvoSummonTaskId"

    /// bundle 守卫值：仅真 .app（RealAppBundleGuard）才碰 UNUserNotificationCenter。构造期定格。
    /// internal（非 private）：供装配锚测试断言「生产构造守卫值 = 共用谓词」（装配断点防线）。
    let hasBundle: Bool
    /// 授权懒触发闸（只请求一次；拒绝后不反复弹）。
    private var authorizationRequested = false

    /// 生产构造：按当前进程是否真 .app 定守卫（.app=放行系统横幅；swift run/裸可执行=跳过、只 Dock）。
    public convenience init() {
        self.init(hasBundle: RealAppBundleGuard.isCurrentProcessRealApp)
    }

    /// 测试构造（守卫值直注）：验「非 .app 进程 hasBundle=false → 跳系统横幅、只 Dock、不崩」R2 硬约束。
    init(hasBundle: Bool) {
        self.hasBundle = hasBundle
    }

    // MARK: - OrchNotifying（四类入口 → present）

    public func hitLimit(taskId: String, accountId: String, resetsAtMs: Int64) async {
        present(
            title: "额度用尽",
            body: "账号 \(accountId) 额度用尽，任务等待中，稍后自动刷新续跑。",
            identifier: "orch.limit.\(accountId)") // 按账号聚合系统横幅（同账号多任务合并一条，§2.8 分组语义）
    }

    public func zeroProgress(taskId: String) async {
        present(
            title: "任务疑似卡住",
            body: "任务长时间无进展，请查看是否需要介入。",
            identifier: "orch.zeroProgress.\(taskId)")
    }

    public func approvalStale(taskId: String) async {
        present(
            title: "审批等待中",
            body: "有任务长时间等待你的审批，请到任务中心处理。",
            identifier: "orch.approvalStale.\(taskId)")
    }

    public func takeoverStale(taskId: String) async {
        // MAJ-4（SP_stale_takeover_escalates）：接管态长期未归还 → 提醒人回来处置。只提醒、绝不自动归还。
        present(
            title: "接管中的任务待处理",
            body: "有任务已由你接管但长时间未归还，占用并发名额。请到任务中心归还或继续处理。",
            identifier: "orch.takeoverStale.\(taskId)")
    }

    public func pipelineOverBudget(pipelineId: String) async {
        // M4c §6 T7（PS_pipeline_deadline_freezes_gates）：pipeline 越软预算 → 提醒。只通知，不杀 worker、
        // 不改状态机（软预算=不杀不砍质量，R5-1）。推进已在门控冻结（下一 stage 驻 created 待人裁续推）。
        present(
            title: "流水线超时",
            body: "有流水线已超过设定的软时间预算，后续阶段已暂停自动推进。请到任务中心确认是否继续。",
            identifier: "orch.pipelineOverBudget.\(pipelineId)")
    }

    public func recovered(interruptedCount: Int, needsConfirmTaskIds: [String]) async {
        guard interruptedCount > 0 else { return } // 无回队任务不打扰（权威呈现是 web RecoveryBanner）
        let needConfirm = needsConfirmTaskIds.count
        let tail = needConfirm > 0 ? "，其中 \(needConfirm) 个需人工确认" : ""
        present(
            title: "崩溃恢复",
            body: "已回队 \(interruptedCount) 个任务\(tail)。",
            identifier: "orch.recovered")
    }

    /// 交互式 worker 呼出（§4）：强关注（criticalRequest，比常规四类的 informational 更醒目）+ 携 taskId
    /// 的系统横幅（点击经组合根 delegate 跳详情，userInfo[summonTaskIdKey]）。只提示、绝不迁移状态、
    /// 绝不盲按键。identifier 按 taskId 聚合（同任务多次呼出合并一条，不刷屏）。
    public func summon(taskId: String, reason: String) async {
        NSApplication.shared.requestUserAttention(.criticalRequest)
        guard hasBundle else { return } // 非真 .app（swift run/裸可执行）守卫（同 present，R2 硬约束防线）
        postSystemBanner(
            title: "需要你处置", body: reason,
            identifier: "orch.summon.\(taskId)",
            userInfo: [Self.summonTaskIdKey: taskId])
    }

    /// 用量预警（usage-limit-alert.md §5，第五类）：limit ≥90% 提前提醒换号（2026-07-12 拍板 95→90）。非 OrchNotifying 缝
    /// （非 orch 任务域，UsageAlertAssembly 的 notify 闭包直调，故非 async）。identifier 含
    /// window/resetsAt/level → 同窗口同重置期同级聚合一条（§4 边沿去重之外的呈现级兜底）。
    public func limitApproaching(alert: UsageAlert, accountEmail: String?) {
        present(
            title: UsageAlertText.title(alert),
            body: UsageAlertText.body(alert, accountEmail: accountEmail),
            identifier: "usage.approach.\(alert.window.rawValue).\(alert.resetsAt).\(alert.level)")
    }

    // MARK: - 呈现（常在基线 + 尽力而为叠加，全 best-effort、失败静默）

    private func present(title: String, body: String, identifier: String) {
        // 常在基线：Dock 图标关注一次（零授权、不写 badge，不与 TerminalService 的终端 badge 争）。
        NSApplication.shared.requestUserAttention(.informationalRequest)
        // 尽力而为：系统横幅——真 .app 守卫（swift run/裸可执行不碰 UNUserNotificationCenter，R2 硬约束防线）。
        guard hasBundle else { return }
        postSystemBanner(title: title, body: body, identifier: identifier)
    }

    private func postSystemBanner(
        title: String, body: String, identifier: String, userInfo: [String: String] = [:]
    ) {
        let center = UNUserNotificationCenter.current()
        // ⚠️ UN 完成回调在系统私有队列执行——闭包必须显式 @Sendable 阻断 MainActor 隔离继承，
        // 否则运行时隔离断言 SIGTRAP（07-07 Muxvo3 启动秒崩单：closure #1 in postSystemBanner）。
        if !authorizationRequested {
            authorizationRequested = true
            center.requestAuthorization(options: [.alert, .sound]) { @Sendable _, _ in } // 结果不阻塞、拒绝即静默降级
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if !userInfo.isEmpty { content.userInfo = userInfo } // 呼出携 taskId 供点击路由（§4）
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        center.add(request) { @Sendable _ in } // add 失败静默（无授权/无 entitlement → 回落 Dock/面板）
    }
}
