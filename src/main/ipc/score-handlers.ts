/**
 * Score IPC Handlers
 *
 * Handles score:run, score:check-scorer, score:get-cached IPC channels.
 * Pushes score:progress, score:result events to renderer.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { runScore } from '@/modules/score/runner';
import { getCachedScore } from '@/modules/score/cache';
import type { ScoreRunRequest } from '@/shared/types/score.types';

function pushToAllWindows(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

export function createScoreHandlers() {
  return {
    async checkScorer(): Promise<Record<string, unknown>> {
      try {
        return { success: true, data: { installed: false } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'SCORE_ERROR', message } };
      }
    },

    async run(params: ScoreRunRequest): Promise<Record<string, unknown>> {
      try {
        pushToAllWindows(IPC_CHANNELS.SCORE.PROGRESS, {
          skillDirName: params.skillDirName,
          status: 'checking',
        });

        const result = await runScore({
          skillPath: params.skillDirName,
          includeUsageData: params.includeAnalytics,
        });

        if (result.success) {
          pushToAllWindows(IPC_CHANNELS.SCORE.RESULT, {
            skillDirName: params.skillDirName,
            score: result,
          });
        }

        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'SCORE_ERROR', message } };
      }
    },

    async getCached(params: { skillDirName: string }): Promise<Record<string, unknown>> {
      try {
        const result = await getCachedScore(params.skillDirName);
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'SCORE_ERROR', message } };
      }
    },
  };
}

export function registerScoreHandlers(): void {
  const handlers = createScoreHandlers();

  ipcMain.handle(IPC_CHANNELS.SCORE.CHECK_SCORER, async () => {
    return handlers.checkScorer();
  });

  ipcMain.handle(IPC_CHANNELS.SCORE.RUN, async (_event, params: ScoreRunRequest) => {
    return handlers.run(params);
  });

  ipcMain.handle(IPC_CHANNELS.SCORE.GET_CACHED, async (_event, params: { skillDirName: string }) => {
    return handlers.getCached(params);
  });
}

// Legacy export for tests
export const scoreHandlers = createScoreHandlers();
