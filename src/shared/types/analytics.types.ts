/**
 * 数据埋点域类型定义
 * 来源: DEV-PLAN.md §2.10 analytics:*
 */

/** analytics:track 请求参数 */
export interface TrackEvent {
  event: string;
  params?: Record<string, any>;
}

/** analytics:get-summary 请求参数 */
export interface AnalyticsSummaryRequest {
  startDate: string;
  endDate: string;
}

/** analytics:get-summary 返回的每日摘要 */
export interface DailySummary {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 当天事件总数 */
  totalEvents: number;
  /** 按事件名称分组的计数 */
  eventCounts: Record<string, number>;
}
