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

export interface TrackerOptions {
  /** 服务端上报函数，不提供则只做本地存储 */
  upload?: (events: Array<{ metric: string; value?: number; metadata?: object }>) => Promise<boolean>;
  /** 上报间隔（毫秒），默认 60000 */
  uploadIntervalMs?: number;
}

export function createAnalyticsTracker(options?: TrackerOptions) {
  const events: StoredEvent[] = [];
  const uploadQueue: StoredEvent[] = [];
  let retryCount = 0;
  const MAX_RETRIES = 3;

  let uploadTimer: ReturnType<typeof setInterval> | null = null;

  const tracker = {
    track(input: TrackEvent): void {
      events.push({
        event: input.event,
        params: input.params,
        timestamp: new Date().toISOString(),
      });
      if (options?.upload) {
        uploadQueue.push({
          event: input.event,
          params: input.params,
          timestamp: new Date().toISOString(),
        });
      }
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

    async flush(): Promise<void> {
      if (!options?.upload || uploadQueue.length === 0) return;
      const batch = uploadQueue.splice(0, uploadQueue.length);
      const mapped = batch.map((e) => ({
        metric: e.event,
        value: 1,
        metadata: e.params as object | undefined,
      }));
      const success = await options.upload(mapped);
      if (!success) {
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          uploadQueue.unshift(...batch); // 放回队列重试
        }
        // 超过重试次数则丢弃
      } else {
        retryCount = 0;
      }
    },

    clear(): void {
      events.length = 0;
    },

    dispose(): void {
      if (uploadTimer) {
        clearInterval(uploadTimer);
        uploadTimer = null;
      }
    },
  };

  // Start periodic upload if upload function is provided
  if (options?.upload) {
    uploadTimer = setInterval(async () => {
      await tracker.flush();
    }, options.uploadIntervalMs ?? 60000);
  }

  return tracker;
}

export type AnalyticsTracker = ReturnType<typeof createAnalyticsTracker>;
