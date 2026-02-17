/** Analytics Tracker - in-memory event storage with date-based summarization */

import type {
  TrackEvent,
  AnalyticsSummaryRequest,
  DailySummary,
} from '@/shared/types/analytics.types';

interface StoredEvent {
  event: string;
  params?: Record<string, any>;
  timestamp: string;
}

export function createAnalyticsTracker() {
  const events: StoredEvent[] = [];

  return {
    track(input: TrackEvent): void {
      events.push({
        event: input.event,
        params: input.params,
        timestamp: new Date().toISOString(),
      });
    },

    getSummary(req: AnalyticsSummaryRequest): DailySummary[] {
      // Filter events within date range (compare YYYY-MM-DD prefix of timestamp)
      const filtered = events.filter((e) => {
        const date = e.timestamp.slice(0, 10); // YYYY-MM-DD
        return date >= req.startDate && date <= req.endDate;
      });

      // Group by date
      const grouped = new Map<string, StoredEvent[]>();
      for (const e of filtered) {
        const date = e.timestamp.slice(0, 10);
        if (!grouped.has(date)) grouped.set(date, []);
        grouped.get(date)!.push(e);
      }

      // Build DailySummary array
      const summaries: DailySummary[] = [];
      for (const [date, dayEvents] of grouped) {
        const eventCounts: Record<string, number> = {};
        for (const e of dayEvents) {
          eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
        }
        summaries.push({ date, totalEvents: dayEvents.length, eventCounts });
      }

      // Sort by date ascending
      summaries.sort((a, b) => a.date.localeCompare(b.date));
      return summaries;
    },

    clear(): void {
      events.length = 0;
    },
  };
}

export type AnalyticsTracker = ReturnType<typeof createAnalyticsTracker>;
