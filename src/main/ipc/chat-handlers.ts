/**
 * Chat IPC Handlers
 *
 * Handles chat:get-projects, chat:get-sessions, chat:get-session,
 * chat:search, chat:export IPC channels.
 */

import { ipcMain, Menu, BrowserWindow, shell } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import { promises as fsp } from 'fs';
import { createChatProjectReader } from '../services/chat-dual-source';
import { createChatArchiveManager } from '../services/chat-archive';
import { createCodexChatReader } from '../services/codex-chat-source';
import { createGeminiChatReader } from '../services/gemini-chat-source';
import { createChatMultiSource } from '../services/chat-multi-source';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { createConfigManager } from '../services/app/config';

const CC_BASE_PATH = join(homedir(), '.claude');
const CODEX_BASE_PATH = join(homedir(), '.codex');
const GEMINI_BASE_PATH = join(homedir(), '.gemini');

export function createChatHandlers() {
  const ccReader = createChatProjectReader({
    ccBasePath: CC_BASE_PATH,
    archivePath: join(homedir(), '.muxvo', 'chat-archive'),
  });

  // Codex reader (gracefully null if ~/.codex doesn't exist)
  let codexReader: ReturnType<typeof createCodexChatReader> | null = null;
  try {
    codexReader = createCodexChatReader({ codexBasePath: CODEX_BASE_PATH });
  } catch {
    // ~/.codex doesn't exist, skip
  }

  // Gemini reader (gracefully null if ~/.gemini doesn't exist)
  let geminiReader: ReturnType<typeof createGeminiChatReader> | null = null;
  try {
    geminiReader = createGeminiChatReader({ geminiBasePath: GEMINI_BASE_PATH });
  } catch {
    // ~/.gemini doesn't exist, skip
  }

  const reader = createChatMultiSource({ ccReader, codexReader, geminiReader });

  return {
    async getProjects() {
      const projects = await reader.getProjects();
      return { projects };
    },

    async getSessions(params: { projectHash: string }) {
      let sessions;
      if (params.projectHash === '__all__') {
        sessions = await reader.getAllRecentSessions(500);
      } else {
        sessions = await reader.getSessionsForProject(params.projectHash, 500);
      }

      // Apply custom session titles from config
      const cm = createConfigManager();
      const config = cm.loadConfig();
      const sessionTitles = config.sessionCustomTitles || {};
      const hasSessionTitles = Object.keys(sessionTitles).length > 0;

      if (hasSessionTitles) {
        sessions = sessions.map(s => {
          const sessionName = sessionTitles[s.sessionId];
          if (sessionName) {
            return { ...s, customTitle: sessionName };
          }
          return s;
        });
      }

      return { sessions };
    },

    async getSession(params: { projectHash: string; sessionId: string; limit?: number }) {
      const options = params.limit && params.limit > 0 ? { limit: params.limit } : undefined;
      const messages = await reader.readSession(params.projectHash, params.sessionId, options);
      return { messages };
    },

    async search(params: { query: string }) {
      const results = await reader.search(params.query);
      return { results };
    },

    async setSessionName(params: { customName: string; sessionId?: string; cwd?: string }) {
      const { customName, sessionId: directSessionId, cwd } = params;

      const cm = createConfigManager();
      const config = cm.loadConfig();
      const sessionTitles = { ...(config.sessionCustomTitles || {}) };

      if (directSessionId) {
        // Direct rename by sessionId (from history panel or terminal with known sessionId)
        if (customName) {
          sessionTitles[directSessionId] = customName;
        } else {
          delete sessionTitles[directSessionId];
        }
        cm.saveConfig({ ...config, sessionCustomTitles: sessionTitles });
        return { success: true, sessionId: directSessionId };
      } else if (cwd) {
        // CWD fallback: don't write to config here.
        // The terminal's customName is already set via terminalManager.setName().
        // chatWatcher.onSessionUpdate will detect the session and persist the name.
        return { success: false };
      } else {
        return { success: false };
      }
    },

    async export(params: { projectHash: string; sessionId: string; format: string; title?: string }) {
      // Export needs ALL messages, no limit
      const messages = await reader.readSession(params.projectHash, params.sessionId);

      let content: string;
      let ext: string;
      if (params.format === 'json') {
        content = JSON.stringify(messages, null, 2);
        ext = 'json';
      } else {
        const displayTitle = params.title || params.sessionId;
        const lines: string[] = [`# ${displayTitle}`, ''];
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

      // Sanitize title for filename: keep first 50 chars, remove invalid chars
      const rawName = params.title
        ? params.title.slice(0, 50).replace(/[\/\\:*?"<>|]/g, '_').trim()
        : params.sessionId;
      const fileName = rawName || params.sessionId;

      const exportDir = join(homedir(), '.muxvo', 'exports');
      await fsp.mkdir(exportDir, { recursive: true });
      const filePath = join(exportDir, `${fileName}.${ext}`);
      await fsp.writeFile(filePath, content, 'utf-8');
      return { outputPath: filePath };
    },

    async restoreSession(params: { projectHash: string; sessionId: string }) {
      const archivePath = join(homedir(), '.muxvo', 'chat-archive',
        params.projectHash, `${params.sessionId}.jsonl`);
      const ccProjectDir = join(homedir(), '.claude', 'projects', params.projectHash);
      const ccPath = join(ccProjectDir, `${params.sessionId}.jsonl`);

      // 检查 CC 目录中是否已存在（无需恢复）
      try { await fsp.access(ccPath); return { success: true, restored: false }; } catch {}

      // 检查 archive 中是否存在
      try { await fsp.access(archivePath); } catch {
        return { success: false, error: 'archive-not-found' };
      }

      // 确保 CC 项目目录存在
      await fsp.mkdir(ccProjectDir, { recursive: true });

      // 复制 archive → CC
      await fsp.copyFile(archivePath, ccPath);
      return { success: true, restored: true };
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
  ipcMain.handle(IPC_CHANNELS.CHAT.SET_SESSION_NAME, async (_e, p) => handlers.setSessionName(p));
  ipcMain.handle(IPC_CHANNELS.CHAT.RESTORE_SESSION, async (_e, p) => handlers.restoreSession(p));

  // Right-click context menu for session cards
  ipcMain.handle(IPC_CHANNELS.CHAT.SHOW_SESSION_MENU, async (_e, p: { x: number; y: number }) => {
    return new Promise<string | null>((resolve) => {
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: '✏️ 重命名', click: () => resolve('rename') },
        { label: '📄 导出为 Markdown', click: () => resolve('export') },
        { type: 'separator' },
        { label: '🗑 删除聊天记录', click: () => resolve('delete') },
      ];
      const menu = Menu.buildFromTemplate(template);
      menu.popup({
        x: p.x,
        y: p.y,
        window: BrowserWindow.getFocusedWindow() || undefined,
        callback: () => resolve(null),
      });
    });
  });

  // Delete session JSONL from both CC source and archive
  ipcMain.handle(IPC_CHANNELS.CHAT.DELETE_SESSION, async (_e, p: { projectHash: string; sessionId: string }) => {
    const ccPath = join(homedir(), '.claude', 'projects', p.projectHash, `${p.sessionId}.jsonl`);
    const archivePath = join(homedir(), '.muxvo', 'chat-archive', p.projectHash, `${p.sessionId}.jsonl`);
    const deleted: string[] = [];
    try { await fsp.unlink(ccPath); deleted.push('cc'); } catch { /* not found */ }
    try { await fsp.unlink(archivePath); deleted.push('archive'); } catch { /* not found */ }
    return { success: true, deleted };
  });

  // Reveal file in Finder/Explorer
  ipcMain.handle(IPC_CHANNELS.CHAT.REVEAL_FILE, async (_e, p: { filePath: string }) => {
    shell.showItemInFolder(p.filePath);
    return { success: true };
  });
}

export function registerChatArchiveHandlers(
  archiveManager: ReturnType<typeof createChatArchiveManager>
): void {
  ipcMain.handle(IPC_CHANNELS.CHAT.GET_ARCHIVE_ENABLED, async () => {
    return archiveManager.getEnabled();
  });
  ipcMain.handle(IPC_CHANNELS.CHAT.SET_ARCHIVE_ENABLED, async (_e, p: { enabled: boolean }) => {
    await archiveManager.setEnabled(p.enabled);
    return { success: true };
  });
}
