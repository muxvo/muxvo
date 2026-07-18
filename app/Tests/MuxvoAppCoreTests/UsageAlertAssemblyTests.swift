// UsageAlertAssembly 装配级红绿锚（usage-limit-alert.md §6 / §8 UL_assembly_file_to_notify）。
//
// M4b 教训：两次 MAJOR 均「装配断点」——单测注入 fake 掩盖组合根未接线。本测走**真装配缝 + 真文件
// 真 parse 真判定**（仅 timer 用手动 tick 替身、notify 用 spy）：先断言无文件不触发（红），写真
// 96% 文件 + tick → spy 收到（绿）。AppDelegate 逐字调同一 make，故此锚覆盖组合根断点面。
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("UsageAlertAssembly 装配红绿锚（usage-limit-alert.md §6）")
struct UsageAlertAssemblyTests {
    @MainActor
    final class TickTimer: DockBadgeTimer {
        var fire: (@MainActor () -> Void)?
        func invalidate() { fire = nil }
    }

    @Test("UL_assembly_file_to_notify: 无文件 tick 不触发（红）→ 写真 96% 文件 + tick → spy 收到（绿）")
    func fileToNotify() throws {
        try withTempRoot { root in
            let nowMs: Int64 = 1_783_500_000_000
            var fired: [UsageAlert] = []
            let timer = TickTimer()
            let made = UsageAlertAssembly.make(
                settingsURL: root.appendingPathComponent("claude-home/settings.json"),
                dataRoot: root,
                now: { nowMs },
                makeTimer: { interval, fire in
                    #expect(interval == UsageLimitWatcher.Constants.pollSeconds)
                    timer.fire = fire
                    return timer
                },
                notify: { fired.append($0) })
            defer { made.watcher.stop() }

            // 红：make 已 start（含首查）+ 手动 tick，文件缺失 → 零触发。
            timer.fire?()
            #expect(fired.isEmpty)

            // 绿：写真传感器产出文件（与脚本 §2 同形状）→ tick → 判定链走通、spy 收到 90 档预警。
            let statusURL = StatusLineScript.usageStatusURL(dataRoot: root)
            try FileManager.default.createDirectory(
                at: statusURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let resets = nowMs / 1000 + 3600
            let payload = #"{"writtenAtMs":\#(nowMs),"fiveHour":{"usedPct":96.0,"resetsAt":\#(resets)}}"#
            try Data(payload.utf8).write(to: statusURL)
            timer.fire?()
            #expect(fired == [
                UsageAlert(window: .fiveHour, usedPct: 96.0, resetsAt: resets, level: 90)
            ])

            // 去重：同文件再 tick 不重复。
            timer.fire?()
            #expect(fired.count == 1)

            // installer 与 watcher 同缝产出（组合根一次拿全）。
            #expect(made.installer.selfCheck() == .notInstalled)
        }
    }
}
