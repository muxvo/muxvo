// 老版用户豁免新手引导（welcome-overlay.md §5 WEL_legacy_user_exempt，用户拍板 2026-07-16）：
// 纯函数三真判定 + 踪迹路径 env 缝直测。只碰 $TMPDIR。
import Foundation
import Testing
@testable import MuxvoAppCore

@Suite("老版用户引导豁免（welcome-overlay.md §5）")
struct LegacyTourExemptTests {

    @Test("WEL_legacy_user_exempt: fresh+踪迹+未完成 三真 → 豁免；任一不满足 → 不动")
    func exemptRequiresAllThree() {
        // 三真 → 豁免（老版升级用户首启）
        #expect(AppDelegate.shouldExemptTourForLegacyUser(
            freshInstall: true, legacyTraceExists: true, tourCompleted: false) == true)
        // 非 fresh（既有用户日常重启）→ 不动，即便踪迹在场
        #expect(AppDelegate.shouldExemptTourForLegacyUser(
            freshInstall: false, legacyTraceExists: true, tourCompleted: false) == false)
        // 无踪迹（真·全新用户）→ 不动，正常弹欢迎卡
        #expect(AppDelegate.shouldExemptTourForLegacyUser(
            freshInstall: true, legacyTraceExists: false, tourCompleted: false) == false)
        // 已完成 → 不动（幂等，不重复写盘）
        #expect(AppDelegate.shouldExemptTourForLegacyUser(
            freshInstall: true, legacyTraceExists: true, tourCompleted: true) == false)
    }

    @Test("踪迹路径：默认 ~/.muxvo；env MUXVO_LEGACY_TRACE_PATH 覆盖（测试/反向验证缝）")
    func tracePathEnvSeam() {
        #expect(AppDelegate.legacyTracePath(env: [:])
            == (NSHomeDirectory() as NSString).appendingPathComponent(".muxvo"))
        #expect(AppDelegate.legacyTracePath(env: ["MUXVO_LEGACY_TRACE_PATH": "/tmp/fake-muxvo"])
            == "/tmp/fake-muxvo")
    }
}
