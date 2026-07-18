// 波3b OrchNotifier 崩溃安全翻牌（R2 硬约束「非 .app 进程绝不能崩」）：
//   · hasBundle=false（模拟 swift run / swift test / e2e-harness 等非 .app 进程）：四类通知走 Dock 关注、
//     守卫跳过 UNUserNotificationCenter.current()（无 bundle proxy 会崩）→ 全程不崩、静默降级。
//   · 这是 R2 守卫的**唯一防线**测试（e2e 关可能装配真设施验呈现，守卫必须在实现体内、不靠测试双件）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import Foundation
import Testing
@testable import MuxvoAppCore

@Suite("OrchNotifier 崩溃安全（R2 Bundle 守卫）", .serialized)
@MainActor
struct OrchNotifierTests {

    @Test("非 bundle 进程（hasBundle=false）：四类通知 + 呼出走 Dock 关注 + 守卫跳系统横幅 → 不崩")
    func nonBundleGuardDoesNotCrash() async {
        let notifier = OrchNotifier(hasBundle: false)
        await notifier.hitLimit(taskId: "t1", accountId: "acct-A", resetsAtMs: 2_000_000)
        await notifier.zeroProgress(taskId: "t2")
        await notifier.approvalStale(taskId: "t3")
        await notifier.recovered(interruptedCount: 2, needsConfirmTaskIds: ["t4", "t5"])
        await notifier.recovered(interruptedCount: 0, needsConfirmTaskIds: []) // 零回队不打扰分支
        await notifier.summon(taskId: "t6", reason: "有任务需要你处置") // §4 呼出：criticalRequest + 守卫跳横幅
        #expect(Bool(true)) // 抵达此处 = 守卫兜底、四类 + 零回队 + 呼出分支均未崩
    }

    @Test("呼出 taskId 契约常量稳定（组合根 delegate 据此从点击响应取 taskId 跳详情，§4）")
    func summonTaskIdKeyIsStableContract() {
        #expect(OrchNotifier.summonTaskIdKey == "muxvoSummonTaskId")
    }

    @Test("默认构造可用（按进程真 .app 谓词定守卫，RealAppBundleGuard）")
    func defaultInitConstructs() {
        _ = OrchNotifier() // 构造不崩（守卫值随进程；swift test 非 .app → hasBundle=false 走降级）
        #expect(Bool(true))
    }
}
