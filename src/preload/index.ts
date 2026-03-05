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

import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';

/** Type-safe API exposed to renderer process */
const api = {
  // --- Terminal domain (A2 will wire real handlers) ---
  terminal: {
    create: (cwd: string, cols?: number, rows?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.CREATE, { cwd, cols, rows }),
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
    acknowledgeWaiting: (id: string) =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL.ACKNOWLEDGE_WAITING, { id }),
    setName: (id: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.SET_NAME, { id, name }),
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
    onListUpdated: (callback: (data: Array<{ id: string; state: string; cwd?: string; customName?: string }>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: Array<{ id: string; state: string; cwd?: string; customName?: string }>) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.LIST_UPDATED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.LIST_UPDATED, handler);
    },
    onCwdChange: (callback: (data: { id: string; cwd: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; cwd: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.CWD_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.CWD_CHANGED, handler);
    },
    onZoom: (callback: (direction: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, direction: string) => callback(direction);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.ZOOM, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.ZOOM, handler);
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
    onUpdateAvailable: (callback: (data: { version: string; releaseDate: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as { version: string; releaseDate: string });
      ipcRenderer.on(IPC_CHANNELS.APP.UPDATE_AVAILABLE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.UPDATE_AVAILABLE, handler);
    },
    onUpdateDownloading: (callback: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as { percent: number; bytesPerSecond: number; transferred: number; total: number });
      ipcRenderer.on(IPC_CHANNELS.APP.UPDATE_DOWNLOADING, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.UPDATE_DOWNLOADING, handler);
    },
    onUpdateDownloaded: (callback: (data: { version: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as { version: string });
      ipcRenderer.on(IPC_CHANNELS.APP.UPDATE_DOWNLOADED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.UPDATE_DOWNLOADED, handler);
    },
    onUpdateError: (callback: (data: { message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as { message: string });
      ipcRenderer.on(IPC_CHANNELS.APP.UPDATE_ERROR, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.UPDATE_ERROR, handler);
    },
    installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.APP.INSTALL_UPDATE),
    checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.APP.CHECK_FOR_UPDATE),
    downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.APP.DOWNLOAD_UPDATE),
    onZoom: (callback: (direction: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, direction: string) => callback(direction);
      ipcRenderer.on(IPC_CHANNELS.APP.ZOOM, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.ZOOM, handler);
    },
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
    getZoomFactor: () => webFrame.getZoomFactor(),
    onCloseRequested: (callback: (data: { terminalCount: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalCount: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.APP.CLOSE_REQUESTED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.CLOSE_REQUESTED, handler);
    },
    confirmClose: () => ipcRenderer.invoke(IPC_CHANNELS.APP.CONFIRM_CLOSE),
    cancelClose: () => ipcRenderer.invoke(IPC_CHANNELS.APP.CANCEL_CLOSE),
    onOpenWorkspaceManager: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.APP.OPEN_WORKSPACE_MANAGER, handler);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.APP.OPEN_WORKSPACE_MANAGER, handler); };
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
    showFileMenu: (path: string, isDirectory: boolean, x: number, y: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS.SHOW_FILE_MENU, { path, isDirectory, x, y }),
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
    setSessionName: (cwd: string, customName: string, sessionId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.SET_SESSION_NAME, { cwd, customName, sessionId }),
    restoreSession: (projectHash: string, sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT.RESTORE_SESSION, { projectHash, sessionId }),
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
    loginGoogle: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN_GOOGLE),
    sendEmailCode: (email: string, purpose?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.SEND_EMAIL_CODE, { email, ...(purpose ? { purpose } : {}) }),
    verifyEmailCode: (email: string, code: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.VERIFY_EMAIL_CODE, { email, code }),
    register: (email: string, code: string, password: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.REGISTER, { email, code, password }),
    loginPassword: (email: string, password: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN_PASSWORD, { email, password }),
    resetPassword: (email: string, code: string, newPassword: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.RESET_PASSWORD, { email, code, newPassword }),
    oauthCallback: (accessToken: string, refreshToken: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.OAUTH_CALLBACK, { accessToken, refreshToken }),
    refreshToken: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.REFRESH_TOKEN),
    getProfile: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH.GET_PROFILE),
    onSessionExpired: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.AUTH.SESSION_EXPIRED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH.SESSION_EXPIRED, handler);
    },
    onStatusChange: (callback: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AUTH.STATUS_CHANGE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH.STATUS_CHANGE, handler);
    },
  },

  // --- Config domain ---
  config: {
    getResources: (type?: string, projectPaths?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_RESOURCES, {
        ...(type ? { types: [type] } : {}),
        ...(projectPaths?.length ? { projectPaths } : {}),
      }),
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

  // --- Analytics domain ---
  analytics: {
    track: (event: string, params?: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.TRACK, { event, params }),
    getSummary: (startDate: string, endDate: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.GET_SUMMARY, { startDate, endDate }),
    clear: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.CLEAR),
  },

  // --- Perf domain (renderer → main perf log) ---
  perf: {
    log: (message: string) =>
      ipcRenderer.send(IPC_CHANNELS.PERF.LOG, { message }),
  },

  // --- Worktree domain ---
  worktree: {
    detectRepo: (path: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKTREE.DETECT_REPO, { path }),
    list: (repoPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKTREE.LIST, { repoPath }),
    create: (repoPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKTREE.CREATE, { repoPath }),
    remove: (worktreePath: string, force?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKTREE.REMOVE, { worktreePath, force }),
  },

  // --- Glyph diagnostic log (writes to ~/.muxvo/logs/glyph-debug.log) ---
  glyphLog: (message: string) =>
    ipcRenderer.send('glyph:log', { message }),

  // --- Terminal diagnostic log (writes to ~/.muxvo/logs/terminal-debug.log) ---
  termDebugLog: (message: string) =>
    ipcRenderer.send(IPC_CHANNELS.TERMINAL.DEBUG_LOG, { message }),

  // --- Utility: native file path from drag-and-drop ---
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('api', api);

/** Export type for use in renderer */
export type MuxvoAPI = typeof api;
