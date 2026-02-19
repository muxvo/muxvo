/**
 * Chat IPC Handlers
 *
 * Handles chat:get-projects, chat:get-sessions, chat:get-session,
 * chat:search, chat:export IPC channels.
 */

import { ipcMain } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import { createChatProjectReader } from '../services/chat-dual-source';
import { IPC_CHANNELS } from '@/shared/constants/channels';

const CC_BASE_PATH = join(homedir(), '.claude');

export function createChatHandlers() {
  const reader = createChatProjectReader({ ccBasePath: CC_BASE_PATH });

  return {
    async getProjects() {
      const projects = await reader.getProjects();
      return { projects };
    },

    async getSessions(params: { projectHash: string }) {
      if (params.projectHash === '__all__') {
        const sessions = await reader.getAllRecentSessions(50);
        return { sessions };
      }
      const sessions = await reader.getSessionsForProject(params.projectHash);
      return { sessions };
    },

    async getSession(params: { projectHash: string; sessionId: string }) {
      const messages = await reader.readSession(params.projectHash, params.sessionId);
      return { messages };
    },

    async search(params: { query: string }) {
      const results = await reader.search(params.query);
      return { results };
    },

    async export(params: { projectHash: string; sessionId: string; format: string }) {
      const { promises: fsp } = await import('fs');
      const messages = await reader.readSession(params.projectHash, params.sessionId);

      let content: string;
      let ext: string;
      if (params.format === 'json') {
        content = JSON.stringify(messages, null, 2);
        ext = 'json';
      } else {
        const lines: string[] = [`# Session Export: ${params.sessionId}`, ''];
        for (const msg of messages) {
          const role = msg.type;
          const body = typeof msg.content === 'string'
            ? msg.content
            : msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
          lines.push(`## ${role} (${msg.timestamp})`, '', body, '');
        }
        content = lines.join('\n');
        ext = 'md';
      }

      const exportDir = join(homedir(), '.muxvo', 'exports');
      await fsp.mkdir(exportDir, { recursive: true });
      const filePath = join(exportDir, `${params.sessionId}.${ext}`);
      await fsp.writeFile(filePath, content, 'utf-8');
      return { outputPath: filePath };
    },
  };
}

export function registerChatHandlers(): void {
  const handlers = createChatHandlers();
  ipcMain.handle(IPC_CHANNELS.CHAT.GET_PROJECTS, async () => handlers.getProjects());
  ipcMain.handle(IPC_CHANNELS.CHAT.GET_SESSIONS, async (_e, p) => handlers.getSessions(p));
  ipcMain.handle(IPC_CHANNELS.CHAT.GET_SESSION, async (_e, p) => handlers.getSession(p));
  ipcMain.handle(IPC_CHANNELS.CHAT.SEARCH, async (_e, p) => handlers.search(p));
  ipcMain.handle(IPC_CHANNELS.CHAT.EXPORT, async (_e, p) => handlers.export(p));
}
