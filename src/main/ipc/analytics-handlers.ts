/** Analytics IPC Handlers - track events, get summaries, and clear analytics data */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { createAnalyticsTracker } from '@/main/services/analytics/tracker';
import type { AnalyticsTracker } from '@/main/services/analytics/tracker';
import type {
  TrackEvent,
  AnalyticsSummaryRequest,
} from '@/shared/types/analytics.types';

export function createAnalyticsHandlers(tracker: AnalyticsTracker) {
  return {
    async track(params: TrackEvent) {
      try {
        tracker.track(params);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: { code: 'ANALYTICS_TRACK_ERROR', message },
        };
      }
    },

    async getSummary(params: AnalyticsSummaryRequest) {
      try {
        const result = tracker.getSummary(params);
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: { code: 'ANALYTICS_SUMMARY_ERROR', message },
        };
      }
    },

    async clear() {
      try {
        tracker.clear();
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: { code: 'ANALYTICS_CLEAR_ERROR', message },
        };
      }
    },
  };
}

export function registerAnalyticsHandlers(): void {
  const tracker = createAnalyticsTracker();
  const handlers = createAnalyticsHandlers(tracker);

  ipcMain.handle(
    IPC_CHANNELS.ANALYTICS.TRACK,
    async (_event, params: TrackEvent) => {
      return handlers.track(params);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ANALYTICS.GET_SUMMARY,
    async (_event, params: AnalyticsSummaryRequest) => {
      return handlers.getSummary(params);
    }
  );

  ipcMain.handle(IPC_CHANNELS.ANALYTICS.CLEAR, async () => {
    return handlers.clear();
  });
}

// Legacy exports
const _defaultTracker = createAnalyticsTracker();
export const analyticsHandlers = createAnalyticsHandlers(_defaultTracker);
