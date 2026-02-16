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
    UPDATE_CWD: "terminal:update-cwd"
  },
  FS: {
    SELECT_DIRECTORY: "fs:select-directory"
  },
  APP: {
    GET_CONFIG: "app:get-config",
    SAVE_CONFIG: "app:save-config",
    GET_PREFERENCES: "app:get-preferences",
    SAVE_PREFERENCES: "app:save-preferences",
    MEMORY_WARNING: "app:memory-warning",
    DETECT_CLI_TOOLS: "app:detect-cli-tools"
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
      electron.ipcRenderer.on("terminal:list-updated", handler);
      return () => electron.ipcRenderer.removeListener("terminal:list-updated", handler);
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
    selectDirectory: () => electron.ipcRenderer.invoke(IPC_CHANNELS.FS.SELECT_DIRECTORY)
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
