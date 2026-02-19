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
        sessions: result.sessions,
        source: result.source,
        fallback: result.fallback,
        hint: result.hint,
      };
    },

    async getSession(params: { sessionId: string; projectHash: string }): Promise<Record<string, unknown>> {
      const result = await reader.readSession(params.projectHash, params.sessionId);

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
      const raw = await reader.readRawHistory();
      if (raw.source === null) return { results: [] };
      const q = params.query.toLowerCase();
      const results = raw.entries
        .filter((e) => e.display.toLowerCase().includes(q))
        .map((e) => ({
          project: e.project,
          sessionId: e.sessionId,
          snippet: e.display.slice(0, 100),
          timestamp: e.timestamp,
        }));
      return { results };
    },

    async export(params: { sessionId: string; format: string; projectHash: string }): Promise<Record<string, unknown>> {
      const { promises: fsp } = await import('fs');
      const { join } = await import('path');
      const { homedir } = await import('os');

      const result = await reader.readSession(params.projectHash, params.sessionId);

      if (result.source === null) {
        return {
          outputPath: '',
          error: { code: 'SESSION_NOT_FOUND', message: result.error || 'Session unavailable' },
        };
      }

      // Format messages
      let content: string;
      let ext: string;

      if (params.format === 'json') {
        content = JSON.stringify(result.messages, null, 2);
        ext = 'json';
      } else {
        // Default to markdown
        const lines: string[] = [`# Session Export: ${params.sessionId}`, ''];
        for (const msg of result.messages as Array<{ message?: { role?: string; content?: string }; timestamp?: string }>) {
          const role = msg.message?.role || 'unknown';
          const timestamp = msg.timestamp || '';
          const body = msg.message?.content || '';
          lines.push(`## ${role} (${timestamp})`, '', body, '');
        }
        content = lines.join('\n');
        ext = 'md';
      }

      // Write to ~/.muxvo/exports/
      const exportDir = join(homedir(), '.muxvo', 'exports');
      await fsp.mkdir(exportDir, { recursive: true });
      const filePath = join(exportDir, `${params.sessionId}.${ext}`);
      await fsp.writeFile(filePath, content, 'utf-8');

      return { outputPath: filePath };
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

  ipcMain.handle(IPC_CHANNELS.CHAT.GET_SESSION, async (_event, params: { sessionId: string; projectHash: string }) => {
    return handlers.getSession(params);
  });

  ipcMain.handle(IPC_CHANNELS.CHAT.SEARCH, async (_event, params: { query: string }) => {
    return handlers.search(params);
  });

  ipcMain.handle(IPC_CHANNELS.CHAT.EXPORT, async (_event, params: { sessionId: string; format: string; projectHash: string }) => {
    return handlers.export(params);
  });
}
