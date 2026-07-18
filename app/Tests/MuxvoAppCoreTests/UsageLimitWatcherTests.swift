// UsageLimitWatcher 边沿状态机直测（usage-limit-alert.md §4 / §8 UL_edge_* / UL_watch_missing_file_noop）。
//
// decide/parse 纯函数 + 假时钟：验 90/99 跨阈值一次性 fire（2026-07-12 用户拍板 95→90）、(window,resetsAt,level) 去重、滞回
// 再武装、resetsAt 变化再武装、陈旧/过期双守卫。watch 路径用临时文件 + 假 timer（手动 checkNow）。
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("UsageLimitWatcher 边沿检测（usage-limit-alert.md §4）")
struct UsageLimitWatcherTests {
    /// 假时钟基准：2026-07-11 前后的任意 epoch ms。
    private let nowMs: Int64 = 1_783_500_000_000
    private var nowSec: Int64 { nowMs / 1000 }

    private func status(
        five: (pct: Double, resetsAt: Int64)? = nil,
        seven: (pct: Double, resetsAt: Int64)? = nil,
        writtenAtMs: Int64? = nil
    ) -> UsageStatus {
        UsageStatus(
            writtenAtMs: writtenAtMs ?? nowMs,
            fiveHour: five.map { UsageWindowReading(usedPct: $0.pct, resetsAt: $0.resetsAt) },
            sevenDay: seven.map { UsageWindowReading(usedPct: $0.pct, resetsAt: $0.resetsAt) })
    }

    // MARK: UL_edge_fire_at_90

