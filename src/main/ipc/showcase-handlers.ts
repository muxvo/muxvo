/**
 * Showcase IPC Handlers
 *
 * Handles showcase:generate, showcase:publish, showcase:unpublish IPC channels.
 * Push events: publish-result.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { generateShowcase } from '@/modules/showcase/generator';
import { createPublishFlow } from '@/modules/publish/publish-flow';
import type { ShowcaseGenerateRequest, ShowcasePublishRequest } from '@/shared/types/showcase.types';

function pushToAllWindows(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

export function createShowcaseHandlers() {
  return {
    async generate(params: ShowcaseGenerateRequest): Promise<Record<string, unknown>> {
      try {
        const result = await generateShowcase({
          skillPath: params.skillDirName,
          scoreResult: null,
        });
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'SHOWCASE_GENERATE_ERROR', message } };
      }
    },

    async publish(params: ShowcasePublishRequest): Promise<Record<string, unknown>> {
      try {
        const flow = createPublishFlow({
          skillPath: params.skillDirName,
          githubLoggedIn: true,
        });
        const result = await flow.start();

        pushToAllWindows(IPC_CHANNELS.SHOWCASE.PUBLISH_RESULT, {
          skillDirName: params.skillDirName,
          success: result.success,
          url: undefined,
          error: result.reason,
        });

        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'SHOWCASE_PUBLISH_ERROR', message } };
      }
    },

    async unpublish(params: { skillDirName: string }): Promise<Record<string, unknown>> {
      try {
        // Stub implementation
        return { success: true, data: { unpublished: true } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'SHOWCASE_UNPUBLISH_ERROR', message } };
      }
    },
  };
}

// Legacy export for tests
export const showcaseHandlers = createShowcaseHandlers();

export function registerShowcaseHandlers(): void {
  const handlers = createShowcaseHandlers();

  ipcMain.handle(IPC_CHANNELS.SHOWCASE.GENERATE, async (_event, params: ShowcaseGenerateRequest) => {
    return handlers.generate(params);
  });

  ipcMain.handle(IPC_CHANNELS.SHOWCASE.PUBLISH, async (_event, params: ShowcasePublishRequest) => {
    return handlers.publish(params);
  });

  ipcMain.handle(IPC_CHANNELS.SHOWCASE.UNPUBLISH, async (_event, params: { skillDirName: string }) => {
    return handlers.unpublish(params);
  });
}
