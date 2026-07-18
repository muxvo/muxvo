// 数据保留策略（M7 批4；specs/legacy/l2/boundaries.spec.json APP_L2_01）。
// 从行为规格实现——旧 src/main/services/analytics/retention.ts 只作说明书。
// 埋点事件 events 保留 90 天，日汇总 daily_summary 保留 365 天。

import Foundation

/// 数据保留天数策略（APP_L2_01 边界值）。
public struct RetentionPolicy: Equatable, Sendable {
    /// 明细事件保留天数（events）。
    public let eventsRetentionDays: Int
    /// 日汇总保留天数（daily_summary）。
    public let dailySummaryRetentionDays: Int

    public init(eventsRetentionDays: Int, dailySummaryRetentionDays: Int) {
        self.eventsRetentionDays = eventsRetentionDays
        self.dailySummaryRetentionDays = dailySummaryRetentionDays
    }

    /// 默认策略：events 90 天 / daily_summary 365 天（冻结 spec 边界）。
    public static let `default` = RetentionPolicy(
        eventsRetentionDays: 90,
        dailySummaryRetentionDays: 365
    )
}