    @Test("UL_edge_fire_at_90: pct 96 首见 → fire 一次 level 90；88 不 fire")
    func fireAt90() {
        let resets = nowSec + 3600
        let below = UsageLimitWatcher.decide(
            state: .init(), status: status(five: (88, resets)), nowMs: nowMs)
        #expect(below.alerts.isEmpty)

        let crossed = UsageLimitWatcher.decide(
            state: .init(), status: status(five: (96, resets)), nowMs: nowMs)
        #expect(crossed.alerts == [
            UsageAlert(window: .fiveHour, usedPct: 96, resetsAt: resets, level: 90)
        ])
    }

    // MARK: UL_edge_dedupe_same_window

    @Test("UL_edge_dedupe_same_window: 96→97 同 (window,resetsAt) 不再 fire")
    func dedupeSameWindow() {
        let resets = nowSec + 3600
        let first = UsageLimitWatcher.decide(
            state: .init(), status: status(five: (96, resets)), nowMs: nowMs)
        #expect(first.alerts.count == 1)
        let second = UsageLimitWatcher.decide(
            state: first.state, status: status(five: (97, resets)), nowMs: nowMs)
        #expect(second.alerts.isEmpty)
    }

    // MARK: UL_edge_rearm_on_reset

    @Test("UL_edge_rearm_on_reset: resetsAt 变化（窗口重置/换号）→ 同窗口再 fire，老 key 被清")
    func rearmOnReset() {
        let resets1 = nowSec + 600
        let first = UsageLimitWatcher.decide(
            state: .init(), status: status(five: (96, resets1)), nowMs: nowMs)
        #expect(first.alerts.count == 1)
        let resets2 = nowSec + 18_000 // 新窗口
        let second = UsageLimitWatcher.decide(
            state: first.state, status: status(five: (97, resets2)), nowMs: nowMs)
        #expect(second.alerts == [
            UsageAlert(window: .fiveHour, usedPct: 97, resetsAt: resets2, level: 90)
        ])
        // 老 resetsAt 的 key 已被清理（登记集只剩当前窗口）。
        #expect(second.state.fired.allSatisfy { $0.contains("\(resets2)") })
    }

    // MARK: UL_edge_hysteresis

    @Test("UL_edge_hysteresis: 96→92（≥85 未回落够）不再武装；96→84 回落后再爬 96 → 再 fire")
    func hysteresis() {
        let resets = nowSec + 3600
        let fired = UsageLimitWatcher.decide(
            state: .init(), status: status(five: (96, resets)), nowMs: nowMs)
        // 回落 92：仍 ≥ 90−5，不撤销登记 → 再爬 96 不 fire。
        let dip92 = UsageLimitWatcher.decide(
            state: fired.state, status: status(five: (92, resets)), nowMs: nowMs)
        #expect(dip92.alerts.isEmpty)
        let climbAfter92 = UsageLimitWatcher.decide(
            state: dip92.state, status: status(five: (96, resets)), nowMs: nowMs)
        #expect(climbAfter92.alerts.isEmpty)
        // 回落 84：< 85（90−5）→ 撤销登记（换号后同 resetsAt 极端场兜底）→ 再爬 96 再 fire。
        let dip84 = UsageLimitWatcher.decide(
            state: fired.state, status: status(five: (84, resets)), nowMs: nowMs)
        let climbAfter84 = UsageLimitWatcher.decide(
            state: dip84.state, status: status(five: (96, resets)), nowMs: nowMs)
        #expect(climbAfter84.alerts.count == 1)
    }

    // MARK: UL_edge_level_99

    @Test("UL_edge_level_99: 96 已 fire 后爬 99.5 → 追加一次 level 99 加急")
    func level99() {
        let resets = nowSec + 3600
        let first = UsageLimitWatcher.decide(
            state: .init(), status: status(five: (96, resets)), nowMs: nowMs)
        let second = UsageLimitWatcher.decide(
            state: first.state, status: status(five: (99.5, resets)), nowMs: nowMs)
        #expect(second.alerts == [
            UsageAlert(window: .fiveHour, usedPct: 99.5, resetsAt: resets, level: 99)
        ])
        // 两窗口独立：sevenDay 同时越阈 → 各自 fire。
        let both = UsageLimitWatcher.decide(
            state: .init(),
            status: status(five: (96, resets), seven: (95.5, resets + 86_400)), nowMs: nowMs)
        #expect(both.alerts.map(\.window) == [.fiveHour, .sevenDay])
    }

    // MARK: UL_edge_stale_no_fire

    @Test("UL_edge_stale_no_fire: writtenAtMs 距今 >10min（会话全停）→ 整轮不 fire、不动登记")
    func staleNoFire() {
        let resets = nowSec + 3600
        let stale = UsageLimitWatcher.decide(
            state: .init(),
            status: status(five: (99, resets), writtenAtMs: nowMs - 11 * 60 * 1000),
            nowMs: nowMs)
        #expect(stale.alerts.isEmpty)
        #expect(stale.state == UsageLimitWatcher.State())
    }

    // MARK: UL_edge_expired_resets_no_fire

    @Test("UL_edge_expired_resets_no_fire: resetsAt ≤ now（窗口已重置文件未刷新）→ 该窗口不 fire")
    func expiredNoFire() {
        let expired = UsageLimitWatcher.decide(
            state: .init(), status: status(five: (99, nowSec - 60)), nowMs: nowMs)
        #expect(expired.alerts.isEmpty)
        // 另一窗口不受牵连。
        let mixed = UsageLimitWatcher.decide(
            state: .init(),
            status: status(five: (99, nowSec - 60), seven: (96, nowSec + 86_400)), nowMs: nowMs)
        #expect(mixed.alerts.map(\.window) == [.sevenDay])
    }

    // MARK: UL_watch_missing_file_noop

    @Test("UL_watch_missing_file_noop: 文件缺失/非法 → checkNow 无 fire 无崩溃；timer 已挂")
    func missingFileNoop() throws {
        try withTempRoot { root in
            var fired: [UsageAlert] = []
            var timersMade = 0
            let watcher = UsageLimitWatcher(
                usageStatusURL: StatusLineScript.usageStatusURL(dataRoot: root),
                now: { self.nowMs },
                makeTimer: { _, _ in
                    timersMade += 1
                    return NoopTimer()
                },
                notify: { fired.append($0) })
            watcher.start() // 内含首查（文件缺失 no-op）
            watcher.checkNow()
            #expect(fired.isEmpty)
            #expect(timersMade == 1)
            // 非法文件内容同样 no-op。
            let url = StatusLineScript.usageStatusURL(dataRoot: root)
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("broken{".utf8).write(to: url)
            watcher.checkNow()
            #expect(fired.isEmpty)
        }
    }

    @Test("parse: 形状容忍——窗口键缺失可解；writtenAtMs 缺失 → nil")
    func parseShape() {
        let ok = UsageLimitWatcher.parse(Data(#"{"writtenAtMs":123}"#.utf8))
        #expect(ok == UsageStatus(writtenAtMs: 123, fiveHour: nil, sevenDay: nil))
        #expect(UsageLimitWatcher.parse(Data(#"{"fiveHour":{}}"#.utf8)) == nil)
        let full = UsageLimitWatcher.parse(Data(
            #"{"writtenAtMs":123,"fiveHour":{"usedPct":96.2,"resetsAt":456},"sevenDay":{"usedPct":1,"resetsAt":789}}"#
                .utf8))
        #expect(full?.fiveHour == UsageWindowReading(usedPct: 96.2, resetsAt: 456))
        #expect(full?.sevenDay == UsageWindowReading(usedPct: 1, resetsAt: 789))
    }
}

@MainActor
final class NoopTimer: DockBadgeTimer {
    func invalidate() {}
}
