"use strict";
const electron = require("electron");
const path = require("path");
const url = require("url");
const utils = require("@electron-toolkit/utils");
const child_process = require("child_process");
const pty = require("node-pty");
const os = require("os");
const fs = require("fs");
const readline = require("readline");
const promises = require("fs/promises");
const electronUpdater = require("electron-updater");
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
    GET_STATE: "terminal:get-state",
    GET_BUFFER: "terminal:get-buffer",
    UPDATE_CWD: "terminal:update-cwd",
    CWD_CHANGED: "terminal:cwd-changed",
    LIST_UPDATED: "terminal:list-updated",
    ZOOM: "terminal:zoom"
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
    EXPORT: "chat:export",
    GET_ARCHIVE_ENABLED: "chat:get-archive-enabled",
    SET_ARCHIVE_ENABLED: "chat:set-archive-enabled",
    ARCHIVE_PROGRESS: "chat:archive-progress",
    SHOW_SESSION_MENU: "chat:show-session-menu",
    DELETE_SESSION: "chat:delete-session",
    REVEAL_FILE: "chat:reveal-file",
    SET_SESSION_NAME: "chat:set-session-name"
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
    DETECT_CLI_TOOLS: "app:detect-cli-tools",
    UPDATE_CHECKING: "app:update-checking",
    UPDATE_AVAILABLE: "app:update-available",
    UPDATE_NOT_AVAILABLE: "app:update-not-available",
    UPDATE_DOWNLOADING: "app:update-downloading",
    UPDATE_DOWNLOADED: "app:update-downloaded",
    UPDATE_ERROR: "app:update-error",
    INSTALL_UPDATE: "app:install-update"
  },
  DISCOVERY: {
    FETCH: "discovery:fetch",
    GET_DETAIL: "discovery:get-detail",
    SEARCH: "discovery:search",
    INSTALL: "discovery:install",
    UNINSTALL: "discovery:uninstall",
    GET_INSTALLED: "discovery:get-installed",
    PUBLISH: "discovery:publish",
    UNPUBLISH: "discovery:unpublish",
    INSTALL_PROGRESS: "discovery:install-progress",
    PUBLISH_PROGRESS: "discovery:publish-progress",
    PACKAGES_LOADED: "discovery:packages-loaded"
  },
  AUTH: {
    LOGIN_GITHUB: "auth:login-github",
    LOGOUT: "auth:logout",
    GET_STATUS: "auth:get-status",
    LOGIN_GOOGLE: "auth:login-google",
    SEND_EMAIL_CODE: "auth:send-email-code",
    VERIFY_EMAIL_CODE: "auth:verify-email-code",
    OAUTH_CALLBACK: "auth:oauth-callback",
    REFRESH_TOKEN: "auth:refresh-token",
    GET_PROFILE: "auth:get-profile",
    SESSION_EXPIRED: "auth:session-expired",
    STATUS_CHANGE: "auth:status-change"
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
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*[\x07]|\x1b\].*?\x1b\\|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]/g;
function stripAnsi(str) {
  const noAnsi = str.replace(ANSI_RE, "");
  return noAnsi.replace(/\r\n/g, "\n").replace(/[^\n]*\r/g, "");
}
const ESC_CANCEL_PATTERN = /Esc\s*to\s*cancel/;
const QUESTION_LINE_PATTERN = /\?\s*$/m;
const NUMBERED_OPTION_PATTERN = /❯\s*\d+\./;
const GENERIC_PATTERNS = [
  // inquirer/prompts style: "? Select an option:"
  /^\s*\?\s+.+[:：]\s*$/m,
  // yes/no confirmation: "(y/n)", "(Y/n)", "[y/N]"
  /\([yYnN]\/[yYnN]\)/,
  /\[[yYnN]\/[yYnN]\]/,
  // "Press any key", "Enter to continue"
  /press\s*(any\s*)?key/i,
  /enter\s*to\s*continue/i
];
const EXCLUDE_PATTERNS = [
  /^\s*\d+[%％]/,
  // Progress bar: "50%"
  /\[\d+\/\d+\]/,
  // Progress: "[3/10]"
  /^(INFO|WARN|ERROR|DEBUG)/i
  // Log lines
];
const buffers = /* @__PURE__ */ new Map();
const ROLLING_MAX = 2e3;
function detectWaitingInput(output, terminalId) {
  const key = terminalId ?? "__default__";
  const prev = buffers.get(key) ?? "";
  let updated = prev + output;
  if (updated.length > ROLLING_MAX) {
    updated = updated.slice(updated.length - ROLLING_MAX);
  }
  buffers.set(key, updated);
  const clean = stripAnsi(updated);
  for (const exclude of EXCLUDE_PATTERNS) {
    if (exclude.test(clean)) {
      return false;
    }
  }
  let matched = false;
  if (ESC_CANCEL_PATTERN.test(clean)) {
    matched = true;
  }
  if (!matched && QUESTION_LINE_PATTERN.test(clean) && NUMBERED_OPTION_PATTERN.test(clean)) {
    matched = true;
  }
  if (!matched) {
    for (const pattern of GENERIC_PATTERNS) {
      if (pattern.test(clean)) {
        matched = true;
        break;
      }
    }
  }
  if (matched) {
    buffers.delete(key);
    return true;
  }
  return false;
}
function resetInputDetector(terminalId) {
  if (terminalId) {
    buffers.delete(terminalId);
  } else {
    buffers.clear();
  }
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
  const OUTPUT_BUFFER_MAX_BYTES = 64 * 1024;
  const outputBuffers = /* @__PURE__ */ new Map();
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
          const existing = outputBuffers.get(id) ?? "";
          const updated = existing + data;
          outputBuffers.set(id, updated.length > OUTPUT_BUFFER_MAX_BYTES ? updated.slice(updated.length - OUTPUT_BUFFER_MAX_BYTES) : updated);
          console.log(`[MUXVO:restore] buffer append id=${id} bytes=${data.length} total=${outputBuffers.get(id).length}`);
          const win = electron.BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.OUTPUT, { id, data });
          }
          const osc7Match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
          if (osc7Match) {
            const newCwd = decodeURIComponent(osc7Match[1]);
            const terminal = terminals.get(id);
            if (terminal && terminal.cwd !== newCwd) {
              terminal.cwd = newCwd;
              const cwdWin = electron.BrowserWindow.getAllWindows()[0];
              if (cwdWin && !cwdWin.isDestroyed()) {
                cwdWin.webContents.send(IPC_CHANNELS.TERMINAL.CWD_CHANGED, { id, cwd: newCwd });
              }
            }
          }
          const isRunning = machine.state === "Running";
          const detected = detectWaitingInput(data, id);
          console.log(`[MUXVO:waitinput] state=${machine.state} detected=${detected} chunkLen=${data.length}`);
          if (isRunning && detected) {
            machine.send("WAIT_INPUT");
            console.log(`[MUXVO:waitinput] >>> TRANSITION to WaitingInput! id=${id}`);
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
          outputBuffers.delete(id);
          resetInputDetector(id);
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
        resetInputDetector(id);
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
      outputBuffers.delete(id);
      resetInputDetector(id);
      return { success: true };
    }
    terminal.machine.send("CLOSE");
    pushStateChange(id, terminal.machine.state);
    terminal.process.write("");
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        terminal.process.kill();
        terminals.delete(id);
        outputBuffers.delete(id);
        resetInputDetector(id);
        resolve({ success: true });
      }, GRACEFUL_CLOSE_TIMEOUT);
      terminal.process.onExit(() => {
        clearTimeout(timeout);
        terminals.delete(id);
        outputBuffers.delete(id);
        resetInputDetector(id);
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
      outputBuffers.delete(id);
      resetInputDetector(id);
    }
  }
  function getBuffer(id) {
    console.log(`[MUXVO:restore] getBuffer id=${id} bytes=${(outputBuffers.get(id) ?? "").length}`);
    return outputBuffers.get(id) ?? "";
  }
  function updateCwd(id, newCwd) {
    const terminal = terminals.get(id);
    if (!terminal) return false;
    terminal.cwd = newCwd;
    return true;
  }
  return { spawn, write, resize, close, list, getState, getForegroundProcess, closeAll, getBuffer, updateCwd };
}
function isValidCwd(cwd) {
  return !cwd.includes("nonexistent");
}
function createRealPtyAdapter() {
  return {
    spawn(shell, cwd, cols, rows) {
      const env = { ...process.env };
      delete env.CLAUDECODE;
      if (process.platform === "darwin" && !env.TERM_PROGRAM) {
        env.TERM_PROGRAM = "Apple_Terminal";
      }
      if (process.platform === "darwin" && (!env.LANG || env.LANG === "C" || env.LANG === "POSIX")) {
        env.LANG = "en_US.UTF-8";
      }
      const proc = pty__namespace.spawn(shell, ["--login"], {
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
    const result = await manager.close(req.id, req.force);
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
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.GET_BUFFER, async (_event, req) => {
    const data = manager.getBuffer(req.id);
    return { success: true, data };
  });
  electron.ipcMain.handle(IPC_CHANNELS.TERMINAL.UPDATE_CWD, async (_event, req) => {
    const ok = manager.updateCwd(req.id, req.cwd);
    onTerminalChange?.();
    if (ok) {
      const win = electron.BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TERMINAL.CWD_CHANGED, { id: req.id, cwd: req.cwd });
      }
    }
    return { success: ok };
  });
}
function createChatProjectReader(opts) {
  const projectsDir = path.join(opts.ccBasePath, "projects");
  const archiveProjectsDir = opts.archivePath || null;
  const CACHE_TTL = 5 * 60 * 1e3;
  const projectsCache = { data: null, expiry: 0 };
  const summaryCache = /* @__PURE__ */ new Map();
  function clearProjectsCache() {
    projectsCache.data = null;
    projectsCache.expiry = 0;
  }
  function clearSummaryCache(projectHash) {
    if (projectHash) {
      for (const [key] of summaryCache) {
        if (key.startsWith(projectHash + "/")) {
          summaryCache.delete(key);
        }
      }
    } else {
      summaryCache.clear();
    }
  }
  async function readFirstLines(filePath, maxLines) {
    return new Promise((resolve) => {
      const lines = [];
      const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on("line", (line) => {
        lines.push(line);
        if (lines.length >= maxLines) {
          rl.close();
          stream.destroy();
        }
      });
      rl.on("close", () => resolve(lines));
      stream.on("error", () => resolve(lines));
    });
  }
  async function extractSessionSummary(projectHash, filePath, fileName) {
    const sessionId = fileName.replace(/\.jsonl$/, "");
    const stat = await fs.promises.stat(filePath);
    const lastModified = stat.mtimeMs;
    let title = "";
    let startedAt = "";
    try {
      const lines = await readFirstLines(filePath, 20);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === "user") {
            let rawContent = "";
            const msgContent = obj.message?.content ?? obj.content;
            if (typeof msgContent === "string") {
              rawContent = msgContent;
            } else if (Array.isArray(msgContent)) {
              rawContent = msgContent.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
            }
            if (!startedAt) startedAt = obj.timestamp || "";
            const trimmedContent = rawContent.trim();
            if (trimmedContent && !trimmedContent.startsWith("<command-message>") && !trimmedContent.startsWith("<local-command-caveat>") && !trimmedContent.startsWith("<teammate-message") && !trimmedContent.startsWith("<system-reminder>")) {
              title = trimmedContent.slice(0, 100);
              break;
            }
          }
        } catch {
        }
      }
    } catch {
    }
    return {
      sessionId,
      projectHash,
      title,
      startedAt,
      lastModified,
      fileSize: stat.size,
      source: "claude-code"
    };
  }
  const PROTOCOL_TYPES = /* @__PURE__ */ new Set(["idle_notification", "teammate_terminated", "shutdown_approved", "shutdown_rejected"]);
  function isProtocolJson(text) {
    const trimmed = text.trim();
    if (!trimmed) return true;
    return trimmed.split("\n").every((line) => {
      const l = line.trim();
      if (!l) return true;
      try {
        return PROTOCOL_TYPES.has(JSON.parse(l).type);
      } catch {
        return false;
      }
    });
  }
  function splitTeammateMessages(content, base) {
    const blockRe = /<teammate-message[^>]*>[\s\S]*?<\/teammate-message>/g;
    const blocks = content.match(blockRe);
    if (!blocks || blocks.length === 0) return [];
    const results = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const inner = block.replace(/<teammate-message[^>]*>\n?/, "").replace(/<\/teammate-message>\s*$/, "").trim();
      if (isProtocolJson(inner)) continue;
      results.push({
        uuid: `${base.uuid}-tm${i}`,
        type: "system",
        sessionId: base.sessionId,
        cwd: base.cwd,
        gitBranch: base.gitBranch,
        timestamp: base.timestamp,
        content: block
        // keep full <teammate-message> tag for renderer to extract name
      });
    }
    return results;
  }
  function parseMessageLine(line, sessionId) {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const entry = JSON.parse(trimmed);
      const type = entry.type;
      if (type !== "user" && type !== "assistant" && type !== "queue-operation") return [];
      let normalizedContent;
      if (type === "queue-operation") {
        normalizedContent = typeof entry.content === "string" ? entry.content : "";
      } else if (type === "user") {
        const msgContent = entry.message?.content;
        if (typeof msgContent === "string") {
          normalizedContent = msgContent;
        } else if (Array.isArray(msgContent)) {
          const blocks = msgContent;
          const hasOnlyToolResults = blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
          if (hasOnlyToolResults) return [];
          const hasImages = blocks.some((b) => b.type === "image");
          if (hasImages) {
            normalizedContent = blocks.filter((b) => b.type === "text" || b.type === "image").map((b) => {
              if (b.type === "image") {
                return { type: "image", source: b.source };
              }
              return { type: "text", text: b.text };
            });
          } else {
            const textParts = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text);
            normalizedContent = textParts.join("\n") || "";
          }
        } else if (typeof entry.content === "string") {
          normalizedContent = entry.content;
        } else {
          normalizedContent = "";
        }
      } else {
        const msgContent = entry.message?.content;
        if (Array.isArray(msgContent)) {
          normalizedContent = msgContent;
        } else if (Array.isArray(entry.content)) {
          normalizedContent = entry.content;
        } else if (typeof msgContent === "string") {
          normalizedContent = msgContent;
        } else if (typeof entry.content === "string") {
          normalizedContent = entry.content;
        } else {
          normalizedContent = "";
        }
      }
      let resolvedType = type;
      if (type === "queue-operation") {
        resolvedType = "system";
      } else if (type === "user") {
        if (entry.isCompactSummary === true) {
          resolvedType = "system";
        } else if (entry.isMeta === true) {
          resolvedType = "system";
        } else {
          const contentStr = typeof normalizedContent === "string" ? normalizedContent : "";
          const trimmedContent = contentStr.trimStart();
          if (trimmedContent.startsWith("<system-reminder>") || trimmedContent.startsWith("<task-notification>") || trimmedContent.startsWith("<command-message>") || trimmedContent.startsWith("<command-name>")) {
            resolvedType = "system";
          } else if (trimmedContent.startsWith("<teammate-message")) {
            const baseFields = {
              uuid: entry.uuid || "",
              sessionId: entry.sessionId || sessionId,
              cwd: entry.cwd || "",
              gitBranch: entry.gitBranch,
              timestamp: entry.timestamp || ""
            };
            return splitTeammateMessages(trimmedContent, baseFields);
          }
        }
      }
      return [{
        uuid: entry.uuid || "",
        type: resolvedType,
        sessionId: entry.sessionId || sessionId,
        cwd: entry.cwd || "",
        gitBranch: entry.gitBranch,
        timestamp: entry.timestamp || "",
        content: normalizedContent
      }];
    } catch {
      return [];
    }
  }
  async function scanProjectsFromDir(baseDir) {
    try {
      const dirs = await fs.promises.readdir(baseDir, { withFileTypes: true });
      const projectDirs = dirs.filter((d) => d.isDirectory());
      const projectResults = await Promise.all(
        projectDirs.map(async (dir) => {
          const projectHash = dir.name;
          const projectPath = path.join(baseDir, projectHash);
          try {
            const [files, dirStat] = await Promise.all([
              fs.promises.readdir(projectPath),
              fs.promises.stat(projectPath)
            ]);
            const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
            if (jsonlFiles.length === 0) return null;
            const fileStats = await Promise.all(
              jsonlFiles.map((f) => fs.promises.stat(path.join(projectPath, f)).catch(() => null))
            );
            const totalSize = fileStats.reduce((sum, s) => sum + (s?.size || 0), 0);
            const segments = projectHash.split("-").filter((s) => s.length > 0);
            const displayName = segments.length > 0 ? segments[segments.length - 1] : projectHash;
            return {
              projectHash,
              displayPath: "",
              displayName,
              sessionCount: jsonlFiles.length,
              totalSize,
              lastActivity: dirStat.mtimeMs,
              source: "claude-code"
            };
          } catch {
            return null;
          }
        })
      );
      return projectResults.filter((p) => p !== null);
    } catch {
      return [];
    }
  }
  async function scanSessionFilesFromDir(projectPath) {
    try {
      const files = await fs.promises.readdir(projectPath);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      const fileStats = await Promise.all(
        jsonlFiles.map(async (f) => {
          try {
            const stat = await fs.promises.stat(path.join(projectPath, f));
            return { fileName: f, mtime: stat.mtimeMs };
          } catch {
            return null;
          }
        })
      );
      return fileStats.filter((s) => s !== null);
    } catch {
      return [];
    }
  }
  return {
    /**
     * Scan all projects under ~/.claude/projects/ and archive.
     * Uses directory stat for lastActivity (avoids stating every file).
     */
    async getProjects() {
      if (projectsCache.data && Date.now() < projectsCache.expiry) {
        return projectsCache.data;
      }
      const ccProjects = await scanProjectsFromDir(projectsDir);
      if (archiveProjectsDir) {
        const archiveProjects = await scanProjectsFromDir(archiveProjectsDir);
        const ccHashSet = new Set(ccProjects.map((p) => p.projectHash));
        for (const ap of archiveProjects) {
          if (ccHashSet.has(ap.projectHash)) {
            const existing = ccProjects.find((p) => p.projectHash === ap.projectHash);
            existing.sessionCount = Math.max(existing.sessionCount, ap.sessionCount);
          } else {
            ccProjects.push(ap);
          }
        }
      }
      ccProjects.sort((a, b) => b.lastActivity - a.lastActivity);
      projectsCache.data = ccProjects;
      projectsCache.expiry = Date.now() + CACHE_TTL;
      return ccProjects;
    },
    /**
     * List sessions for a specific project.
     * Stats files first, sorts by mtime, then only extracts summaries for top N.
     * Merges CC and archive sources (CC takes priority for duplicate sessions).
     */
    async getSessionsForProject(projectHash, limit = 50) {
      const ccProjectPath = path.join(projectsDir, projectHash);
      const ccStats = await scanSessionFilesFromDir(ccProjectPath);
      const ccFileNames = new Set(ccStats.map((s) => s.fileName));
      let allStats = [...ccStats];
      if (archiveProjectsDir) {
        const archiveProjectPath = path.join(archiveProjectsDir, projectHash);
        const archiveStats = await scanSessionFilesFromDir(archiveProjectPath);
        for (const archiveStat of archiveStats) {
          if (!ccFileNames.has(archiveStat.fileName)) {
            allStats.push(archiveStat);
          }
        }
      }
      allStats.sort((a, b) => b.mtime - a.mtime);
      const topFiles = allStats.slice(0, limit);
      const results = await Promise.all(
        topFiles.map(async (file) => {
          const cacheKey = projectHash + "/" + file.fileName;
          const cached = summaryCache.get(cacheKey);
          if (cached && Date.now() < cached.expiry) {
            return cached.data.title ? cached.data : null;
          }
          const filePath = ccFileNames.has(file.fileName) ? path.join(ccProjectPath, file.fileName) : path.join(archiveProjectsDir, projectHash, file.fileName);
          try {
            const summary = await extractSessionSummary(projectHash, filePath, file.fileName);
            summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
            return summary.title ? summary : null;
          } catch {
            return null;
          }
        })
      );
      return results.filter((s) => s !== null);
    },
    /**
     * Get recent sessions across all projects.
     * Scans both CC and archive sources, merging results.
     */
    async getAllRecentSessions(limit) {
      async function collectFilesFromBase(baseDir) {
        const collected = [];
        try {
          const dirs = await fs.promises.readdir(baseDir, { withFileTypes: true });
          const projectDirs = dirs.filter((d) => d.isDirectory());
          const dirStats = await Promise.all(
            projectDirs.map(async (dir) => {
              try {
                const projectPath = path.join(baseDir, dir.name);
                const stat = await fs.promises.stat(projectPath);
                return { projectHash: dir.name, projectPath, mtime: stat.mtimeMs };
              } catch {
                return null;
              }
            })
          );
          const validDirs = dirStats.filter((d) => d !== null);
          validDirs.sort((a, b) => b.mtime - a.mtime);
          const maxProjectsToScan = Math.min(validDirs.length, Math.max(10, Math.ceil(limit / 5)));
          const topProjects = validDirs.slice(0, maxProjectsToScan);
          await Promise.all(
            topProjects.map(async (proj) => {
              try {
                const files = await fs.promises.readdir(proj.projectPath);
                const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
                const fileStats = await Promise.all(
                  jsonlFiles.map(async (f) => {
                    try {
                      const filePath = path.join(proj.projectPath, f);
                      const stat = await fs.promises.stat(filePath);
                      return { projectHash: proj.projectHash, fileName: f, filePath, mtime: stat.mtimeMs };
                    } catch {
                      return null;
                    }
                  })
                );
                for (const fs2 of fileStats) {
                  if (fs2) collected.push(fs2);
                }
              } catch {
              }
            })
          );
        } catch {
        }
        return collected;
      }
      const ccFiles = await collectFilesFromBase(projectsDir);
      if (archiveProjectsDir) {
        const archiveFiles = await collectFilesFromBase(archiveProjectsDir);
        const ccKeySet = new Set(ccFiles.map((f) => f.projectHash + "/" + f.fileName));
        for (const af of archiveFiles) {
          if (!ccKeySet.has(af.projectHash + "/" + af.fileName)) {
            ccFiles.push(af);
          }
        }
      }
      ccFiles.sort((a, b) => b.mtime - a.mtime);
      const topFiles = ccFiles.slice(0, limit);
      const results = await Promise.all(
        topFiles.map(async (file) => {
          const cacheKey = file.projectHash + "/" + file.fileName;
          const cached = summaryCache.get(cacheKey);
          if (cached && Date.now() < cached.expiry) {
            return cached.data.title ? cached.data : null;
          }
          try {
            const summary = await extractSessionSummary(file.projectHash, file.filePath, file.fileName);
            summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
            return summary.title ? summary : null;
          } catch {
            return null;
          }
        })
      );
      return results.filter((s) => s !== null);
    },
    /**
     * Read and normalize messages from a session file.
     * When limit is set, reads only the tail of large files for speed.
     * Falls back to archive source if CC source doesn't have the file.
     */
    async readSession(projectHash, sessionId, options) {
      const ccFilePath = path.join(projectsDir, projectHash, `${sessionId}.jsonl`);
      const limit = options?.limit;
      let filePath = ccFilePath;
      let resolvedStat = await fs.promises.stat(ccFilePath).catch(() => null);
      if (!resolvedStat) {
        if (archiveProjectsDir) {
          const archiveFilePath = path.join(archiveProjectsDir, projectHash, `${sessionId}.jsonl`);
          resolvedStat = await fs.promises.stat(archiveFilePath).catch(() => null);
          if (resolvedStat) {
            filePath = archiveFilePath;
          } else {
            return [];
          }
        } else {
          return [];
        }
      }
      try {
        const stat = resolvedStat;
        const TAIL_BYTES = 2 * 1024 * 1024;
        const readFromTail = limit && stat.size > TAIL_BYTES;
        const startPos = readFromTail ? stat.size - TAIL_BYTES : 0;
        const messages = [];
        let skipFirstLine = readFromTail;
        await new Promise((resolve) => {
          const stream = fs.createReadStream(filePath, {
            encoding: "utf-8",
            start: startPos
          });
          stream.on("error", () => resolve());
          const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
          rl.on("line", (line) => {
            if (skipFirstLine) {
              skipFirstLine = false;
              return;
            }
            const msgs = parseMessageLine(line, sessionId);
            if (msgs.length > 0) messages.push(...msgs);
          });
          rl.on("close", () => resolve());
        });
        if (limit && messages.length > limit) {
          return messages.slice(-limit);
        }
        return messages;
      } catch {
        return [];
      }
    },
    /**
     * Search across all sessions for a query string.
     * Searches both CC and archive sources.
     */
    async search(query) {
      function extractSearchableText(obj) {
        const mc = obj.message?.content ?? obj.content;
        if (typeof mc === "string") return mc;
        if (Array.isArray(mc)) {
          return mc.map((block) => {
            if (block.type === "text" && typeof block.text === "string") return block.text;
            return "";
          }).filter(Boolean).join("\n");
        }
        return "";
      }
      const results = [];
      const q = query.toLowerCase();
      const seenSessions = /* @__PURE__ */ new Set();
      async function searchFile(filePath, projectHash, sessionId) {
        return new Promise((resolve) => {
          let found = false;
          const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
          const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
          stream.on("error", () => resolve());
          rl.on("line", (line) => {
            if (found) return;
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
              const obj = JSON.parse(trimmed);
              if (obj.type !== "user" && obj.type !== "assistant") return;
              const text = extractSearchableText(obj);
              if (text.toLowerCase().includes(q)) {
                const idx = text.toLowerCase().indexOf(q);
                const snippetStart = Math.max(0, idx - 30);
                const snippetEnd = Math.min(text.length, idx + query.length + 170);
                results.push({ projectHash, sessionId, snippet: text.slice(snippetStart, snippetEnd), timestamp: obj.timestamp || "" });
                found = true;
                rl.close();
                stream.destroy();
              }
            } catch {
            }
          });
          rl.on("close", () => resolve());
        });
      }
      async function searchInDir(baseDir) {
        try {
          const dirs = await fs.promises.readdir(baseDir, { withFileTypes: true });
          for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            const projectHash = dir.name;
            const projectPath = path.join(baseDir, projectHash);
            try {
              const files = await fs.promises.readdir(projectPath);
              const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
              const CONCURRENCY = 10;
              for (let i = 0; i < jsonlFiles.length; i += CONCURRENCY) {
                const batch = jsonlFiles.slice(i, i + CONCURRENCY);
                await Promise.all(batch.map(async (f) => {
                  const sessionId = f.replace(/\.jsonl$/, "");
                  const sessionKey = projectHash + "/" + sessionId;
                  if (seenSessions.has(sessionKey)) return;
                  seenSessions.add(sessionKey);
                  try {
                    await searchFile(path.join(projectPath, f), projectHash, sessionId);
                  } catch (err) {
                    console.warn("[chat:search] skip file:", f, err);
                  }
                }));
              }
            } catch {
            }
          }
        } catch {
        }
      }
      await searchInDir(projectsDir);
      if (archiveProjectsDir) {
        await searchInDir(archiveProjectsDir);
      }
      return results;
    },
    /**
     * Clear cached data. Optionally scope to a specific project.
     */
    clearCache(projectHash) {
      clearProjectsCache();
      clearSummaryCache(projectHash);
    }
  };
}
function encodeProjectHash$2(cwd) {
  if (!cwd) return "";
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}
function extractSessionId(filename) {
  const base = path.basename(filename, ".jsonl");
  const parts = base.split("-");
  if (parts.length >= 5) {
    return parts.slice(-5).join("-");
  }
  return base;
}
async function readSessionMeta(filePath) {
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "session_meta" && entry.payload) {
          rl.close();
          return {
            id: entry.payload.id || "",
            cwd: entry.payload.cwd || "",
            timestamp: entry.payload.timestamp || entry.timestamp || ""
          };
        }
      } catch {
      }
      rl.close();
      break;
    }
  } catch {
  }
  return null;
}
function parseCodexMessageLine(entry, sessionId, cwd, lineIndex) {
  const timestamp = entry.timestamp || "";
  const type = entry.type;
  const payload = entry.payload;
  if (!payload) return null;
  const payloadType = payload.type;
  if (type === "event_msg" && payloadType === "user_message") {
    const message = payload.message || "";
    if (!message) return null;
    return {
      uuid: `codex-${sessionId}-user-${lineIndex}`,
      type: "user",
      sessionId,
      cwd,
      timestamp,
      content: message
    };
  }
  if (type === "event_msg" && payloadType === "agent_message") {
    const message = payload.message || "";
    if (!message) return null;
    return {
      uuid: `codex-${sessionId}-agent-${lineIndex}`,
      type: "assistant",
      sessionId,
      cwd,
      timestamp,
      content: message
    };
  }
  if (type === "response_item" && (payloadType === "function_call" || payloadType === "custom_tool_call")) {
    const name = payload.name || payloadType;
    const input = payloadType === "function_call" ? payload.arguments : payload.input;
    return {
      uuid: payload.call_id || `codex-${sessionId}-tool-${lineIndex}`,
      type: "assistant",
      sessionId,
      cwd,
      timestamp,
      content: [{ type: "tool_use", name, input }]
    };
  }
  if (type === "response_item" && (payloadType === "function_call_output" || payloadType === "custom_tool_call_output")) {
    const output = payload.output || "";
    return {
      uuid: `codex-${sessionId}-result-${lineIndex}`,
      type: "assistant",
      sessionId,
      cwd,
      timestamp,
      content: [
        {
          type: "tool_result",
          content: output,
          tool_use_id: payload.call_id
        }
      ]
    };
  }
  return null;
}
function createCodexChatReader(opts) {
  const sessionsDir = path.join(opts.codexBasePath, "sessions");
  const globalStatePath = path.join(opts.codexBasePath, ".codex-global-state.json");
  const CACHE_TTL = 5 * 60 * 1e3;
  let indexCache = {
    data: [],
    expiry: 0
  };
  let threadTitlesCache = { data: {}, expiry: 0 };
  async function getThreadTitles() {
    if (Date.now() < threadTitlesCache.expiry) return threadTitlesCache.data;
    try {
      const raw = await fs.promises.readFile(globalStatePath, "utf-8");
      const state = JSON.parse(raw);
      const titles = state?.["thread-titles"]?.titles || {};
      threadTitlesCache = { data: titles, expiry: Date.now() + CACHE_TTL };
      return titles;
    } catch {
      return {};
    }
  }
  async function findAllSessionFiles() {
    const files = [];
    try {
      const years = await fs.promises.readdir(sessionsDir);
      for (const year of years) {
        if (!/^\d{4}$/.test(year)) continue;
        const yearDir = path.join(sessionsDir, year);
        try {
          const months = await fs.promises.readdir(yearDir);
          for (const month of months) {
            if (!/^\d{2}$/.test(month)) continue;
            const monthDir = path.join(yearDir, month);
            try {
              const days = await fs.promises.readdir(monthDir);
              for (const day of days) {
                if (!/^\d{2}$/.test(day)) continue;
                const dayDir = path.join(monthDir, day);
                try {
                  const entries = await fs.promises.readdir(dayDir);
                  for (const entry of entries) {
                    if (entry.endsWith(".jsonl")) {
                      files.push(path.join(dayDir, entry));
                    }
                  }
                } catch {
                }
              }
            } catch {
            }
          }
        } catch {
        }
      }
    } catch {
    }
    return files;
  }
  async function buildIndex() {
    if (Date.now() < indexCache.expiry) return indexCache.data;
    const files = await findAllSessionFiles();
    const titles = await getThreadTitles();
    const entries = [];
    for (const filePath of files) {
      try {
        const fileStat = await fs.promises.stat(filePath);
        const sessionId = extractSessionId(path.basename(filePath));
        const meta = await readSessionMeta(filePath);
        const cwd = meta?.cwd || "";
        const title = titles[sessionId] || titles[meta?.id || ""] || "";
        entries.push({
          filePath,
          sessionId: meta?.id || sessionId,
          mtime: fileStat.mtimeMs,
          size: fileStat.size,
          cwd,
          title
        });
      } catch {
      }
    }
    indexCache = { data: entries, expiry: Date.now() + CACHE_TTL };
    return entries;
  }
  return {
    async getProjects() {
      const entries = await buildIndex();
      const projectMap = /* @__PURE__ */ new Map();
      for (const entry of entries) {
        const key = entry.cwd || "unknown";
        const existing = projectMap.get(key);
        if (existing) {
          existing.count++;
          existing.totalSize += entry.size;
          existing.lastActivity = Math.max(existing.lastActivity, entry.mtime);
        } else {
          projectMap.set(key, {
            cwd: entry.cwd,
            count: 1,
            totalSize: entry.size,
            lastActivity: entry.mtime
          });
        }
      }
      const projects = [];
      for (const [, value] of projectMap) {
        const hash = encodeProjectHash$2(value.cwd);
        const displayPath = value.cwd || "Unknown";
        const parts = displayPath.split("/").filter(Boolean);
        projects.push({
          projectHash: hash,
          displayPath,
          displayName: parts[parts.length - 1] || "Unknown",
          sessionCount: value.count,
          totalSize: value.totalSize,
          lastActivity: value.lastActivity,
          source: "codex"
        });
      }
      return projects.sort((a, b) => b.lastActivity - a.lastActivity);
    },
    /** Shared: build a SessionSummary from an index entry */
    async _buildSummary(entry, titles) {
      let title = entry.title || titles[entry.sessionId] || "";
      if (!title) {
        title = await this._extractFirstUserMessage(entry.filePath);
      }
      return {
        sessionId: entry.sessionId,
        projectHash: encodeProjectHash$2(entry.cwd),
        title: title || entry.sessionId,
        startedAt: new Date(entry.mtime).toISOString(),
        lastModified: entry.mtime,
        fileSize: entry.size,
        source: "codex"
      };
    },
    async getSessionsForProject(projectHash, limit = 50) {
      const entries = await buildIndex();
      const titles = await getThreadTitles();
      const matching = entries.filter((e) => encodeProjectHash$2(e.cwd) === projectHash).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      return Promise.all(matching.map((e) => this._buildSummary(e, titles)));
    },
    async getAllRecentSessions(limit) {
      const entries = await buildIndex();
      const titles = await getThreadTitles();
      const sorted = [...entries].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      return Promise.all(sorted.map((e) => this._buildSummary(e, titles)));
    },
    async readSession(_projectHash, sessionId, options) {
      const entries = await buildIndex();
      const entry = entries.find((e) => e.sessionId === sessionId);
      if (!entry) return [];
      const messages = [];
      let lineIndex = 0;
      const cwd = entry.cwd;
      const rl = readline.createInterface({
        input: fs.createReadStream(entry.filePath, { encoding: "utf-8" }),
        crlfDelay: Infinity
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const msg = parseCodexMessageLine(parsed, sessionId, cwd, lineIndex);
          if (msg) messages.push(msg);
        } catch {
        }
        lineIndex++;
      }
      if (options?.limit && options.limit > 0) {
        return messages.slice(-options.limit);
      }
      return messages;
    },
    async search(query) {
      const entries = await buildIndex();
      const results = [];
      const lowerQuery = query.toLowerCase();
      for (const entry of entries) {
        try {
          const rl = readline.createInterface({
            input: fs.createReadStream(entry.filePath, { encoding: "utf-8" }),
            crlfDelay: Infinity
          });
          for await (const line of rl) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "event_msg" && parsed.payload?.type === "user_message") {
                const message = parsed.payload.message || "";
                if (message.toLowerCase().includes(lowerQuery)) {
                  const start = message.toLowerCase().indexOf(lowerQuery);
                  const snippet = message.slice(
                    Math.max(0, start - 30),
                    start + query.length + 30
                  );
                  results.push({
                    projectHash: encodeProjectHash$2(entry.cwd),
                    sessionId: entry.sessionId,
                    snippet,
                    timestamp: parsed.timestamp || ""
                  });
                  break;
                }
              }
            } catch {
            }
          }
        } catch {
        }
        if (results.length >= 50) break;
      }
      return results;
    },
    /** Extract first user message text from a session file (for title) */
    async _extractFirstUserMessage(filePath) {
      try {
        const rl = readline.createInterface({
          input: fs.createReadStream(filePath, { encoding: "utf-8" }),
          crlfDelay: Infinity
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type === "event_msg" && entry.payload?.type === "user_message") {
              rl.close();
              return (entry.payload.message || "").slice(0, 100);
            }
          } catch {
          }
        }
      } catch {
      }
      return "";
    },
    clearCache() {
      indexCache = { data: [], expiry: 0 };
      threadTitlesCache = { data: {}, expiry: 0 };
    }
  };
}
function encodeProjectHash$1(cwd) {
  if (!cwd) return "";
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}
function extractTextFromUserContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((p) => typeof p === "object" && p !== null && "text" in p).map((p) => p.text).join("\n");
}
async function extractCwdFromGeminiProject$1(projectDir) {
  const projectRootPath = path.join(projectDir, ".project_root");
  try {
    const cwd = (await fs.promises.readFile(projectRootPath, "utf-8")).trim();
    if (cwd) return cwd;
  } catch {
  }
  return null;
}
function createGeminiChatReader(opts) {
  const tmpDir = path.join(opts.geminiBasePath, "tmp");
  const CACHE_TTL = 5 * 60 * 1e3;
  let indexCache = {
    data: [],
    expiry: 0
  };
  async function findProjectDirs() {
    const dirs = [];
    try {
      const entries = await fs.promises.readdir(tmpDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push({ dir: path.join(tmpDir, entry.name), folderName: entry.name });
        }
      }
    } catch {
    }
    return dirs;
  }
  async function findChatFiles(projectDir) {
    const chatsDir = path.join(projectDir, "chats");
    const files = [];
    try {
      const entries = await fs.promises.readdir(chatsDir);
      for (const entry of entries) {
        if (entry.endsWith(".json")) {
          files.push(path.join(chatsDir, entry));
        }
      }
    } catch {
    }
    return files;
  }
  async function extractFirstUserMessage(filePath) {
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      const messages = data?.messages || [];
      for (const msg of messages) {
        if (msg?.type === "user") {
          const text = extractTextFromUserContent(msg.content);
          return text.slice(0, 100);
        }
      }
    } catch {
    }
    return "";
  }
  async function buildIndex() {
    if (Date.now() < indexCache.expiry) return indexCache.data;
    const projectDirs = await findProjectDirs();
    const entries = [];
    for (const { dir: projectDir, folderName } of projectDirs) {
      const cwd = await extractCwdFromGeminiProject$1(projectDir) || "";
      const chatFiles = await findChatFiles(projectDir);
      for (const filePath of chatFiles) {
        try {
          const fileStat = await fs.promises.stat(filePath);
          const sessionId = path.basename(filePath, ".json");
          entries.push({
            filePath,
            sessionId: `gemini-${sessionId}`,
            mtime: fileStat.mtimeMs,
            size: fileStat.size,
            cwd,
            folderName,
            title: ""
          });
        } catch {
        }
      }
    }
    indexCache = { data: entries, expiry: Date.now() + CACHE_TTL };
    return entries;
  }
  return {
    async getProjects() {
      const entries = await buildIndex();
      const projectMap = /* @__PURE__ */ new Map();
      for (const entry of entries) {
        const key = entry.cwd || entry.folderName;
        const existing = projectMap.get(key);
        if (existing) {
          existing.count++;
          existing.totalSize += entry.size;
          existing.lastActivity = Math.max(existing.lastActivity, entry.mtime);
        } else {
          projectMap.set(key, {
            cwd: entry.cwd,
            folderName: entry.folderName,
            count: 1,
            totalSize: entry.size,
            lastActivity: entry.mtime
          });
        }
      }
      const projects = [];
      for (const [, value] of projectMap) {
        const hash = value.cwd ? encodeProjectHash$1(value.cwd) : `gemini-${value.folderName}`;
        const displayPath = value.cwd || `Gemini (${value.folderName})`;
        const parts = displayPath.split("/").filter(Boolean);
        projects.push({
          projectHash: hash,
          displayPath,
          displayName: value.cwd ? parts[parts.length - 1] || "Unknown" : `Gemini ${value.folderName}`,
          sessionCount: value.count,
          totalSize: value.totalSize,
          lastActivity: value.lastActivity,
          source: "gemini"
        });
      }
      return projects.sort((a, b) => b.lastActivity - a.lastActivity);
    },
    async getSessionsForProject(projectHash, limit = 50) {
      const entries = await buildIndex();
      const matching = entries.filter((e) => {
        const hash = e.cwd ? encodeProjectHash$1(e.cwd) : `gemini-${e.folderName}`;
        return hash === projectHash;
      }).sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      return Promise.all(matching.map(async (entry) => {
        const title = entry.title || await extractFirstUserMessage(entry.filePath);
        const hash = entry.cwd ? encodeProjectHash$1(entry.cwd) : `gemini-${entry.folderName}`;
        return {
          sessionId: entry.sessionId,
          projectHash: hash,
          title: title || entry.sessionId,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: "gemini"
        };
      }));
    },
    async getAllRecentSessions(limit) {
      const entries = await buildIndex();
      const sorted = [...entries].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      return Promise.all(sorted.map(async (entry) => {
        const title = entry.title || await extractFirstUserMessage(entry.filePath);
        const hash = entry.cwd ? encodeProjectHash$1(entry.cwd) : `gemini-${entry.folderName}`;
        return {
          sessionId: entry.sessionId,
          projectHash: hash,
          title: title || entry.sessionId,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: "gemini"
        };
      }));
    },
    async readSession(_projectHash, sessionId, options) {
      const entries = await buildIndex();
      const entry = entries.find((e) => e.sessionId === sessionId);
      if (!entry) return [];
      const messages = [];
      try {
        const raw = await fs.promises.readFile(entry.filePath, "utf-8");
        const data = JSON.parse(raw);
        const msgArray = data?.messages || [];
        for (let i = 0; i < msgArray.length; i++) {
          const msg = msgArray[i];
          if (!msg || !msg.type) continue;
          const timestamp = msg.timestamp || new Date(entry.mtime).toISOString();
          const uuid = msg.id ? `gemini-${msg.id}` : `gemini-${sessionId}-${i}`;
          if (msg.type === "user") {
            const text = extractTextFromUserContent(msg.content);
            if (!text) continue;
            messages.push({
              uuid,
              type: "user",
              sessionId,
              cwd: entry.cwd,
              timestamp,
              content: text
            });
          } else if (msg.type === "gemini") {
            const text = typeof msg.content === "string" ? msg.content : extractTextFromUserContent(msg.content);
            if (!text) continue;
            messages.push({
              uuid,
              type: "assistant",
              sessionId,
              cwd: entry.cwd,
              timestamp,
              content: text
            });
          }
        }
      } catch {
      }
      if (options?.limit && options.limit > 0) {
        return messages.slice(-options.limit);
      }
      return messages;
    },
    async search(query) {
      const entries = await buildIndex();
      const results = [];
      const lowerQuery = query.toLowerCase();
      for (const entry of entries) {
        try {
          const raw = await fs.promises.readFile(entry.filePath, "utf-8");
          const data = JSON.parse(raw);
          const msgArray = data?.messages || [];
          for (const msg of msgArray) {
            if (msg?.type === "user") {
              const text = extractTextFromUserContent(msg.content);
              if (text.toLowerCase().includes(lowerQuery)) {
                const start = text.toLowerCase().indexOf(lowerQuery);
                const snippet = text.slice(
                  Math.max(0, start - 30),
                  start + query.length + 30
                );
                const hash = entry.cwd ? encodeProjectHash$1(entry.cwd) : `gemini-${entry.folderName}`;
                results.push({
                  projectHash: hash,
                  sessionId: entry.sessionId,
                  snippet,
                  timestamp: msg.timestamp || ""
                });
                break;
              }
            }
          }
        } catch {
        }
        if (results.length >= 50) break;
      }
      return results;
    },
    clearCache() {
      indexCache = { data: [], expiry: 0 };
    }
  };
}
function createChatMultiSource(opts) {
  const { ccReader, codexReader, geminiReader } = opts;
  return {
    async getProjects() {
      const tasks = [ccReader.getProjects()];
      if (codexReader) tasks.push(codexReader.getProjects());
      if (geminiReader) tasks.push(geminiReader.getProjects());
      const results = await Promise.all(tasks);
      const all = results.flat();
      const map = /* @__PURE__ */ new Map();
      for (const p of all) {
        const existing = map.get(p.projectHash);
        if (existing) {
          existing.sessionCount += p.sessionCount;
          existing.totalSize = (existing.totalSize || 0) + (p.totalSize || 0);
          existing.lastActivity = Math.max(existing.lastActivity, p.lastActivity);
        } else {
          map.set(p.projectHash, { ...p });
        }
      }
      const merged = Array.from(map.values());
      merged.sort((a, b) => b.lastActivity - a.lastActivity);
      return merged;
    },
    async getSessionsForProject(projectHash, limit = 50) {
      const tasks = [
        ccReader.getSessionsForProject(projectHash, limit)
      ];
      if (codexReader) tasks.push(codexReader.getSessionsForProject(projectHash, limit));
      if (geminiReader) tasks.push(geminiReader.getSessionsForProject(projectHash, limit));
      const results = await Promise.all(tasks);
      const merged = results.flat();
      merged.sort((a, b) => b.lastModified - a.lastModified);
      return merged.slice(0, limit);
    },
    async getAllRecentSessions(limit) {
      const tasks = [
        ccReader.getAllRecentSessions(limit)
      ];
      if (codexReader) tasks.push(codexReader.getAllRecentSessions(limit));
      if (geminiReader) tasks.push(geminiReader.getAllRecentSessions(limit));
      const results = await Promise.all(tasks);
      const merged = results.flat();
      merged.sort((a, b) => b.lastModified - a.lastModified);
      return merged.slice(0, limit);
    },
    async readSession(projectHash, sessionId, options) {
      const ccMessages = await ccReader.readSession(projectHash, sessionId, options);
      if (ccMessages.length > 0) return ccMessages;
      if (codexReader) {
        const codexMessages = await codexReader.readSession(projectHash, sessionId, options);
        if (codexMessages.length > 0) return codexMessages;
      }
      if (geminiReader) {
        return geminiReader.readSession(projectHash, sessionId, options);
      }
      return [];
    },
    async search(query) {
      const tasks = [ccReader.search(query)];
      if (codexReader) tasks.push(codexReader.search(query));
      if (geminiReader) tasks.push(geminiReader.search(query));
      const results = await Promise.all(tasks);
      return results.flat().slice(0, 500);
    }
  };
}
const DEFAULT_CONFIG = {
  window: { width: 1400, height: 900, x: 100, y: 100 },
  openTerminals: [],
  gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
  theme: "light",
  fontSize: 14,
  terminal: {
    themeName: "light",
    fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 13,
    cursorStyle: "block",
    cursorBlink: true
  },
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
      const merged = { ...DEFAULT_CONFIG, ...parsed };
      if (parsed.terminal) {
        merged.terminal = { ...DEFAULT_CONFIG.terminal, ...parsed.terminal };
      }
      return merged;
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
function encodeProjectHash(cwd) {
  if (!cwd) return "";
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}
const CC_BASE_PATH = path.join(os.homedir(), ".claude");
const CODEX_BASE_PATH = path.join(os.homedir(), ".codex");
const GEMINI_BASE_PATH = path.join(os.homedir(), ".gemini");
function createChatHandlers() {
  const ccReader = createChatProjectReader({
    ccBasePath: CC_BASE_PATH,
    archivePath: path.join(os.homedir(), ".muxvo", "chat-archive")
  });
  let codexReader = null;
  try {
    codexReader = createCodexChatReader({ codexBasePath: CODEX_BASE_PATH });
  } catch {
  }
  let geminiReader = null;
  try {
    geminiReader = createGeminiChatReader({ geminiBasePath: GEMINI_BASE_PATH });
  } catch {
  }
  const reader = createChatMultiSource({ ccReader, codexReader, geminiReader });
  return {
    async getProjects() {
      const projects = await reader.getProjects();
      return { projects };
    },
    async getSessions(params) {
      let sessions;
      if (params.projectHash === "__all__") {
        sessions = await reader.getAllRecentSessions(200);
      } else {
        sessions = await reader.getSessionsForProject(params.projectHash, 500);
      }
      const cm = createConfigManager();
      const config = cm.loadConfig();
      const sessionNames = config.sessionNames || {};
      if (Object.keys(sessionNames).length > 0) {
        sessions = sessions.map((s) => {
          const customName = sessionNames[s.sessionId];
          return customName ? { ...s, customTitle: customName } : s;
        });
      }
      return { sessions };
    },
    async getSession(params) {
      const options = params.limit && params.limit > 0 ? { limit: params.limit } : void 0;
      const messages = await reader.readSession(params.projectHash, params.sessionId, options);
      return { messages };
    },
    async search(params) {
      const results = await reader.search(params.query);
      return { results };
    },
    async setSessionName(params) {
      const { cwd, customName } = params;
      if (!cwd) return { success: false };
      const projectHash = encodeProjectHash(cwd);
      if (!projectHash) return { success: false };
      const sessions = await reader.getSessionsForProject(projectHash, 1);
      if (sessions.length === 0) return { success: false };
      const sessionId = sessions[0].sessionId;
      const cm = createConfigManager();
      const config = cm.loadConfig();
      const sessionNames = { ...config.sessionNames || {} };
      if (customName) {
        sessionNames[sessionId] = customName;
      } else {
        delete sessionNames[sessionId];
      }
      cm.saveConfig({ ...config, sessionNames });
      return { success: true, sessionId };
    },
    async export(params) {
      const messages = await reader.readSession(params.projectHash, params.sessionId);
      let content;
      let ext;
      if (params.format === "json") {
        content = JSON.stringify(messages, null, 2);
        ext = "json";
      } else {
        const displayTitle = params.title || params.sessionId;
        const lines = [`# ${displayTitle}`, ""];
        for (const msg of messages) {
          const role = msg.type;
          const body = typeof msg.content === "string" ? msg.content : msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
          lines.push(`## ${role} (${msg.timestamp})`, "", body, "");
        }
        content = lines.join("\n");
        ext = "md";
      }
      const rawName = params.title ? params.title.slice(0, 50).replace(/[\/\\:*?"<>|]/g, "_").trim() : params.sessionId;
      const fileName = rawName || params.sessionId;
      const exportDir = path.join(os.homedir(), ".muxvo", "exports");
      await fs.promises.mkdir(exportDir, { recursive: true });
      const filePath = path.join(exportDir, `${fileName}.${ext}`);
      await fs.promises.writeFile(filePath, content, "utf-8");
      return { outputPath: filePath };
    }
  };
}
function registerChatHandlers() {
  const handlers = createChatHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.GET_PROJECTS, async () => handlers.getProjects());
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.GET_SESSIONS, async (_e, p) => handlers.getSessions(p));
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.GET_SESSION, async (_e, p) => handlers.getSession(p));
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.SEARCH, async (_e, p) => handlers.search(p));
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.EXPORT, async (_e, p) => handlers.export(p));
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.SET_SESSION_NAME, async (_e, p) => handlers.setSessionName(p));
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.SHOW_SESSION_MENU, async (_e, p) => {
    return new Promise((resolve) => {
      const template = [
        { label: "📄 导出为 Markdown", click: () => resolve("export") },
        { type: "separator" },
        { label: "🗑 删除聊天记录", click: () => resolve("delete") }
      ];
      const menu = electron.Menu.buildFromTemplate(template);
      menu.popup({
        x: p.x,
        y: p.y,
        window: electron.BrowserWindow.getFocusedWindow() || void 0,
        callback: () => resolve(null)
      });
    });
  });
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.DELETE_SESSION, async (_e, p) => {
    const ccPath = path.join(os.homedir(), ".claude", "projects", p.projectHash, `${p.sessionId}.jsonl`);
    const archivePath = path.join(os.homedir(), ".muxvo", "chat-archive", p.projectHash, `${p.sessionId}.jsonl`);
    const deleted = [];
    try {
      await fs.promises.unlink(ccPath);
      deleted.push("cc");
    } catch {
    }
    try {
      await fs.promises.unlink(archivePath);
      deleted.push("archive");
    } catch {
    }
    return { success: true, deleted };
  });
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.REVEAL_FILE, async (_e, p) => {
    electron.shell.showItemInFolder(p.filePath);
    return { success: true };
  });
}
function registerChatArchiveHandlers(archiveManager) {
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.GET_ARCHIVE_ENABLED, async () => {
    return archiveManager.getEnabled();
  });
  electron.ipcMain.handle(IPC_CHANNELS.CHAT.SET_ARCHIVE_ENABLED, async (_e, p) => {
    await archiveManager.setEnabled(p.enabled);
    return { success: true };
  });
}
const CLAUDE_DIR$1 = path.join(os.homedir(), ".claude");
const CODEX_DIR$1 = path.join(os.homedir(), ".codex");
const GEMINI_DIR$1 = path.join(os.homedir(), ".gemini");
const ALLOWED_CONFIG_DIRS = [CLAUDE_DIR$1, CODEX_DIR$1, GEMINI_DIR$1];
const RESOURCE_TYPE_MAP = {
  skills: { paths: [path.join(CLAUDE_DIR$1, "skills"), path.join(CODEX_DIR$1, "skills"), path.join(GEMINI_DIR$1, "skills")], isFile: false },
  hooks: { paths: [path.join(CLAUDE_DIR$1, "hooks")], isFile: false },
  plans: { paths: [path.join(CLAUDE_DIR$1, "plans")], isFile: false },
  tasks: { paths: [path.join(CLAUDE_DIR$1, "tasks")], isFile: false },
  plugins: { paths: [path.join(CLAUDE_DIR$1, "plugins")], isFile: false },
  mcp: { paths: [path.join(CLAUDE_DIR$1, "mcp.json")], isFile: true }
};
function sourceFromPath(dirPath) {
  if (dirPath.startsWith(CODEX_DIR$1)) return "codex";
  if (dirPath.startsWith(GEMINI_DIR$1)) return "gemini";
  return "claude";
}
const EXCLUDED_FILES = /* @__PURE__ */ new Set([
  "node_modules",
  "package.json",
  "package-lock.json",
  ".DS_Store"
]);
function inferFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const formatMap = {
    ".json": "json",
    ".md": "markdown",
    ".ts": "typescript",
    ".js": "javascript",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".txt": "text"
  };
  return formatMap[ext] || "text";
}
let _projectCwdCache = [];
let _projectCwdCacheTime = 0;
const PROJECT_CWD_CACHE_TTL = 6e4;
async function extractCwdFromProject(projectDir) {
  try {
    const files = await promises.readdir(projectDir);
    const jsonl = files.find((f) => f.endsWith(".jsonl"));
    if (!jsonl) return null;
    const filePath = path.join(projectDir, jsonl);
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity
    });
    let lineCount = 0;
    for await (const line of rl) {
      if (++lineCount > 20) break;
      try {
        const obj = JSON.parse(line);
        if (obj.cwd) {
          rl.close();
          return obj.cwd;
        }
      } catch {
      }
    }
    rl.close();
    return null;
  } catch {
    return null;
  }
}
async function extractCwdFromCodexSession(filePath) {
  return new Promise((resolve2) => {
    try {
      const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let lineCount = 0;
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        rl.close();
        stream.destroy();
        resolve2(result);
      };
      rl.on("line", (line) => {
        if (++lineCount > 10) {
          done(null);
          return;
        }
        try {
          const obj = JSON.parse(line);
          if (obj.type === "session_meta" && obj.payload?.cwd) {
            done(obj.payload.cwd);
          }
        } catch {
        }
      });
      rl.on("close", () => done(null));
      rl.on("error", () => done(null));
      stream.on("error", () => done(null));
    } catch {
      resolve2(null);
    }
  });
}
async function findJsonlFiles(dir) {
  const results = [];
  try {
    const entries = await promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findJsonlFiles(fullPath));
      } else if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  } catch {
  }
  return results;
}
async function extractCwdFromGeminiProject(projectDir) {
  const projectRootPath = path.join(projectDir, ".project_root");
  try {
    const cwd = (await promises.readFile(projectRootPath, "utf-8")).trim();
    if (cwd) return cwd;
  } catch {
  }
  return null;
}
async function discoverProjectCwds() {
  const now = Date.now();
  if (_projectCwdCache.length > 0 && now - _projectCwdCacheTime < PROJECT_CWD_CACHE_TTL) {
    return _projectCwdCache;
  }
  const cwdSet = /* @__PURE__ */ new Set();
  const projectsDir = path.join(CLAUDE_DIR$1, "projects");
  try {
    const entries = await promises.readdir(projectsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(projectsDir, e.name));
    const ccCwds = await Promise.all(dirs.map((d) => extractCwdFromProject(d)));
    for (const cwd of ccCwds) {
      if (cwd) cwdSet.add(cwd);
    }
  } catch {
  }
  const codexSessionsDir = path.join(CODEX_DIR$1, "sessions");
  try {
    const jsonlFiles = await findJsonlFiles(codexSessionsDir);
    const cxCwds = await Promise.all(jsonlFiles.map((f) => extractCwdFromCodexSession(f)));
    for (const cwd of cxCwds) {
      if (cwd) cwdSet.add(cwd);
    }
  } catch {
  }
  const geminiTmpDir = path.join(GEMINI_DIR$1, "tmp");
  try {
    const entries = await promises.readdir(geminiTmpDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(geminiTmpDir, e.name));
    const gmCwds = await Promise.all(dirs.map((d) => extractCwdFromGeminiProject(d)));
    for (const cwd of gmCwds) {
      if (cwd) cwdSet.add(cwd);
    }
  } catch {
  }
  const uniqueCwds = [...cwdSet];
  _projectCwdCache = uniqueCwds;
  _projectCwdCacheTime = now;
  return uniqueCwds;
}
function createConfigHandlers() {
  return {
    /**
     * P0: Scan ~/.claude/ for resources of specified types
     * When projectPaths provided, also scan <projectPath>/.claude/skills/ and <projectPath>/.codex/skills/
     */
    async getResources(params) {
      const types = params?.types || Object.keys(RESOURCE_TYPE_MAP);
      const projectPaths = params?.projectPaths || [];
      const resources = [];
      for (const type of types) {
        const mapping = RESOURCE_TYPE_MAP[type];
        if (!mapping) continue;
        for (const dirPath of mapping.paths) {
          const source = sourceFromPath(dirPath);
          if (mapping.isFile) {
            try {
              const fileStat = await promises.stat(dirPath);
              resources.push({
                name: dirPath.split("/").pop(),
                type,
                path: dirPath,
                updatedAt: fileStat.mtime.toISOString(),
                source,
                level: "system"
              });
            } catch {
            }
          } else {
            try {
              const entries = await promises.readdir(dirPath, { withFileTypes: true });
              for (const entry of entries) {
                if (EXCLUDED_FILES.has(entry.name)) continue;
                const entryPath = path.join(dirPath, entry.name);
                try {
                  const entryStat = await promises.stat(entryPath);
                  resources.push({
                    name: entry.name,
                    type,
                    path: entryPath,
                    updatedAt: entryStat.mtime.toISOString(),
                    source,
                    level: "system"
                  });
                } catch {
                }
              }
            } catch {
            }
          }
        }
        if (type === "skills") {
          const systemDirSet = new Set(mapping.paths.map((p) => path.resolve(p)));
          const discoveredCwds = await discoverProjectCwds();
          const allProjectPaths = [.../* @__PURE__ */ new Set([...discoveredCwds, ...projectPaths])];
          for (const projectPath of allProjectPaths) {
            const projectSkillDirs = [
              { dir: path.join(projectPath, ".claude", "skills"), source: "claude" },
              { dir: path.join(projectPath, ".codex", "skills"), source: "codex" },
              { dir: path.join(projectPath, ".gemini", "skills"), source: "gemini" },
              { dir: path.join(projectPath, "skills"), source: "shared" }
            ];
            for (const { dir: dirPath, source } of projectSkillDirs) {
              if (systemDirSet.has(path.resolve(dirPath))) continue;
              try {
                const entries = await promises.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                  if (EXCLUDED_FILES.has(entry.name)) continue;
                  if (!entry.isDirectory() && !entry.name.endsWith(".md")) continue;
                  const entryPath = path.join(dirPath, entry.name);
                  try {
                    const entryStat = await promises.stat(entryPath);
                    resources.push({
                      name: entry.name,
                      type,
                      path: entryPath,
                      updatedAt: entryStat.mtime.toISOString(),
                      source,
                      level: "project"
                    });
                  } catch {
                  }
                }
              } catch {
              }
            }
          }
        }
      }
      return { resources };
    },
    /**
     * P0: Read file content, path must be under ~/.claude/
     */
    async getResourceContent(params) {
      const resolvedPath = path.resolve(params.path);
      const inAllowedDir = ALLOWED_CONFIG_DIRS.some((dir) => resolvedPath.startsWith(dir));
      const inProjectSkillDir = /\/\.(claude|codex|gemini)\/skills\//.test(resolvedPath) || /\/skills\/[^/]+\/SKILL\.md$/.test(resolvedPath);
      if (!inAllowedDir && !inProjectSkillDir) {
        throw new Error(`Access denied: path must be within allowed directories`);
      }
      const content = await promises.readFile(resolvedPath, "utf-8");
      const format = inferFormat(resolvedPath);
      return { content, format };
    },
    /**
     * P0: Read ~/.claude/settings.json
     */
    async getSettings() {
      const settingsPath = path.join(CLAUDE_DIR$1, "settings.json");
      try {
        const raw = await promises.readFile(settingsPath, "utf-8");
        return { settings: JSON.parse(raw) };
      } catch {
        return { settings: {} };
      }
    },
    /**
     * P0: Read global or project CLAUDE.md / GEMINI.md
     * tool defaults to 'claude' (reads CLAUDE.md); 'gemini' reads GEMINI.md
     */
    async getClaudeMd(params) {
      const tool = params.tool || "claude";
      const fileName = tool === "gemini" ? "GEMINI.md" : "CLAUDE.md";
      const baseDir = tool === "gemini" ? GEMINI_DIR$1 : CLAUDE_DIR$1;
      let filePath;
      if (params.scope === "global") {
        filePath = path.join(baseDir, fileName);
      } else {
        if (!params.projectPath) {
          throw new Error("projectPath is required for project scope");
        }
        filePath = path.join(params.projectPath, fileName);
      }
      try {
        const content = await promises.readFile(filePath, "utf-8");
        return { content };
      } catch {
        return { content: "" };
      }
    },
    /**
     * P1: Atomic write to ~/.claude/settings.json
     */
    async saveSettings(params) {
      const settingsPath = path.join(CLAUDE_DIR$1, "settings.json");
      const tmpPath = settingsPath + ".tmp";
      await promises.mkdir(CLAUDE_DIR$1, { recursive: true });
      const data = JSON.stringify(params.settings, null, 2);
      await promises.writeFile(tmpPath, data, "utf-8");
      await promises.rename(tmpPath, settingsPath);
      return { success: true };
    },
    /**
     * P1: Atomic write to CLAUDE.md / GEMINI.md (global or project)
     */
    async saveClaudeMd(params) {
      const tool = params.tool || "claude";
      const fileName = tool === "gemini" ? "GEMINI.md" : "CLAUDE.md";
      const baseDir = tool === "gemini" ? GEMINI_DIR$1 : CLAUDE_DIR$1;
      let filePath;
      if (params.scope === "global") {
        filePath = path.join(baseDir, fileName);
      } else {
        if (!params.projectPath) {
          throw new Error("projectPath is required for project scope");
        }
        filePath = path.join(params.projectPath, fileName);
      }
      const tmpPath = filePath + ".tmp";
      const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
      await promises.mkdir(parentDir, { recursive: true });
      await promises.writeFile(tmpPath, params.content, "utf-8");
      await promises.rename(tmpPath, filePath);
      return { success: true };
    },
    /**
     * P2: Read project MEMORY.md
     */
    async getMemory(params) {
      const memoryPath = path.join(CLAUDE_DIR$1, "projects", params.projectHash, "memory", "MEMORY.md");
      try {
        const content = await promises.readFile(memoryPath, "utf-8");
        return { content };
      } catch {
        return { content: "" };
      }
    }
  };
}
function registerConfigHandlers() {
  const handlers = createConfigHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.CONFIG.GET_RESOURCES, async (_event, params) => {
    return handlers.getResources(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.CONFIG.GET_RESOURCE_CONTENT, async (_event, params) => {
    return handlers.getResourceContent(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.CONFIG.GET_SETTINGS, async () => {
    return handlers.getSettings();
  });
  electron.ipcMain.handle(IPC_CHANNELS.CONFIG.GET_CLAUDE_MD, async (_event, params) => {
    return handlers.getClaudeMd(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.CONFIG.SAVE_SETTINGS, async (_event, params) => {
    return handlers.saveSettings(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.CONFIG.SAVE_CLAUDE_MD, async (_event, params) => {
    return handlers.saveClaudeMd(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.CONFIG.GET_MEMORY, async (_event, params) => {
    return handlers.getMemory(params);
  });
}
const WRITABLE_ROOTS = [
  path.join(os.homedir(), ".muxvo"),
  path.join(os.homedir(), ".claude"),
  path.join(os.homedir(), ".codex"),
  os.tmpdir()
];
function isWritablePath(targetPath) {
  const resolved = path.normalize(path.resolve(targetPath));
  return WRITABLE_ROOTS.some((root) => resolved.startsWith(path.normalize(path.resolve(root))));
}
function createFsHandlers() {
  return {
    async readDir(params) {
      try {
        const entries = await fs.promises.readdir(params.path, { withFileTypes: true });
        const fileEntries = entries.map((entry) => ({
          name: entry.name,
          path: path.join(params.path, entry.name),
          isDirectory: entry.isDirectory()
        }));
        return { success: true, data: fileEntries };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err.code ?? "FS_ERROR";
        return { success: false, error: { code, message } };
      }
    },
    async readFile(params) {
      try {
        if (params.encoding === "base64") {
          const buffer = await fs.promises.readFile(params.path);
          return { success: true, data: { content: buffer.toString("base64"), encoding: "base64" } };
        }
        const content = await fs.promises.readFile(params.path, "utf-8");
        return { success: true, data: { content, encoding: "utf-8" } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err.code ?? "FS_ERROR";
        return { success: false, error: { code, message } };
      }
    },
    async writeFile(params) {
      const resolved = path.normalize(path.resolve(params.path));
      if (!isWritablePath(resolved)) {
        try {
          await fs.promises.access(resolved);
        } catch {
          return {
            success: false,
            error: { code: "PERMISSION_DENIED", message: "Path is outside writable directories and file does not exist" }
          };
        }
      }
      try {
        const tmpPath = `${resolved}.muxvo-tmp-${Date.now()}`;
        await fs.promises.writeFile(tmpPath, params.content, "utf-8");
        await fs.promises.rename(tmpPath, resolved);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err.code ?? "FS_ERROR";
        return { success: false, error: { code, message } };
      }
    },
    async selectDirectory(params) {
      const result = await electron.dialog.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath: params?.defaultPath
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }
      return { success: true, data: result.filePaths[0] };
    }
  };
}
function registerFsHandlers() {
  const handlers = createFsHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.FS.READ_DIR, async (_event, params) => {
    return handlers.readDir(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS.READ_FILE, async (_event, params) => {
    return handlers.readFile(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS.WRITE_FILE, async (_event, params) => {
    return handlers.writeFile(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS.SELECT_DIRECTORY, async (_event, params) => {
    return handlers.selectDirectory(params);
  });
}
async function getPreferences() {
  return {
    preferences: {
      theme: "dark",
      fontSize: 14,
      locale: "zh-CN"
    }
  };
}
async function savePreferences(_prefs) {
  return { success: true };
}
const SCANNED_TOOLS = ["claude", "codex", "gemini"];
async function detectCliTools() {
  const detectedTools = [];
  for (const tool of SCANNED_TOOLS) {
  }
  return {
    detectedTools,
    scannedTools: SCANNED_TOOLS
  };
}
function registerAppHandlers() {
  electron.ipcMain.handle(IPC_CHANNELS.APP.GET_PREFERENCES, async () => {
    return getPreferences();
  });
  electron.ipcMain.handle(IPC_CHANNELS.APP.SAVE_PREFERENCES, async (_event, prefs) => {
    return savePreferences();
  });
  electron.ipcMain.handle(IPC_CHANNELS.APP.DETECT_CLI_TOOLS, async () => {
    const result = await detectCliTools();
    const detected = result.detectedTools.map((t) => t.name);
    return {
      claude: detected.includes("claude"),
      codex: detected.includes("codex"),
      gemini: detected.includes("gemini")
    };
  });
}
const RETRY_CONFIG = {
  interval: 3e3,
  maxRetries: 3
};
function createFileWatcherStore() {
  let state = "Inactive";
  let watchedPath = null;
  let retryCount = 0;
  function dispatch(action) {
    switch (action.type) {
      case "TERMINAL_CREATED":
        state = "Watching";
        watchedPath = action.cwd ?? null;
        retryCount = 0;
        break;
      case "TERMINAL_CLOSED":
        state = "Inactive";
        watchedPath = null;
        retryCount = 0;
        break;
      case "WATCH_ERROR":
        state = "WatchError";
        break;
      case "RETRY_FAILED":
        retryCount++;
        if (retryCount >= RETRY_CONFIG.maxRetries) {
          state = "Inactive";
        }
        break;
      case "RETRY_SUCCESS":
        state = "Watching";
        retryCount = 0;
        break;
    }
  }
  function getState() {
    return state;
  }
  function getWatchedPath() {
    return watchedPath;
  }
  function getRetryConfig() {
    return { ...RETRY_CONFIG };
  }
  function getRetryCount() {
    return retryCount;
  }
  return {
    dispatch,
    getState,
    getWatchedPath,
    getRetryConfig,
    getRetryCount
  };
}
function pushToAllWindows$1(channel, payload) {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}
const watchers = /* @__PURE__ */ new Map();
function createFsWatcherHandlers() {
  const store = createFileWatcherStore();
  return {
    async watchStart(params) {
      try {
        const existing = watchers.get(params.id);
        if (existing) {
          existing.forEach((w) => w.close());
        }
        const fsWatchers = [];
        for (const watchPath of params.paths) {
          const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
            if (!filename) return;
            const type = eventType === "rename" ? "add" : "change";
            pushToAllWindows$1(IPC_CHANNELS.FS.CHANGE, {
              watchId: params.id,
              type,
              path: filename
            });
          });
          watcher.on("error", () => {
            store.dispatch({ type: "WATCH_ERROR" });
          });
          fsWatchers.push(watcher);
        }
        watchers.set(params.id, fsWatchers);
        store.dispatch({ type: "TERMINAL_CREATED", cwd: params.paths[0] });
        return { success: true, data: { watchId: params.id } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        store.dispatch({ type: "WATCH_ERROR" });
        return { success: false, error: { code: "WATCH_ERROR", message } };
      }
    },
    async watchStop(params) {
      const existing = watchers.get(params.id);
      if (!existing) {
        return { success: false, error: { code: "NOT_FOUND", message: `No watcher with id: ${params.id}` } };
      }
      existing.forEach((w) => w.close());
      watchers.delete(params.id);
      store.dispatch({ type: "TERMINAL_CLOSED" });
      return { success: true };
    }
  };
}
function registerFsWatcherHandlers() {
  const handlers = createFsWatcherHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.FS.WATCH_START, async (_event, params) => {
    return handlers.watchStart(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS.WATCH_STOP, async (_event, params) => {
    return handlers.watchStop(params);
  });
}
function generateUuid() {
  const hex = "0123456789abcdef";
  let uuid = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += "-";
    } else if (i === 14) {
      uuid += "4";
    } else if (i === 19) {
      uuid += hex[Math.random() * 4 | 8];
    } else {
      uuid += hex[Math.random() * 16 | 0];
    }
  }
  return uuid;
}
const TEMP_IMAGE_DIR = path.join(os.tmpdir(), "muxvo-images");
function createFsImageHandlers() {
  return {
    async writeTempImage(params) {
      try {
        await fs.promises.mkdir(TEMP_IMAGE_DIR, { recursive: true });
        const buffer = Buffer.from(params.imageData, "base64");
        const uuid = generateUuid();
        const filePath = path.join(TEMP_IMAGE_DIR, `${uuid}.${params.format}`);
        await fs.promises.writeFile(filePath, buffer);
        return { success: true, data: { filePath } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "WRITE_ERROR", message } };
      }
    },
    async writeClipboardImage(params) {
      try {
        await fs.promises.access(params.imagePath);
        return { success: true, data: { filePath: params.imagePath } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err.code ?? "FS_ERROR";
        return { success: false, error: { code, message } };
      }
    }
  };
}
function registerFsImageHandlers() {
  const handlers = createFsImageHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.FS.WRITE_TEMP_IMAGE, async (_event, params) => {
    return handlers.writeTempImage(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS.WRITE_CLIPBOARD_IMAGE, async (_event, params) => {
    return handlers.writeClipboardImage(params);
  });
}
let currentUser;
async function logout() {
  currentUser = void 0;
  return { success: true };
}
async function getAuthStatus() {
  if (currentUser) {
    return {
      loggedIn: true,
      user: currentUser
    };
  }
  return { loggedIn: false };
}
function generatePKCE() {
  const verifier = "pkce-verifier-" + Math.random().toString(36).slice(2);
  const challenge = "pkce-challenge-" + Math.random().toString(36).slice(2);
  return { verifier, challenge };
}
function createAuthMachine() {
  let state = "LoggedOut";
  const context = {
    codeVerifier: "",
    codeChallenge: "",
    tokenStorage: "safeStorage"
  };
  function resetOAuthContext() {
    context.codeVerifier = "";
    context.codeChallenge = "";
    context.authCode = void 0;
  }
  function resetAll() {
    resetOAuthContext();
    context.accessToken = void 0;
    context.refreshToken = void 0;
    context.username = void 0;
    context.userId = void 0;
    context.email = void 0;
    context.authMethod = void 0;
    context.emailCodeSentAt = void 0;
    context.avatarUrl = void 0;
  }
  function send(event, payload) {
    switch (state) {
      case "LoggedOut":
        if (event === "LOGIN") {
          state = "Authorizing";
          const pkce = generatePKCE();
          context.codeVerifier = pkce.verifier;
          context.codeChallenge = pkce.challenge;
          context.error = void 0;
          if (payload?.authMethod) {
            context.authMethod = payload.authMethod;
          }
        } else if (event === "SEND_EMAIL_CODE") {
          state = "CodeSent";
          context.authMethod = "email";
          if (payload?.email) {
            context.email = payload.email;
          }
          context.emailCodeSentAt = Date.now();
          context.error = void 0;
        }
        break;
      case "Authorizing":
        if (event === "AUTH_CALLBACK") {
          if (payload?.authCode) {
            context.authCode = payload.authCode;
          }
        } else if (event === "TOKEN_RECEIVED") {
          state = "LoggedIn";
          context.accessToken = payload?.accessToken;
          if (payload?.refreshToken) {
            context.refreshToken = payload.refreshToken;
          }
          if (payload?.username) {
            context.username = payload.username;
          }
          if (payload?.userId) {
            context.userId = payload.userId;
          }
          if (payload?.email) {
            context.email = payload.email;
          }
          if (payload?.avatarUrl) {
            context.avatarUrl = payload.avatarUrl;
          }
          context.tokenStorage = "safeStorage";
        } else if (event === "AUTH_FAILED") {
          state = "LoggedOut";
          context.error = payload?.error || "授权失败";
          resetOAuthContext();
          context.authMethod = void 0;
        }
        break;
      case "CodeSent":
        if (event === "VERIFY_CODE") {
          state = "Verifying";
        } else if (event === "RESEND_CODE") {
          context.emailCodeSentAt = Date.now();
        } else if (event === "AUTH_FAILED") {
          state = "LoggedOut";
          context.error = payload?.error || "验证码发送失败";
          context.authMethod = void 0;
          context.emailCodeSentAt = void 0;
        } else if (event === "CANCEL") {
          state = "LoggedOut";
          context.authMethod = void 0;
          context.emailCodeSentAt = void 0;
          context.error = void 0;
        }
        break;
      case "Verifying":
        if (event === "TOKEN_RECEIVED") {
          state = "LoggedIn";
          context.accessToken = payload?.accessToken;
          if (payload?.refreshToken) {
            context.refreshToken = payload.refreshToken;
          }
          if (payload?.username) {
            context.username = payload.username;
          }
          if (payload?.userId) {
            context.userId = payload.userId;
          }
          if (payload?.email) {
            context.email = payload.email;
          }
          if (payload?.avatarUrl) {
            context.avatarUrl = payload.avatarUrl;
          }
          context.tokenStorage = "safeStorage";
        } else if (event === "AUTH_FAILED") {
          state = "LoggedOut";
          context.error = payload?.error || "验证失败";
          resetOAuthContext();
          context.authMethod = void 0;
          context.emailCodeSentAt = void 0;
        }
        break;
      case "LoggedIn":
        if (event === "LOGOUT") {
          state = "LoggedOut";
          resetAll();
        } else if (event === "TOKEN_EXPIRED") {
          state = "LoggedOut";
          resetAll();
        } else if (event === "TOKEN_REFRESH") {
          context.accessToken = payload?.accessToken;
          if (payload?.refreshToken) {
            context.refreshToken = payload.refreshToken;
          }
        } else if (event === "REFRESH_FAILED") {
          state = "LoggedOut";
          resetAll();
          context.error = payload?.error || "Token 刷新失败";
        }
        break;
    }
  }
  return {
    get state() {
      return state;
    },
    get context() {
      return context;
    },
    send
  };
}
let safeStorage = null;
let appGetPath = null;
try {
  const electron2 = require("electron");
  if (electron2.safeStorage) {
    safeStorage = electron2.safeStorage;
  }
  if (electron2.app?.getPath) {
    appGetPath = (name) => electron2.app.getPath(name);
  }
} catch {
}
function getTokenFilePath() {
  if (!appGetPath) return null;
  try {
    return path.join(appGetPath("userData"), ".auth-token");
  } catch {
    return null;
  }
}
let cachedAccessToken;
let cachedRefreshToken;
function resolveStorageType() {
  if (safeStorage && safeStorage.isEncryptionAvailable() && getTokenFilePath()) {
    return "safeStorage";
  }
  if (getTokenFilePath()) {
    return "plaintext";
  }
  return "memory";
}
async function writeTokenFile(data) {
  const filePath = getTokenFilePath();
  if (!filePath) return;
  const json = JSON.stringify(data);
  const storageType = resolveStorageType();
  if (storageType === "safeStorage" && safeStorage) {
    const encrypted = safeStorage.encryptString(json);
    const tmpPath = filePath + ".tmp";
    await fs.promises.writeFile(tmpPath, encrypted);
    await fs.promises.rename(tmpPath, filePath);
  } else if (storageType === "plaintext") {
    const tmpPath = filePath + ".tmp";
    await fs.promises.writeFile(tmpPath, json, "utf-8");
    await fs.promises.rename(tmpPath, filePath);
  }
}
async function readTokenFile() {
  const filePath = getTokenFilePath();
  if (!filePath || !fs.existsSync(filePath)) return null;
  const storageType = resolveStorageType();
  try {
    if (storageType === "safeStorage" && safeStorage) {
      const encrypted = await fs.promises.readFile(filePath);
      const json = safeStorage.decryptString(encrypted);
      return JSON.parse(json);
    } else {
      const json = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(json);
    }
  } catch {
    await deleteTokenFile();
    return null;
  }
}
async function deleteTokenFile() {
  const filePath = getTokenFilePath();
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
  }
  try {
    await fs.promises.unlink(filePath + ".tmp");
  } catch {
  }
}
async function clearToken() {
  cachedAccessToken = void 0;
  cachedRefreshToken = void 0;
  await deleteTokenFile();
}
async function storeTokenPair(accessToken, refreshToken) {
  cachedAccessToken = accessToken;
  cachedRefreshToken = refreshToken;
  await writeTokenFile({ accessToken, refreshToken });
}
async function getTokenPair() {
  if (cachedAccessToken || cachedRefreshToken) {
    return {
      accessToken: cachedAccessToken,
      refreshToken: cachedRefreshToken
    };
  }
  const data = await readTokenFile();
  if (data) {
    cachedAccessToken = data.accessToken;
    cachedRefreshToken = data.refreshToken || void 0;
    return {
      accessToken: cachedAccessToken,
      refreshToken: cachedRefreshToken
    };
  }
  return {};
}
function createBackendClient(options) {
  const { baseUrl, timeout = 15e3 } = options;
  async function request(path2, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${baseUrl}${path2}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers
        }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const msg = body.message || response.statusText;
        throw new Error(`API error ${response.status}: ${msg}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    /** Initialize GitHub OAuth flow — returns authUrl for browser open */
    async initGithubAuth() {
      return request("/auth/github/init", { method: "POST" });
    },
    /** Initialize Google OAuth flow — returns authUrl for browser open */
    async initGoogleAuth() {
      return request("/auth/google/init", { method: "POST" });
    },
    /** Send email verification code */
    async sendEmailCode(email) {
      return request("/auth/email/send", {
        method: "POST",
        body: JSON.stringify({ email })
      });
    },
    /** Verify email code and get tokens */
    async verifyEmailCode(email, code) {
      return request("/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({ email, code })
      });
    },
    /** Refresh access token using refresh token (rotation) */
    async refreshToken(refreshToken) {
      return request("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken })
      });
    },
    /** Logout — revoke refresh token on server */
    async logout(refreshToken) {
      return request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken })
      });
    },
    /** Get user profile (requires access token) */
    async getUserProfile(accessToken) {
      return request("/user/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    }
  };
}
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 1e3;
function createAuthManager(options) {
  const machine = createAuthMachine();
  const client = createBackendClient({
    baseUrl: options.backendUrl,
    timeout: options.backendTimeout
  });
  let refreshTimer = null;
  function startRefreshTimer() {
    stopRefreshTimer();
    refreshTimer = setInterval(async () => {
      try {
        const tokens = await getTokenPair();
        if (!tokens.refreshToken) {
          stopRefreshTimer();
          return;
        }
        const newTokens = await client.refreshToken(tokens.refreshToken);
        await storeTokenPair(newTokens.accessToken, newTokens.refreshToken);
        machine.send("TOKEN_REFRESH", {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken
        });
      } catch {
        machine.send("REFRESH_FAILED", { error: "Token 自动刷新失败" });
        stopRefreshTimer();
        await clearToken();
      }
    }, TOKEN_REFRESH_INTERVAL_MS);
  }
  function stopRefreshTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }
  return {
    get state() {
      return machine.state;
    },
    get context() {
      return machine.context;
    },
    /** Start GitHub OAuth flow — opens browser */
    async loginGithub() {
      machine.send("LOGIN", { authMethod: "github" });
      const result = await client.initGithubAuth();
      return result;
    },
    /** Start Google OAuth flow — opens browser */
    async loginGoogle() {
      machine.send("LOGIN", { authMethod: "google" });
      const result = await client.initGoogleAuth();
      return result;
    },
    /** Send email verification code */
    async sendEmailCode(email) {
      machine.send("SEND_EMAIL_CODE", { email });
      return client.sendEmailCode(email);
    },
    /** Verify email code and complete login */
    async verifyEmailCode(email, code) {
      machine.send("VERIFY_CODE");
      try {
        const result = await client.verifyEmailCode(email, code);
        await storeTokenPair(result.accessToken, result.refreshToken);
        machine.send("TOKEN_RECEIVED", {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          username: result.user.displayName || email,
          userId: result.user.id,
          email: result.user.email || email
        });
        startRefreshTimer();
        return { success: true, user: result.user };
      } catch (err) {
        machine.send("AUTH_FAILED", {
          error: err instanceof Error ? err.message : "验证码验证失败"
        });
        return { success: false, error: err instanceof Error ? err.message : "验证码验证失败" };
      }
    },
    /** Handle OAuth callback (deep link with tokens from server redirect) */
    async handleOAuthCallback(accessToken, refreshToken) {
      machine.send("AUTH_CALLBACK", { authCode: "oauth-callback" });
      try {
        await storeTokenPair(accessToken, refreshToken);
        const user = await client.getUserProfile(accessToken);
        machine.send("TOKEN_RECEIVED", {
          accessToken,
          refreshToken,
          username: user.displayName || user.email || "",
          userId: user.id,
          email: user.email || ""
        });
        startRefreshTimer();
        return { success: true, user };
      } catch (err) {
        machine.send("AUTH_FAILED", {
          error: err instanceof Error ? err.message : "OAuth 回调处理失败"
        });
        await clearToken();
        return { success: false, error: err instanceof Error ? err.message : "OAuth 回调处理失败" };
      }
    },
    /** Manual token refresh */
    async refreshToken() {
      const tokens = await getTokenPair();
      if (!tokens.refreshToken) {
        return { success: false, error: "No refresh token available" };
      }
      try {
        const newTokens = await client.refreshToken(tokens.refreshToken);
        await storeTokenPair(newTokens.accessToken, newTokens.refreshToken);
        machine.send("TOKEN_REFRESH", {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken
        });
        return { success: true };
      } catch (err) {
        machine.send("REFRESH_FAILED", { error: "Token 刷新失败" });
        await clearToken();
        stopRefreshTimer();
        return { success: false, error: err instanceof Error ? err.message : "Token 刷新失败" };
      }
    },
    /** Logout — revoke server token + clear local */
    async logout() {
      const tokens = await getTokenPair();
      stopRefreshTimer();
      if (tokens.refreshToken) {
        try {
          await client.logout(tokens.refreshToken);
        } catch {
        }
      }
      await clearToken();
      machine.send("LOGOUT");
      return { success: true };
    },
    /** Get current auth status */
    async getStatus() {
      const isLoggedIn = machine.state === "LoggedIn";
      if (isLoggedIn) {
        return {
          loggedIn: true,
          user: {
            username: machine.context.username || "",
            avatarUrl: "",
            userId: machine.context.userId,
            email: machine.context.email
          }
        };
      }
      return { loggedIn: false };
    },
    /** Try to restore session from stored tokens on startup */
    async tryRestoreSession() {
      const tokens = await getTokenPair();
      if (!tokens.accessToken || !tokens.refreshToken) {
        return { success: false };
      }
      try {
        const user = await client.getUserProfile(tokens.accessToken);
        machine.send("LOGIN", { authMethod: void 0 });
        machine.send("TOKEN_RECEIVED", {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          username: user.displayName || user.email || "",
          userId: user.id,
          email: user.email || ""
        });
        startRefreshTimer();
        return { success: true, user };
      } catch {
        try {
          const newTokens = await client.refreshToken(tokens.refreshToken);
          await storeTokenPair(newTokens.accessToken, newTokens.refreshToken);
          const user = await client.getUserProfile(newTokens.accessToken);
          machine.send("LOGIN", { authMethod: void 0 });
          machine.send("TOKEN_RECEIVED", {
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            username: user.displayName || user.email || "",
            userId: user.id,
            email: user.email || ""
          });
          startRefreshTimer();
          return { success: true, user };
        } catch {
          await clearToken();
          return { success: false };
        }
      }
    },
    /** Stop refresh timer (for cleanup) */
    destroy() {
      stopRefreshTimer();
    }
  };
}
let authManager = null;
function getAuthManager() {
  if (!authManager) {
    const backendUrl = process.env.MUXVO_API_URL || "https://api.muxvo.com";
    authManager = createAuthManager({ backendUrl });
  }
  return authManager;
}
function createAuthHandlers() {
  return {
    // ─── Original handlers (preserved) ───
    async loginGithub() {
      try {
        const manager = getAuthManager();
        const result = await manager.loginGithub();
        await electron.shell.openExternal(result.authUrl);
        return { success: true, data: { authUrl: result.authUrl } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    async logout() {
      try {
        const result = await logout();
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    async getStatus() {
      try {
        const result = await getAuthStatus();
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    // ─── Phase 5 新增 handlers ───
    async loginGoogle() {
      try {
        const manager = getAuthManager();
        const result = await manager.loginGoogle();
        await electron.shell.openExternal(result.authUrl);
        return { success: true, data: { authUrl: result.authUrl } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    async sendEmailCode(params) {
      try {
        const manager = getAuthManager();
        const result = await manager.sendEmailCode(params.email);
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    async verifyEmailCode(params) {
      try {
        const manager = getAuthManager();
        const result = await manager.verifyEmailCode(params.email, params.code);
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    async oauthCallback(params) {
      try {
        const manager = getAuthManager();
        const result = await manager.handleOAuthCallback(params.accessToken, params.refreshToken);
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    async refreshToken() {
      try {
        const manager = getAuthManager();
        const result = await manager.refreshToken();
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    },
    async getProfile() {
      try {
        const manager = getAuthManager();
        const status = await manager.getStatus();
        return { success: true, data: status };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "AUTH_ERROR", message } };
      }
    }
  };
}
function registerAuthHandlers() {
  const handlers = createAuthHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_GITHUB, async () => {
    return handlers.loginGithub();
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.LOGOUT, async () => {
    return handlers.logout();
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.GET_STATUS, async () => {
    return handlers.getStatus();
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_GOOGLE, async () => {
    return handlers.loginGoogle();
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.SEND_EMAIL_CODE, async (_e, params) => {
    return handlers.sendEmailCode(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.VERIFY_EMAIL_CODE, async (_e, params) => {
    return handlers.verifyEmailCode(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.OAUTH_CALLBACK, async (_e, params) => {
    return handlers.oauthCallback(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.REFRESH_TOKEN, async () => {
    return handlers.refreshToken();
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH.GET_PROFILE, async () => {
    return handlers.getProfile();
  });
}
function createAnalyticsTracker() {
  const events = [];
  return {
    track(input) {
      events.push({
        event: input.event,
        params: input.params,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    },
    getSummary(req) {
      const filtered = events.filter((e) => {
        const date = e.timestamp.slice(0, 10);
        return date >= req.startDate && date <= req.endDate;
      });
      const grouped = /* @__PURE__ */ new Map();
      for (const e of filtered) {
        const date = e.timestamp.slice(0, 10);
        if (!grouped.has(date)) grouped.set(date, []);
        grouped.get(date).push(e);
      }
      const summaries = [];
      for (const [date, dayEvents] of grouped) {
        const eventCounts = {};
        for (const e of dayEvents) {
          eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
        }
        summaries.push({ date, totalEvents: dayEvents.length, eventCounts });
      }
      summaries.sort((a, b) => a.date.localeCompare(b.date));
      return summaries;
    },
    clear() {
      events.length = 0;
    }
  };
}
function createAnalyticsHandlers(tracker) {
  return {
    async track(params) {
      try {
        tracker.track(params);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: { code: "ANALYTICS_TRACK_ERROR", message }
        };
      }
    },
    async getSummary(params) {
      try {
        const result = tracker.getSummary(params);
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: { code: "ANALYTICS_SUMMARY_ERROR", message }
        };
      }
    },
    async clear() {
      try {
        tracker.clear();
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: { code: "ANALYTICS_CLEAR_ERROR", message }
        };
      }
    }
  };
}
function registerAnalyticsHandlers() {
  const tracker = createAnalyticsTracker();
  const handlers = createAnalyticsHandlers(tracker);
  electron.ipcMain.handle(
    IPC_CHANNELS.ANALYTICS.TRACK,
    async (_event, params) => {
      return handlers.track(params);
    }
  );
  electron.ipcMain.handle(
    IPC_CHANNELS.ANALYTICS.GET_SUMMARY,
    async (_event, params) => {
      return handlers.getSummary(params);
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.ANALYTICS.CLEAR, async () => {
    return handlers.clear();
  });
}
function createChatWatcher() {
  let watcher = null;
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const pendingTimers = /* @__PURE__ */ new Map();
  let sessionUpdateCallback = null;
  return {
    /**
     * Register a callback invoked on every debounced session-update event.
     * Used by chat-archive to trigger incremental archive.
     */
    onSessionUpdate(cb) {
      sessionUpdateCallback = cb;
    },
    start() {
      try {
        watcher = fs.watch(projectsDir, { recursive: true }, (eventType, filename) => {
          if (!filename || !filename.endsWith(".jsonl")) return;
          const parts = filename.split("/");
          if (parts.length >= 2) {
            const projectHash = parts[parts.length - 2];
            const sessionId = parts[parts.length - 1].replace(".jsonl", "");
            const key = `${projectHash}/${sessionId}`;
            const existing = pendingTimers.get(key);
            if (existing) clearTimeout(existing);
            pendingTimers.set(key, setTimeout(() => {
              pendingTimers.delete(key);
              electron.BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send(IPC_CHANNELS.CHAT.SESSION_UPDATE, { projectHash, sessionId });
                }
              });
              sessionUpdateCallback?.(projectHash, sessionId);
            }, 500));
          }
        });
      } catch {
      }
    },
    stop() {
      watcher?.close();
      watcher = null;
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
    }
  };
}
const CC_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const ARCHIVE_DIR = path.join(os.homedir(), ".muxvo", "chat-archive");
const CONFIG_PATH = path.join(os.homedir(), ".muxvo", "chat-archive-config.json");
function createChatArchiveManager() {
  let running = false;
  let enabled = true;
  async function readEnabled() {
    try {
      const raw = await promises.readFile(CONFIG_PATH, "utf-8");
      const config = JSON.parse(raw);
      return config.enabled !== false;
    } catch {
      return true;
    }
  }
  async function writeEnabled(value) {
    await promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await promises.writeFile(CONFIG_PATH, JSON.stringify({ enabled: value }), "utf-8");
  }
  async function collectSyncTargets() {
    const targets = [];
    async function walk(ccDir, archiveDir) {
      try {
        const entries = await promises.readdir(ccDir, { withFileTypes: true });
        for (const entry of entries) {
          const ccPath = path.join(ccDir, entry.name);
          const archPath = path.join(archiveDir, entry.name);
          if (entry.isDirectory()) {
            await walk(ccPath, archPath);
          } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            try {
              const ccStats = await promises.stat(ccPath);
              let archiveStats;
              try {
                archiveStats = await promises.stat(archPath);
              } catch {
                archiveStats = null;
              }
              const ccMtime = Math.floor(ccStats.mtimeMs / 1e3);
              const archMtime = archiveStats ? Math.floor(archiveStats.mtimeMs / 1e3) : 0;
              if (ccMtime !== archMtime) {
                targets.push({ ccPath, archivePath: archPath });
              }
            } catch {
            }
          }
        }
      } catch {
      }
    }
    await walk(CC_PROJECTS_DIR, ARCHIVE_DIR);
    return targets;
  }
  async function fullScan(onProgress) {
    const targets = await collectSyncTargets();
    const total = targets.length;
    let synced = 0;
    if (total === 0) return { synced: 0, total: 0 };
    onProgress?.(0, total);
    for (const target of targets) {
      try {
        await promises.mkdir(path.dirname(target.archivePath), { recursive: true });
        await promises.copyFile(target.ccPath, target.archivePath);
        synced++;
        if (synced % 50 === 0 || synced === total) {
          onProgress?.(synced, total);
        }
      } catch {
      }
    }
    onProgress?.(synced, total);
    return { synced, total };
  }
  async function archiveSession(projectHash, sessionId) {
    try {
      const ccPath = path.join(CC_PROJECTS_DIR, projectHash, `${sessionId}.jsonl`);
      const archivePath = path.join(ARCHIVE_DIR, projectHash, `${sessionId}.jsonl`);
      const ccStats = await promises.stat(ccPath);
      let archiveStats;
      try {
        archiveStats = await promises.stat(archivePath);
      } catch {
        archiveStats = null;
      }
      const ccMtimeSeconds = Math.floor(ccStats.mtimeMs / 1e3);
      const archiveMtimeSeconds = archiveStats ? Math.floor(archiveStats.mtimeMs / 1e3) : 0;
      if (ccMtimeSeconds !== archiveMtimeSeconds) {
        await promises.mkdir(path.dirname(archivePath), { recursive: true });
        await promises.copyFile(ccPath, archivePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  return {
    async start(onProgress) {
      if (running) return;
      running = true;
      enabled = await readEnabled();
      if (enabled) {
        await new Promise((r) => setTimeout(r, 3e3));
        if (!running) return;
        await fullScan(onProgress);
      }
    },
    stop() {
      running = false;
    },
    /**
     * Called when chat watcher detects a session update.
     */
    onSessionUpdate(projectHash, sessionId) {
      if (!running || !enabled) return;
      archiveSession(projectHash, sessionId);
    },
    async getEnabled() {
      return readEnabled();
    },
    async setEnabled(value) {
      await writeEnabled(value);
      enabled = value;
      if (value && running) {
        await fullScan();
      }
    }
  };
}
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CODEX_DIR = path.join(os.homedir(), ".codex");
const GEMINI_DIR = path.join(os.homedir(), ".gemini");
const WATCH_DIRS = [
  { dir: path.join(CLAUDE_DIR, "skills"), type: "skills" },
  { dir: path.join(CODEX_DIR, "skills"), type: "skills" },
  { dir: path.join(GEMINI_DIR, "skills"), type: "skills" },
  { dir: path.join(CLAUDE_DIR, "hooks"), type: "hooks" },
  { dir: path.join(CLAUDE_DIR, "plugins"), type: "plugins" },
  { dir: path.join(CLAUDE_DIR, "plans"), type: "plans" },
  { dir: path.join(CLAUDE_DIR, "tasks"), type: "tasks" }
];
function createConfigWatcher() {
  const watchers2 = [];
  return {
    start() {
      for (const { dir, type } of WATCH_DIRS) {
        try {
          const watcher = fs.watch(dir, { recursive: true }, (_eventType, filename) => {
            if (!filename) return;
            const event = _eventType === "rename" ? "add" : "change";
            electron.BrowserWindow.getAllWindows().forEach((win) => {
              win.webContents.send(IPC_CHANNELS.CONFIG.RESOURCE_CHANGE, {
                type,
                event,
                name: filename
              });
            });
          });
          watchers2.push(watcher);
        } catch {
        }
      }
    },
    stop() {
      for (const w of watchers2) {
        w.close();
      }
      watchers2.length = 0;
    }
  };
}
function createMemoryMonitor(opts) {
  const threshold = opts.thresholdMB;
  return {
    getThreshold() {
      return threshold;
    },
    checkMemory() {
      const memUsage = process.memoryUsage();
      const currentMB = Math.round(memUsage.heapUsed / (1024 * 1024));
      return {
        exceeded: currentMB > threshold,
        currentMB
      };
    }
  };
}
function createMemoryPushTimer(opts) {
  const monitor = createMemoryMonitor({ thresholdMB: opts.thresholdMB });
  let intervalId = null;
  function check() {
    const result = monitor.checkMemory();
    if (result.exceeded) {
      const payload = {
        usageMB: result.currentMB,
        threshold: opts.thresholdMB
      };
      electron.BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(IPC_CHANNELS.APP.MEMORY_WARNING, payload);
      });
    }
  }
  return {
    start() {
      if (intervalId) return;
      intervalId = setInterval(check, opts.intervalMs);
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    /** Single check without interval — useful for testing */
    checkOnce() {
      check();
    }
  };
}
electron.protocol.registerSchemesAsPrivileged([
  { scheme: "local-file", privileges: { bypassCSP: true, supportFetchAPI: true, stream: true } }
]);
for (const stream of [process.stdout, process.stderr]) {
  stream?.on("error", (err) => {
    if (err.code === "EPIPE") return;
    throw err;
  });
}
let mainWindow = null;
let lastBounds = null;
let pendingDeepLinkUrl = null;
function pushToAllWindows(channel, payload) {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}
function handleDeepLink(url2) {
  console.log("[MUXVO:deeplink] Handling URL:", url2);
  try {
    const parsed = new URL(url2);
    if (parsed.protocol !== "muxvo:") return;
    if (parsed.host !== "auth" || parsed.pathname !== "/callback") {
      console.warn("[MUXVO:deeplink] Unknown deep link path:", parsed.host, parsed.pathname);
      return;
    }
    const accessToken = parsed.searchParams.get("accessToken");
    const refreshToken = parsed.searchParams.get("refreshToken");
    if (!accessToken || !refreshToken) {
      console.warn("[MUXVO:deeplink] Missing tokens in callback URL");
      return;
    }
    const manager = getAuthManager();
    manager.handleOAuthCallback(accessToken, refreshToken).then((result) => {
      console.log("[MUXVO:deeplink] OAuth callback success");
      pushToAllWindows(IPC_CHANNELS.AUTH.STATUS_CHANGE, {
        success: true,
        data: {
          loggedIn: true,
          user: result.user
        }
      });
    }).catch((err) => {
      console.error("[MUXVO:deeplink] OAuth callback failed:", err);
    });
  } catch (err) {
    console.error("[MUXVO:deeplink] Failed to parse URL:", err);
  }
}
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  electron.app.quit();
}
electron.app.on("open-url", (event, url2) => {
  event.preventDefault();
  if (electron.app.isReady()) {
    handleDeepLink(url2);
  } else {
    pendingDeepLinkUrl = url2;
  }
});
electron.app.on("second-instance", (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const deepLinkUrl = argv.find((arg) => arg.startsWith("muxvo://"));
  if (deepLinkUrl) {
    handleDeepLink(deepLinkUrl);
  }
});
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
    saveWindowBoundsAndClearTerminals();
  });
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const menuItems = [];
    if (params.selectionText) {
      menuItems.push({ role: "copy" });
    }
    if (params.isEditable) {
      menuItems.push({ role: "cut" }, { role: "paste" }, { role: "selectAll" });
    }
    if (menuItems.length > 0) {
      electron.Menu.buildFromTemplate(menuItems).popup();
    }
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else if (utils.is.dev) {
    const fallbackUrl = "http://localhost:5173";
    console.warn("[MUXVO] ELECTRON_RENDERER_URL not set in dev mode, using fallback:", fallbackUrl);
    mainWindow.loadURL(fallbackUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
let terminalManager = null;
let chatWatcher = null;
let chatArchive = null;
let configWatcher = null;
let memoryPush = null;
electron.app.whenReady().then(() => {
  if (electron.app.isPackaged) {
    electron.app.setAsDefaultProtocolClient("muxvo");
  }
  if (pendingDeepLinkUrl) {
    handleDeepLink(pendingDeepLinkUrl);
    pendingDeepLinkUrl = null;
  }
  const template = [
    { role: "appMenu" },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
  electron.protocol.handle("local-file", (request) => {
    const filePath = decodeURIComponent(request.url.replace("local-file://", ""));
    return electron.net.fetch(url.pathToFileURL(filePath).href);
  });
  initConfigDir(electron.app.getPath("userData"));
  const configManager = createConfigManager();
  configManager.loadConfig();
  const ptyAdapter = createRealPtyAdapter();
  terminalManager = createTerminalManager({ pty: ptyAdapter });
  registerTerminalHandlers(terminalManager, () => {
    saveTerminalConfig(configManager);
  });
  registerChatHandlers();
  registerConfigHandlers();
  registerFsHandlers();
  registerFsWatcherHandlers();
  registerFsImageHandlers();
  registerAppHandlers();
  registerAuthHandlers();
  registerAnalyticsHandlers();
  chatWatcher = createChatWatcher();
  chatArchive = createChatArchiveManager();
  registerChatArchiveHandlers(chatArchive);
  chatWatcher.onSessionUpdate((projectHash, sessionId) => {
    chatArchive?.onSessionUpdate(projectHash, sessionId);
  });
  chatWatcher.start();
  let lastProgressPush = 0;
  chatArchive.start((synced, total) => {
    const now = Date.now();
    if (now - lastProgressPush < 1e3 && synced < total) return;
    lastProgressPush = now;
    electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.CHAT.ARCHIVE_PROGRESS, { synced, total });
      }
    });
  });
  configWatcher = createConfigWatcher();
  configWatcher.start();
  memoryPush = createMemoryPushTimer({ intervalMs: 6e4, thresholdMB: 2048 });
  memoryPush.start();
  electron.ipcMain.handle(IPC_CHANNELS.APP.GET_CONFIG, async () => {
    return { success: true, data: configManager.loadConfig() };
  });
  electron.ipcMain.handle(IPC_CHANNELS.APP.SAVE_CONFIG, async (_event, config) => {
    const result = configManager.saveConfig(config);
    return { success: true, data: result };
  });
  electron.ipcMain.handle(IPC_CHANNELS.APP.INSTALL_UPDATE, () => {
    electronUpdater.autoUpdater.quitAndInstall();
  });
  function launchWindowWithTerminals() {
    const config = configManager.loadConfig();
    createWindow(config.window);
    if (!utils.is.dev) {
      electronUpdater.autoUpdater.logger = null;
      electronUpdater.autoUpdater.autoDownload = true;
      electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
      electronUpdater.autoUpdater.on("checking-for-update", () => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_CHECKING, {});
      });
      electronUpdater.autoUpdater.on("update-available", (info) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_AVAILABLE, {
          version: info.version,
          releaseDate: info.releaseDate
        });
      });
      electronUpdater.autoUpdater.on("update-not-available", () => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_NOT_AVAILABLE, {});
      });
      electronUpdater.autoUpdater.on("download-progress", (progress) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_DOWNLOADING, {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total
        });
      });
      electronUpdater.autoUpdater.on("update-downloaded", (info) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_DOWNLOADED, {
          version: info.version
        });
      });
      electronUpdater.autoUpdater.on("error", (err) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_ERROR, {
          message: err.message
        });
      });
      electronUpdater.autoUpdater.checkForUpdates();
    }
    if (mainWindow) {
      const terminalsToRestore = config.openTerminals && config.openTerminals.length > 0 ? config.openTerminals : null;
      mainWindow.webContents.once("did-finish-load", () => {
        setTimeout(() => {
          if (!terminalManager) return;
          if (terminalsToRestore) {
            console.log("[MUXVO:restore] did-finish-load, restoring " + terminalsToRestore.length + " terminals");
            for (const terminal of terminalsToRestore) {
              const result = terminalManager.spawn({ cwd: terminal.cwd });
              if (result.success && result.id) {
                console.log("[MUXVO:restore] spawned id=" + result.id + " cwd=" + terminal.cwd);
              }
            }
          } else {
            const homePath = require("os").homedir();
            terminalManager.spawn({ cwd: homePath });
            console.log("[MUXVO] fresh start, created terminal at " + homePath);
          }
          const win = electron.BrowserWindow.getAllWindows()[0];
          if (win) {
            const list = terminalManager.list();
            win.webContents.send(IPC_CHANNELS.TERMINAL.LIST_UPDATED, list.map((t) => ({
              id: t.id,
              state: t.state,
              cwd: t.cwd
            })));
          }
          const manager = getAuthManager();
          manager.tryRestoreSession().then((result) => {
            if (result.success && result.user) {
              console.log("[MUXVO:auth] Session restored for user:", result.user.displayName || result.user.email);
              pushToAllWindows(IPC_CHANNELS.AUTH.STATUS_CHANGE, {
                success: true,
                data: {
                  loggedIn: true,
                  user: result.user
                }
              });
            } else {
              console.log("[MUXVO:auth] No session to restore");
            }
          }).catch((err) => {
            console.warn("[MUXVO:auth] Session restore failed:", err);
          });
        }, 500);
      });
    }
  }
  launchWindowWithTerminals();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      launchWindowWithTerminals();
    }
  });
});
function saveTerminalConfig(configManager) {
  if (!terminalManager) return;
  const existing = configManager.loadConfig();
  const terminals = terminalManager.list();
  configManager.saveConfig({
    ...existing,
    openTerminals: terminals.map((t) => ({ cwd: t.cwd }))
  });
}
function saveWindowBoundsAndClearTerminals() {
  if (!lastBounds) return;
  const configManager = createConfigManager();
  const existing = configManager.loadConfig();
  configManager.saveConfig({
    ...existing,
    openTerminals: [],
    window: {
      width: lastBounds.width,
      height: lastBounds.height,
      x: lastBounds.x,
      y: lastBounds.y
    }
  });
}
electron.app.on("window-all-closed", () => {
  if (terminalManager) {
    terminalManager.closeAll();
  }
  if (chatWatcher) {
    chatWatcher.stop();
  }
  if (chatArchive) {
    chatArchive.stop();
  }
  if (configWatcher) {
    configWatcher.stop();
  }
  if (memoryPush) {
    memoryPush.stop();
  }
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
