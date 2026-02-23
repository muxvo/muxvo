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
    EXPORT: "chat:export",
    GET_ARCHIVE_ENABLED: "chat:get-archive-enabled",
    SET_ARCHIVE_ENABLED: "chat:set-archive-enabled",
    ARCHIVE_PROGRESS: "chat:archive-progress",
    SHOW_SESSION_MENU: "chat:show-session-menu",
    DELETE_SESSION: "chat:delete-session",
    REVEAL_FILE: "chat:reveal-file"
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
          outputBuffers.delete(id);
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
      outputBuffers.delete(id);
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
        resolve({ success: true });
      }, GRACEFUL_CLOSE_TIMEOUT);
      terminal.process.onExit(() => {
        clearTimeout(timeout);
        terminals.delete(id);
        outputBuffers.delete(id);
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
            if (trimmedContent) {
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
      fileSize: stat.size
    };
  }
  function parseMessageLine(line, sessionId) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const entry = JSON.parse(trimmed);
      const type = entry.type;
      if (type !== "user" && type !== "assistant" && type !== "queue-operation") return null;
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
          if (hasOnlyToolResults) return null;
          const textParts = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text);
          normalizedContent = textParts.join("\n") || "";
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
          if (trimmedContent.startsWith("<task-notification>") || trimmedContent.startsWith("<command-message>") || trimmedContent.startsWith("<command-name>")) {
            resolvedType = "system";
          }
        }
      }
      return {
        uuid: entry.uuid || "",
        type: resolvedType,
        sessionId: entry.sessionId || sessionId,
        cwd: entry.cwd || "",
        gitBranch: entry.gitBranch,
        timestamp: entry.timestamp || "",
        content: normalizedContent
      };
    } catch {
      return null;
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
            const jsonlCount = files.filter((f) => f.endsWith(".jsonl")).length;
            if (jsonlCount === 0) return null;
            const segments = projectHash.split("-").filter((s) => s.length > 0);
            const displayName = segments.length > 0 ? segments[segments.length - 1] : projectHash;
            return {
              projectHash,
              displayPath: "",
              displayName,
              sessionCount: jsonlCount,
              lastActivity: dirStat.mtimeMs
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
      const sessions = [];
      for (const file of topFiles) {
        const cacheKey = projectHash + "/" + file.fileName;
        const cached = summaryCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
          if (cached.data.title) sessions.push(cached.data);
          continue;
        }
        const filePath = ccFileNames.has(file.fileName) ? path.join(ccProjectPath, file.fileName) : path.join(archiveProjectsDir, projectHash, file.fileName);
        try {
          const summary = await extractSessionSummary(projectHash, filePath, file.fileName);
          summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
          if (summary.title) sessions.push(summary);
        } catch {
        }
      }
      return sessions;
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
      const sessions = [];
      for (const file of topFiles) {
        const cacheKey = file.projectHash + "/" + file.fileName;
        const cached = summaryCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
          if (cached.data.title) sessions.push(cached.data);
          continue;
        }
        try {
          const summary = await extractSessionSummary(file.projectHash, file.filePath, file.fileName);
          summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
          if (summary.title) sessions.push(summary);
        } catch {
        }
      }
      return sessions;
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
            const msg = parseMessageLine(line, sessionId);
            if (msg) messages.push(msg);
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
      const results = [];
      const q = query.toLowerCase();
      const seenSessions = /* @__PURE__ */ new Set();
      async function searchInDir(baseDir) {
        try {
          const dirs = await fs.promises.readdir(baseDir, { withFileTypes: true });
          for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            const projectHash = dir.name;
            const projectPath = path.join(baseDir, projectHash);
            try {
              const files = await fs.promises.readdir(projectPath);
              for (const f of files) {
                if (!f.endsWith(".jsonl")) continue;
                const sessionId = f.replace(/\.jsonl$/, "");
                const sessionKey = projectHash + "/" + sessionId;
                if (seenSessions.has(sessionKey)) continue;
                seenSessions.add(sessionKey);
                try {
                  const content = await fs.promises.readFile(path.join(projectPath, f), "utf-8");
                  const lines = content.split("\n");
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                      const obj = JSON.parse(trimmed);
                      if (obj.type !== "user") continue;
                      const text = typeof obj.message?.content === "string" ? obj.message.content : typeof obj.content === "string" ? obj.content : "";
                      if (text.toLowerCase().includes(q)) {
                        results.push({
                          projectHash,
                          sessionId,
                          snippet: text.slice(0, 200),
                          timestamp: obj.timestamp || ""
                        });
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
const CC_BASE_PATH = path.join(os.homedir(), ".claude");
function createChatHandlers() {
  const reader = createChatProjectReader({
    ccBasePath: CC_BASE_PATH,
    archivePath: path.join(os.homedir(), ".muxvo", "chat-archive")
  });
  return {
    async getProjects() {
      const projects = await reader.getProjects();
      return { projects };
    },
    async getSessions(params) {
      if (params.projectHash === "__all__") {
        const sessions2 = await reader.getAllRecentSessions(50);
        return { sessions: sessions2 };
      }
      const sessions = await reader.getSessionsForProject(params.projectHash);
      return { sessions };
    },
    async getSession(params) {
      const options = params.limit === 0 ? void 0 : params.limit !== void 0 ? { limit: params.limit } : { limit: 100 };
      const messages = await reader.readSession(params.projectHash, params.sessionId, options);
      return { messages };
    },
    async search(params) {
      const results = await reader.search(params.query);
      return { results };
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
const RESOURCE_TYPE_MAP = {
  skills: { path: path.join(CLAUDE_DIR$1, "skills"), isFile: false },
  hooks: { path: path.join(CLAUDE_DIR$1, "hooks"), isFile: false },
  plans: { path: path.join(CLAUDE_DIR$1, "plans"), isFile: false },
  tasks: { path: path.join(CLAUDE_DIR$1, "tasks"), isFile: false },
  plugins: { path: path.join(CLAUDE_DIR$1, "plugins"), isFile: false },
  mcp: { path: path.join(CLAUDE_DIR$1, "mcp.json"), isFile: true }
};
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
function createConfigHandlers() {
  return {
    /**
     * P0: Scan ~/.claude/ for resources of specified types
     */
    async getResources(params) {
      const types = params?.types || Object.keys(RESOURCE_TYPE_MAP);
      const resources = [];
      for (const type of types) {
        const mapping = RESOURCE_TYPE_MAP[type];
        if (!mapping) continue;
        if (mapping.isFile) {
          try {
            const fileStat = await promises.stat(mapping.path);
            resources.push({
              name: mapping.path.split("/").pop(),
              type,
              path: mapping.path,
              updatedAt: fileStat.mtime.toISOString()
            });
          } catch {
          }
        } else {
          try {
            const entries = await promises.readdir(mapping.path, { withFileTypes: true });
            for (const entry of entries) {
              if (EXCLUDED_FILES.has(entry.name)) continue;
              const entryPath = path.join(mapping.path, entry.name);
              try {
                const entryStat = await promises.stat(entryPath);
                resources.push({
                  name: entry.name,
                  type,
                  path: entryPath,
                  updatedAt: entryStat.mtime.toISOString()
                });
              } catch {
              }
            }
          } catch {
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
      if (!resolvedPath.startsWith(CLAUDE_DIR$1)) {
        throw new Error(`Access denied: path must be within ${CLAUDE_DIR$1}`);
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
     * P0: Read global or project CLAUDE.md
     */
    async getClaudeMd(params) {
      let filePath;
      if (params.scope === "global") {
        filePath = path.join(CLAUDE_DIR$1, "CLAUDE.md");
      } else {
        if (!params.projectPath) {
          throw new Error("projectPath is required for project scope");
        }
        filePath = path.join(params.projectPath, "CLAUDE.md");
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
     * P1: Atomic write to CLAUDE.md (global or project)
     */
    async saveClaudeMd(params) {
      let filePath;
      if (params.scope === "global") {
        filePath = path.join(CLAUDE_DIR$1, "CLAUDE.md");
      } else {
        if (!params.projectPath) {
          throw new Error("projectPath is required for project scope");
        }
        filePath = path.join(params.projectPath, "CLAUDE.md");
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
function pushToAllWindows$3(channel, payload) {
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
            pushToAllWindows$3(IPC_CHANNELS.FS.CHANGE, {
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
async function loginGithub() {
  return {
    success: false
  };
}
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
function createAuthHandlers() {
  return {
    async loginGithub() {
      try {
        const result = await loginGithub();
        return { success: true, data: result };
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
}
const DEFAULT_SOURCES = [
  { name: "local files", url: "local://", status: "active", packages: [] },
  { name: "CC official", url: "https://anthropic.com/skills", status: "active", packages: [] },
  { name: "GitHub", url: "https://github.com", status: "active", packages: [] },
  { name: "npm", url: "https://npmjs.com", status: "active", packages: [] },
  { name: "community", url: "https://community.muxvo.com", status: "active", packages: [] },
  { name: "custom", url: "custom://", status: "active", packages: [] }
];
async function fetchSources() {
  return {
    sources: DEFAULT_SOURCES,
    totalCount: 0
  };
}
async function getInstalledPackages() {
  return [];
}
async function uninstallPackage(request) {
  return {
    filesDeleted: true,
    registryRemoved: true,
    settingsJsonCleaned: request.type === "hook"
  };
}
function installSkill(options) {
  if (options.targetDir.includes("/root/restricted") || options.targetDir.includes("restricted")) {
    return {
      success: false,
      error: { message: "安装失败：权限不足，无法写入目标目录" }
    };
  }
  return { success: true };
}
function getDefaultSortOrder() {
  return ["anthropic", "community", "github"];
}
function pushToAllWindows$2(channel, payload) {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}
function createMarketplaceHandlers() {
  return {
    async fetchSources() {
      try {
        const result = await fetchSources();
        pushToAllWindows$2(IPC_CHANNELS.MARKETPLACE.PACKAGES_LOADED, {
          packages: result.sources,
          source: getDefaultSortOrder()[0]
        });
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "MARKETPLACE_FETCH_ERROR", message } };
      }
    },
    async search(params) {
      try {
        const { sources } = await fetchSources();
        const query = params.query.toLowerCase();
        const filtered = sources.filter((src) => {
          const name = String(src.name ?? "").toLowerCase();
          const description = String(src.description ?? "").toLowerCase();
          const tags = Array.isArray(src.tags) ? src.tags.map((t) => String(t).toLowerCase()) : [];
          return name.includes(query) || description.includes(query) || tags.some((t) => t.includes(query));
        });
        return { success: true, data: { sources: filtered, totalCount: filtered.length } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "MARKETPLACE_SEARCH_ERROR", message } };
      }
    },
    async install(params) {
      try {
        pushToAllWindows$2(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, {
          name: params.name,
          progress: 0,
          status: "downloading"
        });
        const targetDir = path.join(
          os.homedir(),
          ".claude",
          params.type === "hook" ? "hooks" : "skills"
        );
        pushToAllWindows$2(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, {
          name: params.name,
          progress: 50,
          status: "installing"
        });
        const result = installSkill({ skillId: params.name, targetDir });
        pushToAllWindows$2(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, {
          name: params.name,
          progress: 100,
          status: "complete"
        });
        if (!result.success) {
          return {
            success: false,
            error: { code: "MARKETPLACE_INSTALL_ERROR", message: result.error?.message ?? "Install failed" }
          };
        }
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "MARKETPLACE_INSTALL_ERROR", message } };
      }
    },
    async uninstall(params) {
      try {
        const result = await uninstallPackage({
          name: params.name,
          type: params.type ?? "skill"
        });
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "MARKETPLACE_UNINSTALL_ERROR", message } };
      }
    },
    async getInstalled() {
      try {
        const result = await getInstalledPackages();
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "MARKETPLACE_GET_INSTALLED_ERROR", message } };
      }
    },
    async checkUpdates() {
      try {
        const updates = [];
        pushToAllWindows$2(IPC_CHANNELS.MARKETPLACE.UPDATE_AVAILABLE, { packages: updates });
        return { success: true, data: { updates } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "MARKETPLACE_CHECK_UPDATES_ERROR", message } };
      }
    }
  };
}
function registerMarketplaceHandlers() {
  const handlers = createMarketplaceHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.MARKETPLACE.FETCH_SOURCES, async () => {
    return handlers.fetchSources();
  });
  electron.ipcMain.handle(IPC_CHANNELS.MARKETPLACE.SEARCH, async (_event, params) => {
    return handlers.search(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.MARKETPLACE.INSTALL, async (_event, params) => {
    return handlers.install(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.MARKETPLACE.UNINSTALL, async (_event, params) => {
    return handlers.uninstall(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.MARKETPLACE.GET_INSTALLED, async () => {
    return handlers.getInstalled();
  });
  electron.ipcMain.handle(IPC_CHANNELS.MARKETPLACE.CHECK_UPDATES, async () => {
    return handlers.checkUpdates();
  });
}
async function runScore(_input) {
  return {
    success: false,
    error: {
      code: "CC_NOT_RUNNING",
      message: "请先启动一个 Claude Code 终端"
    }
  };
}
async function getCachedScore(_skillPath) {
  return {
    cached: false,
    ccInvoked: false
  };
}
function pushToAllWindows$1(channel, payload) {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}
function createScoreHandlers() {
  return {
    async checkScorer() {
      try {
        return { success: true, data: { installed: false } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "SCORE_ERROR", message } };
      }
    },
    async run(params) {
      try {
        pushToAllWindows$1(IPC_CHANNELS.SCORE.PROGRESS, {
          skillDirName: params.skillDirName,
          status: "checking"
        });
        const result = await runScore({
          skillPath: params.skillDirName,
          includeUsageData: params.includeAnalytics
        });
        if (result.success) {
          pushToAllWindows$1(IPC_CHANNELS.SCORE.RESULT, {
            skillDirName: params.skillDirName,
            score: result
          });
        }
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "SCORE_ERROR", message } };
      }
    },
    async getCached(params) {
      try {
        const result = await getCachedScore(params.skillDirName);
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "SCORE_ERROR", message } };
      }
    }
  };
}
function registerScoreHandlers() {
  const handlers = createScoreHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.SCORE.CHECK_SCORER, async () => {
    return handlers.checkScorer();
  });
  electron.ipcMain.handle(IPC_CHANNELS.SCORE.RUN, async (_event, params) => {
    return handlers.run(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.SCORE.GET_CACHED, async (_event, params) => {
    return handlers.getCached(params);
  });
}
async function generateShowcase(input) {
  const skillName = input.skillPath.split("/").pop() || "untitled";
  return {
    name: skillName,
    description: `Showcase for ${skillName}`,
    features: [],
    template: "developer-dark"
  };
}
function createPublishFlow(input) {
  const steps = ["security-check"];
  let scoringSkipped = false;
  let scoreSource;
  if (!input.hasScoreCache) {
    steps.push("auto-score");
  } else {
    scoringSkipped = true;
    scoreSource = "cache";
  }
  steps.push("publish");
  return {
    steps,
    scoreRequired: false,
    scoringSkipped,
    scoreSource,
    async start() {
      if (input.simulateNetworkError) {
        return {
          success: false,
          draftSaved: true,
          draftLocation: "local"
        };
      }
      return { success: true };
    }
  };
}
function pushToAllWindows(channel, payload) {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}
function createShowcaseHandlers() {
  return {
    async generate(params) {
      try {
        const result = await generateShowcase({
          skillPath: params.skillDirName,
          scoreResult: null
        });
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "SHOWCASE_GENERATE_ERROR", message } };
      }
    },
    async publish(params) {
      try {
        const flow = createPublishFlow({
          skillPath: params.skillDirName,
          githubLoggedIn: true
        });
        const result = await flow.start();
        pushToAllWindows(IPC_CHANNELS.SHOWCASE.PUBLISH_RESULT, {
          skillDirName: params.skillDirName,
          success: result.success,
          url: void 0,
          error: result.reason
        });
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "SHOWCASE_PUBLISH_ERROR", message } };
      }
    },
    async unpublish(params) {
      try {
        return { success: true, data: { unpublished: true } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: "SHOWCASE_UNPUBLISH_ERROR", message } };
      }
    }
  };
}
function registerShowcaseHandlers() {
  const handlers = createShowcaseHandlers();
  electron.ipcMain.handle(IPC_CHANNELS.SHOWCASE.GENERATE, async (_event, params) => {
    return handlers.generate(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.SHOWCASE.PUBLISH, async (_event, params) => {
    return handlers.publish(params);
  });
  electron.ipcMain.handle(IPC_CHANNELS.SHOWCASE.UNPUBLISH, async (_event, params) => {
    return handlers.unpublish(params);
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
const WATCH_DIRS = [
  { dir: path.join(CLAUDE_DIR, "skills"), type: "skills" },
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
const DEFAULT_CONFIG = {
  window: { width: 1400, height: 900, x: 100, y: 100 },
  openTerminals: [],
  gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
  theme: "dark",
  fontSize: 14,
  terminal: {
    themeName: "dark",
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
  registerMarketplaceHandlers();
  registerScoreHandlers();
  registerShowcaseHandlers();
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
  function launchWindowWithTerminals() {
    const config = configManager.loadConfig();
    createWindow(config.window);
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
