/**
 * Muxvo — Preload Script
 * DEV-PLAN A1: contextBridge IPC 桥接
 *
 * Security model:
 *   contextIsolation: true
 *   nodeIntegration: false
 *
 * Exposes typed API groups to renderer via window.api
 * Each domain will be wired to real IPC handlers in subsequent tasks (A2, D1, G1, etc.)
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';

/** Type-safe API exposed to renderer process */
const api = {
  // --- Terminal domain (A2 will wire real handlers) ---
  terminal: {
    create: (cwd: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.CREATE, { cwd }),
    write: (id: string, data: string) =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL.WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL.RESIZE, { id, cols, rows }),
    close: (id: string, force?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.CLOSE, { id, force }),
    list: () =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.LIST),
    getBuffer: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_BUFFER, { id }),
    getState: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_STATE, { id }),
    getForegroundProcess: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_FOREGROUND_PROCESS, { id }),
    updateCwd: (id: string, cwd: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.UPDATE_CWD, { id, cwd }),
    onOutput: (callback: (data: { id: string; data: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; data: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.OUTPUT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.OUTPUT, handler);
    },
    onStateChange: (callback: (data: { id: string; state: string; processName?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; state: string; processName?: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.STATE_CHANGE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.STATE_CHANGE, handler);
    },
    onExit: (callback: (data: { id: string; code: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; code: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.EXIT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.EXIT, handler);
    },
    onListUpdated: (callback: (data: Array<{ id: string; state: string }>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: Array<{ id: string; state: string }>) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.LIST_UPDATED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.LIST_UPDATED, handler);
    },
  },

  // --- App domain ---
  app: {
    getConfig: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.GET_CONFIG),
    saveConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_CONFIG, config),
    getPreferences: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.GET_PREFERENCES),
    savePreferences: (prefs: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_PREFERENCES, prefs),
    detectCliTools: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.DETECT_CLI_TOOLS),
    getHomePath: () => process.env.HOME || process.env.USERPROFILE || '/',
    onMemoryWarning: (callback: (data: { usageMB: number; threshold: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { usageMB: number; threshold: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.APP.MEMORY_WARNING, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.MEMORY_WARNING, handler);
    },
  },

  // --- FS domain ---
  fs: {
    selectDirectory: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.SELECT_DIRECTORY),
    readDir: (dirPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.READ_DIR, { path: dirPath }),
    readFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.READ_FILE, { path: filePath }),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.WRITE_FILE, { path: filePath, content }),
    watchStart: (id: string, paths: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.WATCH_START, { id, paths }),
    watchStop: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.WATCH_STOP, { id }),
    onFileChange: (callback: (data: { watchId: string; type: string; path: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { watchId: string; type: string; path: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.FS.CHANGE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FS.CHANGE, handler);
    },
    writeTempImage: (imageData: string, format: 'png' | 'jpg') =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.WRITE_TEMP_IMAGE, { imageData, format }),
    writeClipboardImage: (imagePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.WRITE_CLIPBOARD_IMAGE, { imagePath }),
  },

  // --- Chat domain ---
  chat: {
    getHistory: (params?: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_HISTORY, params),
    getSession: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_SESSION, { sessionId }),
    search: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.SEARCH, { query }),
    onSessionUpdate: (callback: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CHAT.SESSION_UPDATE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT.SESSION_UPDATE, handler);
    },
    onSyncStatus: (callback: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CHAT.SYNC_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT.SYNC_STATUS, handler);
    },
    export: (sessionId: string, format: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.EXPORT, { sessionId, format }),
  },

  // --- Config domain ---
  config: {
    getResources: (type?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_RESOURCES, { type }),
    getResourceContent: (resourcePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_RESOURCE_CONTENT, { path: resourcePath }),
    getSettings: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_SETTINGS),
    saveSettings: (settings: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.SAVE_SETTINGS, { settings }),
    getClaudeMd: (scope?: string, projectPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_CLAUDE_MD, { scope, projectPath }),
    saveClaudeMd: (content: string, scope?: string, projectPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.SAVE_CLAUDE_MD, { content, scope, projectPath }),
  },
};

contextBridge.exposeInMainWorld('api', api);

/** Export type for use in renderer */
export type MuxvoAPI = typeof api;
