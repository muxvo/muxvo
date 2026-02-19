"use strict";
const electron = require("electron");
const IPC_CHANNELS = {
  TERMINAL: {
    CREATE: "terminal:create",
    WRITE: "terminal:write",
    RESIZE: "terminal:resize",
    CLOSE: "terminal:close",
    OUTPUT: "terminal:output",
    STATE_CHANGE: "terminal:state-change",
    EXIT: "terminal:exit",
    GET_FOREGROUND_PROCESS: "terminal:get-foreground-process",
    LIST: "terminal:list",
    GET_STATE: "terminal:get-state",
    GET_BUFFER: "terminal:get-buffer",
    UPDATE_CWD: "terminal:update-cwd",
    CWD_CHANGED: "terminal:cwd-changed",
    LIST_UPDATED: "terminal:list-updated"
  },
  FS: {
    READ_DIR: "fs:read-dir",
    READ_FILE: "fs:read-file",
    WRITE_FILE: "fs:write-file",
    WATCH_START: "fs:watch-start",
    WATCH_STOP: "fs:watch-stop",
    CHANGE: "fs:change",
    SELECT_DIRECTORY: "fs:select-directory",
    WRITE_TEMP_IMAGE: "fs:write-temp-image",
    WRITE_CLIPBOARD_IMAGE: "fs:write-clipboard-image"
  },
  CHAT: {
    GET_PROJECTS: "chat:get-projects",
    GET_SESSIONS: "chat:get-sessions",
    GET_SESSION: "chat:get-session",
    SEARCH: "chat:search",
    SESSION_UPDATE: "chat:session-update",
    SYNC_STATUS: "chat:sync-status",
    EXPORT: "chat:export"
  },
  CONFIG: {
    GET_RESOURCES: "config:get-resources",
    GET_RESOURCE_CONTENT: "config:get-resource-content",
    GET_SETTINGS: "config:get-settings",
    SAVE_SETTINGS: "config:save-settings",
    GET_CLAUDE_MD: "config:get-claude-md",
    SAVE_CLAUDE_MD: "config:save-claude-md",
    GET_MEMORY: "config:get-memory",
    RESOURCE_CHANGE: "config:resource-change"
  },
  APP: {
    GET_CONFIG: "app:get-config",
    SAVE_CONFIG: "app:save-config",
    GET_PREFERENCES: "app:get-preferences",
    SAVE_PREFERENCES: "app:save-preferences",
    MEMORY_WARNING: "app:memory-warning",
    DETECT_CLI_TOOLS: "app:detect-cli-tools"
  },
  MARKETPLACE: {
    FETCH_SOURCES: "marketplace:fetch-sources",
    SEARCH: "marketplace:search",
    INSTALL: "marketplace:install",
    UNINSTALL: "marketplace:uninstall",
    GET_INSTALLED: "marketplace:get-installed",
    INSTALL_PROGRESS: "marketplace:install-progress",
    CHECK_UPDATES: "marketplace:check-updates",
    PACKAGES_LOADED: "marketplace:packages-loaded",
    UPDATE_AVAILABLE: "marketplace:update-available"
  },
  SCORE: {
    RUN: "score:run",
    CHECK_SCORER: "score:check-scorer",
    GET_CACHED: "score:get-cached",
    PROGRESS: "score:progress",
    RESULT: "score:result"
  },
  SHOWCASE: {
    GENERATE: "showcase:generate",
    PUBLISH: "showcase:publish",
    UNPUBLISH: "showcase:unpublish",
    PUBLISH_RESULT: "showcase:publish-result"
  },
  AUTH: {
    LOGIN_GITHUB: "auth:login-github",
    LOGOUT: "auth:logout",
    GET_STATUS: "auth:get-status"
  },
  ANALYTICS: {
    TRACK: "analytics:track",
    GET_SUMMARY: "analytics:get-summary",
    CLEAR: "analytics:clear"
  }
};
const api = {
  // --- Terminal domain (A2 will wire real handlers) ---
  terminal: {
    create: (cwd) => electron.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.CREATE, { cwd }),
    write: (id, data) => electron.ipcRenderer.send(IPC_CHANNELS.TERMINAL.WRITE, { id, data }),
    resize: (id, cols, rows) => electron.ipcRenderer.send(IPC_CHANNELS.TERMINAL.RESIZE, { id, cols, rows }),
    close: (id, force) => electron.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.CLOSE, { id, force }),
    list: () => electron.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.LIST),
    getBuffer: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_BUFFER, { id }),
    getState: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_STATE, { id }),
    getForegroundProcess: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_FOREGROUND_PROCESS, { id }),
    updateCwd: (id, cwd) => electron.ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.UPDATE_CWD, { id, cwd }),
    onOutput: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.TERMINAL.OUTPUT, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.OUTPUT, handler);
    },
    onStateChange: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.TERMINAL.STATE_CHANGE, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.STATE_CHANGE, handler);
    },
    onExit: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.TERMINAL.EXIT, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.EXIT, handler);
    },
    onListUpdated: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.TERMINAL.LIST_UPDATED, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.LIST_UPDATED, handler);
    },
    onCwdChange: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.TERMINAL.CWD_CHANGED, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.CWD_CHANGED, handler);
    }
  },
  // --- App domain ---
  app: {
    getConfig: () => electron.ipcRenderer.invoke(IPC_CHANNELS.APP.GET_CONFIG),
    saveConfig: (config) => electron.ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_CONFIG, config),
    getPreferences: () => electron.ipcRenderer.invoke(IPC_CHANNELS.APP.GET_PREFERENCES),
    savePreferences: (prefs) => electron.ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_PREFERENCES, prefs),
    detectCliTools: () => electron.ipcRenderer.invoke(IPC_CHANNELS.APP.DETECT_CLI_TOOLS),
    getHomePath: () => process.env.HOME || process.env.USERPROFILE || "/",
    onMemoryWarning: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.APP.MEMORY_WARNING, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.APP.MEMORY_WARNING, handler);
    }
  },
  // --- FS domain ---
  fs: {
    selectDirectory: (defaultPath) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.SELECT_DIRECTORY, defaultPath ? { defaultPath } : void 0),
    readDir: (dirPath) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.READ_DIR, { path: dirPath }),
    readFile: (filePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.READ_FILE, { path: filePath }),
    writeFile: (filePath, content) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.WRITE_FILE, { path: filePath, content }),
    watchStart: (id, paths) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.WATCH_START, { id, paths }),
    watchStop: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.WATCH_STOP, { id }),
    onFileChange: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.FS.CHANGE, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.FS.CHANGE, handler);
    },
    writeTempImage: (imageData, format) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.WRITE_TEMP_IMAGE, { imageData, format }),
    writeClipboardImage: (imagePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.WRITE_CLIPBOARD_IMAGE, { imagePath })
  },
  // --- Chat domain ---
  chat: {
    getProjects: () => electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_PROJECTS),
    getSessions: (projectHash) => electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_SESSIONS, { projectHash }),
    getSession: (projectHash, sessionId) => electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_SESSION, { projectHash, sessionId }),
    search: (query) => electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT.SEARCH, { query }),
    export: (projectHash, sessionId, format) => electron.ipcRenderer.invoke(IPC_CHANNELS.CHAT.EXPORT, { projectHash, sessionId, format }),
    onSessionUpdate: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.CHAT.SESSION_UPDATE, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT.SESSION_UPDATE, handler);
    },
    onSyncStatus: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.CHAT.SYNC_STATUS, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.CHAT.SYNC_STATUS, handler);
    }
  },
  // --- Auth domain ---
  auth: {
    loginGithub: () => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN_GITHUB),
    logout: () => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGOUT),
    getStatus: () => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH.GET_STATUS)
  },
  // --- Config domain ---
  config: {
    getResources: (type) => electron.ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_RESOURCES, type ? { types: [type] } : void 0),
    getResourceContent: (resourcePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_RESOURCE_CONTENT, { path: resourcePath }),
    getSettings: () => electron.ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_SETTINGS),
    saveSettings: (settings) => electron.ipcRenderer.invoke(IPC_CHANNELS.CONFIG.SAVE_SETTINGS, { settings }),
    getClaudeMd: (scope, projectPath) => electron.ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_CLAUDE_MD, { scope, projectPath }),
    saveClaudeMd: (content, scope, projectPath) => electron.ipcRenderer.invoke(IPC_CHANNELS.CONFIG.SAVE_CLAUDE_MD, { content, scope, projectPath }),
    getMemory: (projectHash) => electron.ipcRenderer.invoke(IPC_CHANNELS.CONFIG.GET_MEMORY, { projectHash }),
    onResourceChange: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.CONFIG.RESOURCE_CHANGE, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.CONFIG.RESOURCE_CHANGE, handler);
    }
  },
  // --- Marketplace domain ---
  marketplace: {
    fetchSources: () => electron.ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.FETCH_SOURCES),
    search: (query, filters) => electron.ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.SEARCH, { query, filters }),
    install: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.INSTALL, params),
    uninstall: (name, type) => electron.ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.UNINSTALL, { name, type }),
    getInstalled: () => electron.ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.GET_INSTALLED),
    checkUpdates: () => electron.ipcRenderer.invoke(IPC_CHANNELS.MARKETPLACE.CHECK_UPDATES),
    onInstallProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, handler);
    },
    onPackagesLoaded: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.MARKETPLACE.PACKAGES_LOADED, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.MARKETPLACE.PACKAGES_LOADED, handler);
    },
    onUpdateAvailable: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.MARKETPLACE.UPDATE_AVAILABLE, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.MARKETPLACE.UPDATE_AVAILABLE, handler);
    }
  },
  // --- Score domain ---
  score: {
    checkScorer: () => electron.ipcRenderer.invoke(IPC_CHANNELS.SCORE.CHECK_SCORER),
    run: (skillDirName, includeAnalytics) => electron.ipcRenderer.invoke(IPC_CHANNELS.SCORE.RUN, { skillDirName, includeAnalytics }),
    getCached: (skillDirName) => electron.ipcRenderer.invoke(IPC_CHANNELS.SCORE.GET_CACHED, { skillDirName }),
    onProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.SCORE.PROGRESS, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.SCORE.PROGRESS, handler);
    },
    onResult: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.SCORE.RESULT, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.SCORE.RESULT, handler);
    }
  },
  // --- Showcase domain ---
  showcase: {
    generate: (skillDirName, template) => electron.ipcRenderer.invoke(IPC_CHANNELS.SHOWCASE.GENERATE, { skillDirName, template }),
    publish: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.SHOWCASE.PUBLISH, params),
    unpublish: (skillDirName) => electron.ipcRenderer.invoke(IPC_CHANNELS.SHOWCASE.UNPUBLISH, { skillDirName }),
    onPublishResult: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.SHOWCASE.PUBLISH_RESULT, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.SHOWCASE.PUBLISH_RESULT, handler);
    }
  },
  // --- Analytics domain ---
  analytics: {
    track: (event, params) => electron.ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.TRACK, { event, params }),
    getSummary: (startDate, endDate) => electron.ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.GET_SUMMARY, { startDate, endDate }),
    clear: () => electron.ipcRenderer.invoke(IPC_CHANNELS.ANALYTICS.CLEAR)
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
