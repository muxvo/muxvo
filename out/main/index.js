"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const child_process = require("child_process");
const pty = require("node-pty");
const fs = require("fs");
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
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
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
function getForegroundProcessName(pid) {
  try {
    const name = child_process.execSync(`ps -p ${pid} -o comm=`, { encoding: "utf-8" }).trim();
    return name || null;
  } catch {
    return null;
  }
}
const PROMPT_PATTERNS = [
  // inquirer/prompts style: "? Select an option:"
  /^\s*\?\s+.+[:：]\s*$/m,
  // yes/no confirmation: "(y/n)", "(Y/n)", "[y/N]"
  /\([yYnN]\/[yYnN]\)/,
  /\[[yYnN]\/[yYnN]\]/,
  // Numbered option lists: "  1) option" or "  1. option"
  /^\s*\d+[).]\s+\S/m,
  // "Press any key", "Enter to continue"
  /press\s+(any\s+)?key/i,
  /enter\s+to\s+continue/i,
  // Claude Code / AI CLI prompts
  /Do you want to proceed/i,
  /Would you like to/i
];
const EXCLUDE_PATTERNS = [
  /^\s*\d+[%％]/,
  // Progress bar: "50%"
  /\[\d+\/\d+\]/,
  // Progress: "[3/10]"
  /^(INFO|WARN|ERROR|DEBUG)/i
  // Log lines
];
function detectWaitingInput(output) {
  for (const exclude of EXCLUDE_PATTERNS) {
    if (exclude.test(output)) return false;
  }
  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(output)) return true;
  }
  return false;
}
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
const MAX_TERMINALS = 20;
const GRACEFUL_CLOSE_TIMEOUT = 5e3;
function createTerminalManager(deps) {
  const terminals = /* @__PURE__ */ new Map();
  const ptyAdapter = deps?.pty;
  function pushStateChange(id, state, processName) {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send(IPC_CHANNELS.TERMINAL.STATE_CHANGE, { id, state, processName });
    }
  }
  function spawn(options) {
    if (!isValidCwd(options.cwd)) {
      return {
        success: false,
        state: "Failed",
        message: "终端启动失败：进程已断开 -- 无效的工作目录"
      };
    }
    if (terminals.size >= MAX_TERMINALS) {
      return {
        success: false,
        state: "Failed",
        message: "最多支持 20 个终端"
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
        pushStateChange(id, machine.state);
        proc.onData((data) => {
          const win = electron.BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.OUTPUT, { id, data });
          }
          if (machine.state === "Running" && detectWaitingInput(data)) {
            machine.send("WAIT_INPUT");
            pushStateChange(id, machine.state);
          }
        });
        proc.onExit((code) => {
          machine.send("CLOSE");
          machine.send("EXIT_NORMAL");
          const win = electron.BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.EXIT, { id, code });
          }
          pushStateChange(id, machine.state);
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
      if (terminal.machine.state === "WaitingInput") {
        terminal.machine.send("USER_INPUT");
        pushStateChange(id, terminal.machine.state);
      }
      terminal.process.write(data);
    }
  }
  function resize(id, cols, rows) {
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.process.resize(cols, rows);
    }
  }
  async function close(id, force) {
    const terminal = terminals.get(id);
    if (!terminal) {
      return { success: false };
    }
    if (force) {
      terminal.machine.send("CLOSE");
      pushStateChange(id, terminal.machine.state);
      terminal.process.kill();
      terminals.delete(id);
      return { success: true };
    }
    terminal.machine.send("CLOSE");
    pushStateChange(id, terminal.machine.state);
    terminal.process.write("");
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        terminal.process.kill();
        terminals.delete(id);
        resolve({ success: true });
      }, GRACEFUL_CLOSE_TIMEOUT);
      terminal.process.onExit(() => {
        clearTimeout(timeout);
        terminals.delete(id);
        resolve({ success: true });
      });
    });
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
    const name = getForegroundProcessName(terminal.process.pid);
    return { name: name ?? "shell", pid: terminal.process.pid };
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
      const env = { ...process.env };
      delete env.CLAUDECODE;
      const proc = pty__namespace.spawn(shell, [], {
        cwd,
        cols,
        rows,
        name: "xterm-256color",
        env
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
function registerTerminalHandlers(manager, onTerminalChange) {
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.CREATE, async (_event, req) => {
    const result = manager.spawn({ cwd: req.cwd });
    if (!result.success) {
      return { success: false, error: result.message };
    }
    onTerminalChange?.();
    return { success: true, data: { id: result.id, pid: result.pid } };
  });
  electron.ipcMain.on(IPC_CHANNELS.TERMINAL.WRITE, (_event, req) => {
    manager.write(req.id, req.data);
  });
  electron.ipcMain.on(IPC_CHANNELS.TERMINAL.RESIZE, (_event, req) => {
    manager.resize(req.id, req.cols, req.rows);
  });
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.CLOSE, async (_event, req) => {
    const result = manager.close(req.id, req.force);
    onTerminalChange?.();
    return result;
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
const DEFAULT_CONFIG = {
  window: { width: 1400, height: 900, x: 100, y: 100 },
  openTerminals: [],
  gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
  theme: "dark",
  fontSize: 14,
  ftvLeftWidth: 250,
  ftvRightWidth: 300
};
let _configDir = null;
function initConfigDir(dir) {
  _configDir = dir;
}
function getConfigPath(configDir) {
  const dir = configDir ?? _configDir;
  if (!dir) return null;
  return path__namespace.join(dir, "config.json");
}
function getTmpPath(configDir) {
  const dir = configDir ?? _configDir;
  if (!dir) return null;
  return path__namespace.join(dir, ".config.json.tmp");
}
function createConfigManager(deps) {
  const fsAdapter = fs__namespace;
  const configDir = _configDir;
  function loadConfig() {
    const configPath = getConfigPath(configDir);
    if (!configPath) return { ...DEFAULT_CONFIG };
    try {
      if (!fsAdapter.existsSync(configPath)) {
        return { ...DEFAULT_CONFIG };
      }
      const raw = fsAdapter.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  function saveConfig(config) {
    const configPath = getConfigPath(configDir);
    const tmpPath = getTmpPath(configDir);
    if (!configPath || !tmpPath || !configDir) {
      return { success: true };
    }
    try {
      if (!fsAdapter.existsSync(configDir)) {
        fsAdapter.mkdirSync(configDir, { recursive: true });
      }
      const fullConfig = { ...DEFAULT_CONFIG, ...config };
      const data = JSON.stringify(fullConfig, null, 2);
      fsAdapter.writeFileSync(tmpPath, data, "utf-8");
      fsAdapter.renameSync(tmpPath, configPath);
      return { success: true };
    } catch {
      try {
        if (fsAdapter.existsSync(tmpPath)) {
          fsAdapter.unlinkSync(tmpPath);
        }
      } catch {
      }
      return { success: true };
    }
  }
  return { loadConfig, saveConfig };
}
let mainWindow = null;
let lastBounds = null;
function createWindow(windowConfig) {
  const opts = {
    width: windowConfig?.width ?? 1280,
    height: windowConfig?.height ?? 800,
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
  };
  if (windowConfig?.x !== void 0 && windowConfig?.y !== void 0) {
    opts.x = windowConfig.x;
    opts.y = windowConfig.y;
  }
  mainWindow = new electron.BrowserWindow(opts);
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      lastBounds = mainWindow.getBounds();
    }
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
  initConfigDir(electron.app.getPath("userData"));
  const configManager = createConfigManager();
  const savedConfig = configManager.loadConfig();
  const ptyAdapter = createRealPtyAdapter();
  terminalManager = createTerminalManager({ pty: ptyAdapter });
  registerTerminalHandlers(terminalManager, () => {
    saveTerminalConfig(configManager);
  });
  electron.ipcMain.handle(IPC_CHANNELS.APP.GET_CONFIG, async () => {
    return { success: true, data: configManager.loadConfig() };
  });
  electron.ipcMain.handle(IPC_CHANNELS.APP.SAVE_CONFIG, async (_event, config) => {
    const result = configManager.saveConfig(config);
    return { success: true, data: result };
  });
  createWindow(savedConfig.window);
  if (savedConfig.openTerminals && savedConfig.openTerminals.length > 0 && mainWindow) {
    const terminalsToRestore = savedConfig.openTerminals;
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (!terminalManager) return;
        for (const terminal of terminalsToRestore) {
          terminalManager.spawn({ cwd: terminal.cwd });
        }
        const win = electron.BrowserWindow.getAllWindows()[0];
        if (win) {
          const list = terminalManager.list();
          win.webContents.send("terminal:list-updated", list.map((t) => ({
            id: t.id,
            state: t.state
          })));
        }
      }, 500);
    });
  }
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
function saveTerminalConfig(configManager) {
  if (!terminalManager) return;
  const terminals = terminalManager.list();
  configManager.saveConfig({
    openTerminals: terminals.map((t) => ({ cwd: t.cwd }))
  });
}
function saveCurrentConfig() {
  if (!terminalManager) return;
  const configManager = createConfigManager();
  const terminals = terminalManager.list();
  const config = {
    openTerminals: terminals.map((t) => ({ cwd: t.cwd }))
  };
  if (lastBounds) {
    config.window = {
      width: lastBounds.width,
      height: lastBounds.height,
      x: lastBounds.x,
      y: lastBounds.y
    };
  }
  configManager.saveConfig(config);
}
electron.app.on("window-all-closed", () => {
  saveCurrentConfig();
  if (terminalManager) {
    terminalManager.closeAll();
  }
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
