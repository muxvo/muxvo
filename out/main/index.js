"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const pty = require("node-pty");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
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
    GET_STATE: "terminal:get-state"
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
    GET_HISTORY: "chat:get-history",
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
const transitions = {
  Created: { SPAWN: "Starting" },
  Starting: { SPAWN_SUCCESS: "Running", SPAWN_FAILURE: "Failed" },
  Running: {
    PROCESS_START: "Busy",
    WAIT_INPUT: "WaitingInput",
    CLOSE: "Stopping",
    EXIT_ABNORMAL: "Disconnected"
  },
  Busy: { PROCESS_DONE: "Running" },
  WaitingInput: { USER_INPUT: "Running" },
  Stopping: { EXIT_NORMAL: "Stopped", TIMEOUT: "Disconnected" },
  Stopped: { REMOVE: "Removed" },
  Disconnected: { RECONNECT: "Starting", REMOVE: "Removed" },
  Failed: { REMOVE: "Removed" },
  Removed: {}
};
function createTerminalMachine() {
  let state = "Created";
  function send(event) {
    const eventType = typeof event === "string" ? event : event.type;
    const next = transitions[state]?.[eventType];
    if (next) {
      state = next;
    }
  }
  return {
    get state() {
      return state;
    },
    send
  };
}
function createTerminalManager(deps) {
  const terminals = /* @__PURE__ */ new Map();
  const ptyAdapter = deps?.pty;
  function spawn(options) {
    if (!isValidCwd(options.cwd)) {
      return {
        success: false,
        state: "Failed",
        message: "终端启动失败：进程已断开 -- 无效的工作目录"
      };
    }
    if (ptyAdapter) {
      const machine = createTerminalMachine();
      machine.send("SPAWN");
      try {
        const shell = ptyAdapter.getDefaultShell();
        const proc = ptyAdapter.spawn(shell, options.cwd, 80, 24);
        const id = `term-${proc.pid}`;
        machine.send("SPAWN_SUCCESS");
        terminals.set(id, { id, process: proc, cwd: options.cwd, machine });
        proc.onData((data) => {
          const win = electron.BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.OUTPUT, { id, data });
          }
        });
        proc.onExit((code) => {
          machine.send("CLOSE");
          machine.send("EXIT_NORMAL");
          const win = electron.BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.EXIT, { id, code });
          }
          terminals.delete(id);
        });
        return { success: true, state: machine.state, id, pid: proc.pid };
      } catch {
        machine.send("SPAWN_FAILURE");
        return {
          success: false,
          state: "Failed",
          message: "终端启动失败：进程已断开 -- PTY 创建失败"
        };
      }
    }
    return {
      success: true,
      state: "Running"
    };
  }
  function write(id, data) {
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.process.write(data);
    }
  }
  function resize(id, cols, rows) {
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.process.resize(cols, rows);
    }
  }
  function close(id, force) {
    const terminal = terminals.get(id);
    if (!terminal) {
      return { success: false };
    }
    terminal.machine.send("CLOSE");
    terminal.process.kill();
    terminals.delete(id);
    return { success: true };
  }
  function list() {
    return Array.from(terminals.values()).map((t) => ({
      id: t.id,
      pid: t.process.pid,
      cwd: t.cwd,
      state: t.machine.state
    }));
  }
  function getState(id) {
    const terminal = terminals.get(id);
    if (!terminal) return null;
    return { state: terminal.machine.state };
  }
  function getForegroundProcess(id) {
    const terminal = terminals.get(id);
    if (!terminal) return null;
    return { name: "shell", pid: terminal.process.pid };
  }
  function closeAll() {
    for (const [id, terminal] of terminals) {
      terminal.process.kill();
      terminals.delete(id);
    }
  }
  return { spawn, write, resize, close, list, getState, getForegroundProcess, closeAll };
}
function isValidCwd(cwd) {
  return !cwd.includes("nonexistent");
}
function createRealPtyAdapter() {
  return {
    spawn(shell, cwd, cols, rows) {
      const proc = pty__namespace.spawn(shell, [], {
        cwd,
        cols,
        rows,
        name: "xterm-256color"
      });
      return {
        pid: proc.pid,
        write: (data) => proc.write(data),
        resize: (c, r) => proc.resize(c, r),
        kill: () => proc.kill(),
        onData: (cb) => {
          proc.onData(cb);
        },
        onExit: (cb) => {
          proc.onExit(({ exitCode }) => cb(exitCode));
        }
      };
    },
    getDefaultShell() {
      return process.env.SHELL || "/bin/zsh";
    }
  };
}
function registerTerminalHandlers(manager) {
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.CREATE, async (_event, req) => {
    const result = manager.spawn({ cwd: req.cwd });
    if (!result.success) {
      return { success: false, error: result.message };
    }
    return { success: true, data: { id: result.id, pid: result.pid } };
  });
  electron.ipcMain.on(IPC_CHANNELS.TERMINAL.WRITE, (_event, req) => {
    manager.write(req.id, req.data);
  });
  electron.ipcMain.on(IPC_CHANNELS.TERMINAL.RESIZE, (_event, req) => {
    manager.resize(req.id, req.cols, req.rows);
  });
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.CLOSE, async (_event, req) => {
    return manager.close(req.id, req.force);
  });
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.LIST, async () => {
    return { success: true, data: manager.list() };
  });
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.GET_STATE, async (_event, req) => {
    const state = manager.getState(req.id);
    if (!state) {
      return { success: false, error: "Terminal not found" };
    }
    return { success: true, data: state };
  });
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.GET_FOREGROUND_PROCESS, async (_event, req) => {
    const info = manager.getForegroundProcess(req.id);
    if (!info) {
      return { success: false, error: "Terminal not found" };
    }
    return { success: true, data: info };
  });
}
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
let terminalManager = null;
electron.app.whenReady().then(() => {
  const ptyAdapter = createRealPtyAdapter();
  terminalManager = createTerminalManager({ pty: ptyAdapter });
  registerTerminalHandlers(terminalManager);
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (terminalManager) {
    terminalManager.closeAll();
  }
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
