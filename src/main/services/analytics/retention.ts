/**
 * Analytics Retention Policy
 *
 * Data retention rules: events 90 days, daily summaries 365 days.
 */

export interface RetentionPolicy {
  eventsRetentionDays: number;
  summaryRetentionDays: number;
}

export function getRetentionPolicy(): RetentionPolicy {
  return {
    eventsRetentionDays: 90,
    summaryRetentionDays: 365,
  };
}
