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
    onCwdChange: (callback: (data: { id: string; cwd: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; cwd: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.CWD_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.CWD_CHANGED, handler);
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
    selectDirectory: (defaultPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.SELECT_DIRECTORY, defaultPath ? { defaultPath } : undefined),
    readDir: (dirPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.READ_DIR, { path: dirPath }),
    readFile: (filePath: string, encoding?: 'utf-8' | 'base64') =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.READ_FILE, { path: filePath, encoding }),
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
    getProjects: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_PROJECTS),
    getSessions: (projectHash: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_SESSIONS, { projectHash }),
    getSession: (projectHash: string, sessionId: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_SESSION, { projectHash, sessionId, limit }),
    search: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.SEARCH, { query }),
    export: (projectHash: string, sessionId: string, format: string, title?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.EXPORT, { projectHash, sessionId, format, title }),
    getArchiveEnabled: () =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_ARCHIVE_ENABLED),
    setArchiveEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.SET_ARCHIVE_ENABLED, { enabled }),
    showSessionMenu: (x: number, y: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.SHOW_SESSION_MENU, { x, y }),
    deleteSession: (projectHash: string, sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.DELETE_SESSION, { projectHash, sessionId }),
    revealFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.REVEAL_FILE, { filePath }),
    onSessionUpdate: (callback: (data: { projectHash: string; sessionId: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { projectHash: string; sessionId: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CHAT.SESSION_UPDATE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT.SESSION_UPDATE, handler);
    },
    onSyncStatus: (callback: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CHAT.SYNC_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT.SYNC_STATUS, handler);
    },
    onArchiveProgress: (callback: (data: { synced: number; total: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { synced: number; total: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CHAT.ARCHIVE_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT.ARCHIVE_PROGRESS, handler);
    },
  },

  // --- Auth domain ---
  auth: {
    loginGithub: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN_GITHUB),
    logout: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGOUT),
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.GET_STATUS),
  },

  // --- Config domain ---
  config: {
    getResources: (type?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_RESOURCES, type ? { types: [type] } : undefined),
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
    getMemory: (projectHash: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_MEMORY, { projectHash }),
    onResourceChange: (callback: (data: { type: string; event: string; name: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { type: string; event: string; name: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.CONFIG.RESOURCE_CHANGE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CONFIG.RESOURCE_CHANGE, handler);
    },
  },

  // --- Marketplace domain ---
  marketplace: {
    fetchSources: () =>
      ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.FETCH_SOURCES),
    search: (query: string, filters?: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.SEARCH, { query, filters }),
    install: (params: { name: string; source: string; type: 'skill' | 'hook'; version?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.INSTALL, params),
    uninstall: (name: string, type?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.UNINSTALL, { name, type }),
    getInstalled: () =>
      ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.GET_INSTALLED),
    checkUpdates: () =>
      ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.CHECK_UPDATES),
    onInstallProgress: (callback: (data: { name: string; progress: number; status: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { name: string; progress: number; status: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, handler);
    },
    onPackagesLoaded: (callback: (data: { packages: unknown[]; source: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { packages: unknown[]; source: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.MARKETPLACE.PACKAGES_LOADED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.MARKETPLACE.PACKAGES_LOADED, handler);
    },
    onUpdateAvailable: (callback: (data: { packages: unknown[] }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { packages: unknown[] }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.MARKETPLACE.UPDATE_AVAILABLE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.MARKETPLACE.UPDATE_AVAILABLE, handler);
    },
  },

  // --- Score domain ---
  score: {
    checkScorer: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SCORE.CHECK_SCORER),
    run: (skillDirName: string, includeAnalytics?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.SCORE.RUN, { skillDirName, includeAnalytics }),
    getCached: (skillDirName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SCORE.GET_CACHED, { skillDirName }),
    onProgress: (callback: (data: { skillDirName: string; status: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { skillDirName: string; status: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.SCORE.PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SCORE.PROGRESS, handler);
    },
    onResult: (callback: (data: { skillDirName: string; score: unknown }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { skillDirName: string; score: unknown }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.SCORE.RESULT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SCORE.RESULT, handler);
    },
  },

  // --- Showcase domain ---
  showcase: {
    generate: (skillDirName: string, template: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHOWCASE.GENERATE, { skillDirName, template }),
    publish: (params: { skillDirName: string; details?: unknown; securityChecked: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHOWCASE.PUBLISH, params),
    unpublish: (skillDirName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SHOWCASE.UNPUBLISH, { skillDirName }),
    onPublishResult: (callback: (data: { skillDirName: string; success: boolean; url?: string; error?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { skillDirName: string; success: boolean; url?: string; error?: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.SHOWCASE.PUBLISH_RESULT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SHOWCASE.PUBLISH_RESULT, handler);
    },
  },

  // --- Analytics domain ---
  analytics: {
    track: (event: string, params?: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.TRACK, { event, params }),
    getSummary: (startDate: string, endDate: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.GET_SUMMARY, { startDate, endDate }),
    clear: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.CLEAR),
  },
};

contextBridge.exposeInMainWorld('api', api);

/** Export type for use in renderer */
export type MuxvoAPI = typeof api;
