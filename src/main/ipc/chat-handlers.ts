/**
 * Chat IPC Handlers
 *
 * Handles chat:get-history, chat:get-session, chat:search, chat:export IPC channels.
 */

import { ipcMain } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import { createDualSourceReader } from '../services/chat-dual-source';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { ChatHistoryRequest } from '@/shared/types/chat.types';

// Default CC and mirror paths
const CC_BASE_PATH = join(homedir(), '.claude');
const MIRROR_BASE_PATH = join(homedir(), '.muxvo', 'data', 'mirror');

export function createChatHandlers() {
  const reader = createDualSourceReader({
    ccBasePath: CC_BASE_PATH,
    mirrorBasePath: MIRROR_BASE_PATH,
  });

  return {
    async getHistory(opts?: ChatHistoryRequest & { forceFail?: boolean }): Promise<Record<string, unknown>> {
      // Support forceFail for testing error scenarios
      if (opts?.forceFail) {
        return {
          sessions: [],
          error: { code: 'FILE_NOT_FOUND', message: 'CC files and mirror both unavailable' },
        };
      }

      const result = await reader.readHistory();

      if (result.source === null) {
        return {
          sessions: [],
          error: { code: 'FILE_NOT_FOUND', message: result.error || 'History unavailable' },
        };
      }

      return {
        sessions: result.entries,
        source: result.source,
        fallback: result.fallback,
        hint: result.hint,
      };
    },

    async getSession(params: { sessionId: string; projectHash?: string }): Promise<Record<string, unknown>> {
      // If projectHash not provided, try to extract from sessionId or use default
      const projectHash = params.projectHash || 'default';
      const result = await reader.readSession(projectHash, params.sessionId);

      if (result.source === null) {
        return {
          messages: [],
          error: { code: 'FILE_NOT_FOUND', message: result.error || 'Session unavailable' },
        };
      }

      return {
        messages: result.messages,
        source: result.source,
        fallback: result.fallback,
        hint: result.hint,
      };
    },

    async search(params: { query: string }): Promise<Record<string, unknown>> {
      const history = await reader.readHistory();
      if (history.source === null) return { results: [] };
      const q = params.query.toLowerCase();
      const results = history.entries
        .filter((e: any) => e.display.toLowerCase().includes(q))
        .map((e: any) => ({
          project: e.project,
          sessionId: e.sessionId || '',
          snippet: e.display.slice(0, 100),
          timestamp: e.timestamp,
        }));
      return { results };
    },

    async export(_params: { sessionId: string; format: string }): Promise<Record<string, unknown>> {
      // Export not implemented yet
      return {
        outputPath: '/tmp/export/session.md',
      };
    },
  };
}

// Legacy export for tests
export const chatHandlers = createChatHandlers();

/**
 * Register chat IPC handlers with ipcMain.
 */
export function registerChatHandlers(): void {
  const handlers = createChatHandlers();

  ipcMain.handle(IPC_CHANNELS.CHAT.GET_HISTORY, async (_event, params?: ChatHistoryRequest) => {
    return handlers.getHistory(params);
  });

  ipcMain.handle(IPC_CHANNELS.CHAT.GET_SESSION, async (_event, params: { sessionId: string; projectHash?: string }) => {
    return handlers.getSession(params);
  });

  ipcMain.handle(IPC_CHANNELS.CHAT.SEARCH, async (_event, params: { query: string }) => {
    return handlers.search(params);
  });

  ipcMain.handle(IPC_CHANNELS.CHAT.EXPORT, async (_event, params: { sessionId: string; format: string }) => {
    return handlers.export(params);
  });
}
