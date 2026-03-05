/**
 * Muxvo — Electron Main Process Entry
 * DEV-PLAN A1: Electron 应用骨架搭建
 * DEV-PLAN A6: config.json 持久化
 *
 * Responsibilities:
 * - BrowserWindow creation with security isolation
 * - Window position/size persistence
 * - IPC handler registration (per-domain)
 * - Graceful shutdown of child processes
 * - Config persistence (save on close, restore on launch)
 */

import { app, BrowserWindow, ipcMain, shell, protocol, net, Menu, dialog } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { is } from '@electron-toolkit/utils';

// Register custom protocol for serving local files (images, etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, supportFetchAPI: true, stream: true } },
]);

// Increase GPU memory budget to reduce glyph texture atlas eviction/contention.
// Apple Silicon unified memory makes 4GB safe; default ~512MB can cause
// intermittent glyph corruption when many WebGL contexts + DOM text coexist.
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '4096');

import { createTerminalManager } from './services/terminal/manager';
import { createRealPtyAdapter } from './services/terminal/pty-adapter';
import { registerTerminalHandlers } from './ipc/terminal-handlers';
import { registerChatHandlers, registerChatArchiveHandlers } from './ipc/chat-handlers';
import { registerConfigHandlers } from './ipc/config-handlers';
import { registerFsHandlers } from './ipc/fs-handlers';
import { registerAppHandlers } from './ipc/app-handlers';
import { registerFsWatcherHandlers } from './ipc/fs-watcher-handlers';
import { registerFsImageHandlers } from './ipc/fs-image-handlers';
import { registerAuthHandlers, getAuthManager, configureAuthManager } from './ipc/auth-handlers';
import { registerAnalyticsHandlers } from './ipc/analytics-handlers';
import { registerWorktreeHandlers } from './ipc/worktree-handlers';
import type { AnalyticsTracker } from './services/analytics/tracker';
import { getDeviceId } from './services/analytics/device-id';
import { getDeviceInfo } from './services/analytics/device-info';
import { createBackendClient } from './services/auth/backend-client';
import { autoUpdater } from 'electron-updater';
import { createChatWatcher } from './services/chat-watcher';
import { createChatArchiveManager } from './services/chat-archive';
import { createConfigWatcher } from './services/config-watcher';
import { createMemoryPushTimer } from './services/perf/memory-push';
import { createPerfLogger } from './services/perf/perf-logger';
import { createSyncStatusPusher } from './services/chat-sync-push';
import { initConfigDir, createConfigManager } from './services/app/config';
import type { SavedWorkspace } from '@/shared/types/config.types';
import { calculateGridLayout } from '@/shared/utils/grid-layout';
import { initPrefsDir, getPreferences, savePreferences } from './services/app/preferences';
import { createUpdateLogger } from './services/app/update-logger';
import { IPC_CHANNELS } from '@/shared/constants/channels';

// Prevent EPIPE crash when stdout/stderr pipe is broken (e.g. launched via .app double-click)
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return;
    throw err;
  });
}

let mainWindow: BrowserWindow | null = null;
let lastBounds: Electron.Rectangle | null = null;
let pendingDeepLinkUrl: string | null = null;
let updateDownloaded = false;
let forceClose = false;
let isQuitting = false;
const sessionStartTime = Date.now();

interface WindowConfig {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

function pushToAllWindows(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

/**
 * Deep Link handler: parse muxvo://auth/callback?accessToken=...&refreshToken=...
 * and complete the OAuth login flow.
 */
function handleDeepLink(url: string): void {
  console.log('[MUXVO:deeplink] Handling URL:', url);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'muxvo:') return;
    if (parsed.host !== 'auth' || parsed.pathname !== '/callback') {
      console.warn('[MUXVO:deeplink] Unknown deep link path:', parsed.host, parsed.pathname);
      return;
    }

    const accessToken = parsed.searchParams.get('accessToken');
    const refreshToken = parsed.searchParams.get('refreshToken');
    if (!accessToken || !refreshToken) {
      console.warn('[MUXVO:deeplink] Missing tokens in callback URL');
      return;
    }

    const manager = getAuthManager();
    manager.handleOAuthCallback(accessToken, refreshToken).then((result) => {
      console.log('[MUXVO:deeplink] OAuth callback success');
      pushToAllWindows(IPC_CHANNELS.AUTH.STATUS_CHANGE, {
        success: true,
        data: {
          loggedIn: true,
          user: result.user,
        },
      });
    }).catch((err) => {
      console.error('[MUXVO:deeplink] OAuth callback failed:', err);
      pushToAllWindows(IPC_CHANNELS.AUTH.STATUS_CHANGE, {
        success: false,
        error: err instanceof Error ? err.message : 'OAuth 回调处理失败',
      });
    });
  } catch (err) {
    console.error('[MUXVO:deeplink] Failed to parse URL:', err);
  }
}

// ─── Dev/Production Isolation ───
// Use different app name in dev mode so dev and production instances
// can run simultaneously (separate user data paths & instance locks)
if (!app.isPackaged) {
  app.name = 'Muxvo Dev';
}

// ─── Single Instance Lock ───
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// macOS: open-url can fire before app is ready, so cache the URL
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleDeepLink(url);
  } else {
    pendingDeepLinkUrl = url;
  }
});

// Windows/Linux: second instance receives the deep link URL via argv
app.on('second-instance', (_event, argv) => {
  // Focus existing window
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  // Extract muxvo:// URL from argv
  const deepLinkUrl = argv.find((arg) => arg.startsWith('muxvo://'));
  if (deepLinkUrl) {
    handleDeepLink(deepLinkUrl);
  }
});

function createWindow(windowConfig?: WindowConfig): void {
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: windowConfig?.width ?? 1280,
    height: windowConfig?.height ?? 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  if (windowConfig?.x !== undefined && windowConfig?.y !== undefined) {
    opts.x = windowConfig.x;
    opts.y = windowConfig.y;
  }

  mainWindow = new BrowserWindow(opts);

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Intercept close to show custom confirmation dialog in renderer
  mainWindow.on('close', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      lastBounds = mainWindow.getBounds();
    }

    if (forceClose) {
      // Save window bounds and clear terminal list on confirmed close.
      // On crash/kill the close event won't fire, so openTerminals stays
      // intact from real-time saves, enabling restore on next launch.
      saveWindowBoundsAndClearTerminals();
      return;
    }

    event.preventDefault();
    const terminalCount = terminalManager ? terminalManager.list().length : 0;
    pushToAllWindows(IPC_CHANNELS.APP.CLOSE_REQUESTED, { terminalCount });
  });

  // Right-click context menu with copy support
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];
    if (params.selectionText) {
      menuItems.push({ role: 'copy' });
    }
    if (params.isEditable) {
      menuItems.push({ role: 'cut' }, { role: 'paste' }, { role: 'selectAll' });
    }
    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup();
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Development: load Vite dev server; Production: load built files
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else if (is.dev) {
    // 开发模式但 ELECTRON_RENDERER_URL 未设置，使用默认端口避免加载旧静态文件
    const fallbackUrl = 'http://localhost:5173';
    console.warn('[MUXVO] ELECTRON_RENDERER_URL not set in dev mode, using fallback:', fallbackUrl);
    mainWindow.loadURL(fallbackUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Dev mode: retry on load failure (Vite server may not be ready yet)
  if (is.dev) {
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.warn(`[MUXVO] Page load failed (${errorCode}: ${errorDescription}), retrying in 1s...`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const url = process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173';
          mainWindow.loadURL(url);
        }
      }, 1000);
    });
  }
}

let terminalManager: ReturnType<typeof createTerminalManager> | null = null;
let chatWatcher: ReturnType<typeof createChatWatcher> | null = null;
let chatArchive: ReturnType<typeof createChatArchiveManager> | null = null;
let configWatcher: ReturnType<typeof createConfigWatcher> | null = null;
let memoryPush: ReturnType<typeof createMemoryPushTimer> | null = null;
let perfLogger: ReturnType<typeof createPerfLogger> | null = null;
let tracker: AnalyticsTracker | null = null;

app.whenReady().then(() => {
  // Register muxvo:// protocol handler so OS routes deep links to this app
  app.setAsDefaultProtocolClient('muxvo');

  // Process any deep link URL that arrived before app was ready
  if (pendingDeepLinkUrl) {
    handleDeepLink(pendingDeepLinkUrl);
    pendingDeepLinkUrl = null;
  }

  // Application menu is built after configManager is initialized (see buildAppMenu below)

  // Handle local-file:// protocol for serving local images/files to renderer
  protocol.handle('local-file', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''));
    return net.fetch(pathToFileURL(filePath).href);
  });

  // Initialize config persistence
  initConfigDir(app.getPath('userData'));
  initPrefsDir(app.getPath('userData'));
  const configManager = createConfigManager();
  const savedConfig = configManager.loadConfig();

  // ── Workspace menu (save/restore terminal groups) ──

  function buildAppMenu(workspaces: SavedWorkspace[]): void {
    const workspaceSubmenu: Electron.MenuItemConstructorOptions[] = [
      ...workspaces.map((ws) => ({
        label: `${ws.name}  (${ws.terminals.length})`,
        click: () => restoreWorkspace(ws),
      })),
      ...(workspaces.length > 0 ? [{ type: 'separator' as const }] : []),
      {
        label: '保存当前为工作区',
        click: () => saveCurrentAsWorkspace(),
      },
      ...(workspaces.length > 0
        ? [
            { type: 'separator' as const },
            {
              label: '管理工作区',
              submenu: workspaces.map((ws) => ({
                label: `移除「${ws.name}」`,
                click: () => removeWorkspace(ws.name),
              })),
            } as Electron.MenuItemConstructorOptions,
          ]
        : []),
    ];

    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: '工作区',
        submenu: workspaceSubmenu,
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Zoom In',
            accelerator: 'CommandOrControl+=',
            click: () => {
              BrowserWindow.getFocusedWindow()?.webContents.send(IPC_CHANNELS.APP.ZOOM, 'in');
            },
          },
          {
            label: 'Zoom Out',
            accelerator: 'CommandOrControl+-',
            click: () => {
              BrowserWindow.getFocusedWindow()?.webContents.send(IPC_CHANNELS.APP.ZOOM, 'out');
            },
          },
          {
            label: 'Reset Zoom',
            accelerator: 'CommandOrControl+0',
            click: () => {
              BrowserWindow.getFocusedWindow()?.webContents.send(IPC_CHANNELS.APP.ZOOM, 'reset');
            },
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function restoreWorkspace(ws: SavedWorkspace): void {
    if (!terminalManager || !mainWindow) return;
    const fs = require('fs');
    const logFile = '/tmp/muxvo-workspace.log';
    const log = (msg: string) => { fs.appendFileSync(logFile, msg + '\n'); console.log(msg); };
    log('[WORKSPACE:restore] closing all terminals...');
    terminalManager.closeAll();
    log('[WORKSPACE:restore] spawning ' + ws.terminals.length + ' terminals');
    for (const t of ws.terminals) {
      log('[WORKSPACE:restore] spawn cwd=' + t.cwd + ' customName=' + t.customName);
      const result = terminalManager.spawn({ cwd: t.cwd });
      log('[WORKSPACE:restore] spawn result=' + JSON.stringify(result));
      if (result.success && result.id && t.customName) {
        terminalManager.setName(result.id, t.customName);
      }
    }
    // Notify renderer to refresh terminal list
    const list = terminalManager.list();
    log('[WORKSPACE:restore] final list=' + JSON.stringify(list.map(t => ({ id: t.id, cwd: t.cwd }))));
    mainWindow.webContents.send(IPC_CHANNELS.TERMINAL.LIST_UPDATED, list.map((t) => ({
      id: t.id, state: t.state, cwd: t.cwd, customName: t.customName,
    })));
  }

  function saveCurrentAsWorkspace(): void {
    if (!terminalManager) return;
    const terminals = terminalManager.list();
    console.log('[WORKSPACE:save] terminals=', terminals.map(t => ({ id: t.id, cwd: t.cwd, customName: t.customName })));
    if (terminals.length === 0) return;

    const now = new Date();
    const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const name = `${terminals.length}个终端 - ${timeStr}`;

    const ws: SavedWorkspace = {
      name,
      terminals: terminals.map((t) => ({ cwd: t.cwd, customName: t.customName })),
      savedAt: now.toISOString(),
    };

    const config = configManager.loadConfig();
    const existing = config.savedWorkspaces || [];
    const updated = [ws, ...existing].slice(0, 10);
    configManager.saveConfig({ ...config, savedWorkspaces: updated });
    buildAppMenu(updated);
  }

  function removeWorkspace(name: string): void {
    const config = configManager.loadConfig();
    const updated = (config.savedWorkspaces || []).filter((w) => w.name !== name);
    configManager.saveConfig({ ...config, savedWorkspaces: updated });
    buildAppMenu(updated);
  }

  // Build initial menu with saved workspaces
  buildAppMenu(savedConfig.savedWorkspaces || []);

  // Performance logger (writes to ~/.muxvo/logs/perf.log on anomalies)
  perfLogger = createPerfLogger();

  // Glyph debug log: renderer sends diagnostic data → main writes to glyph-debug.log
  // Used to diagnose intermittent text garbling (CJK glyph corruption).
  // Users send this file when reporting rendering issues.
  {
    const { appendFile, mkdir, stat, readFile, writeFile } = require('fs/promises');
    const glyphLogDir = require('path').join(require('os').homedir(), '.muxvo', 'logs');
    const glyphLogPath = require('path').join(glyphLogDir, 'glyph-debug.log');
    const MAX_LOG_BYTES = 500 * 1024;
    const KEEP_LOG_BYTES = 200 * 1024;

    // Rotate on startup
    mkdir(glyphLogDir, { recursive: true }).then(() =>
      stat(glyphLogPath).then((s: { size: number }) => {
        if (s.size > MAX_LOG_BYTES) {
          return readFile(glyphLogPath, 'utf-8').then((content: string) =>
            writeFile(glyphLogPath, content.slice(-KEEP_LOG_BYTES))
          );
        }
      }).catch(() => {})
    ).catch(() => {});

    ipcMain.on('glyph:log', (_event, data: { message: string }) => {
      if (!data?.message) return;
      const ts = new Date().toISOString();
      const line = `[${ts}] ${data.message}\n`;
      mkdir(glyphLogDir, { recursive: true })
        .then(() => appendFile(glyphLogPath, line))
        .catch(() => {});
    });
  }

  // Terminal debug log: renderer + main → terminal-debug.log
  // Used to diagnose "output invisible after focus switch" bugs.
  let termDebugLogWriter: (line: string) => void = () => {};
  {
    const { appendFile: termAppendFile, mkdir: termMkdir, stat: termStat, readFile: termReadFile, writeFile: termWriteFile } = require('fs/promises');
    const termLogDir = require('path').join(require('os').homedir(), '.muxvo', 'logs');
    const termLogPath = require('path').join(termLogDir, 'terminal-debug.log');
    const TERM_MAX_LOG_BYTES = 500 * 1024;
    const TERM_KEEP_LOG_BYTES = 200 * 1024;

    // Rotate on startup
    termMkdir(termLogDir, { recursive: true }).then(() =>
      termStat(termLogPath).then((s: { size: number }) => {
        if (s.size > TERM_MAX_LOG_BYTES) {
          return termReadFile(termLogPath, 'utf-8').then((content: string) =>
            termWriteFile(termLogPath, content.slice(-TERM_KEEP_LOG_BYTES))
          );
        }
      }).catch(() => {})
    ).catch(() => {});

    termDebugLogWriter = (line: string) => {
      const ts = new Date().toISOString();
      const fullLine = `[${ts}] ${line}\n`;
      termMkdir(termLogDir, { recursive: true })
        .then(() => termAppendFile(termLogPath, fullLine))
        .catch(() => {});
    };

    ipcMain.on(IPC_CHANNELS.TERMINAL.DEBUG_LOG, (_event, data: { message: string }) => {
      if (!data?.message) return;
      termDebugLogWriter(data.message);
    });
  }

  // Renderer perf log relay: renderer sends perf data → main writes to log file
  ipcMain.on(IPC_CHANNELS.PERF.LOG, (_event, data: { message: string }) => {
    if (data?.message) {
      perfLogger?.track('ipcPush'); // count as IPC activity
      const { appendFile, mkdir } = require('fs/promises');
      const logDir = require('path').join(require('os').homedir(), '.muxvo', 'logs');
      const logPath = require('path').join(logDir, 'perf.log');
      const timestamp = new Date().toISOString();
      const line = `[${timestamp}] [RENDERER] ${data.message}\n`;
      mkdir(logDir, { recursive: true })
        .then(() => appendFile(logPath, line))
        .catch(() => {});
      console.warn('[MUXVO:renderer-perf]', data.message);
    }
  });

  // Initialize PTY adapter and terminal manager
  const ptyAdapter = createRealPtyAdapter();
  terminalManager = createTerminalManager({ pty: ptyAdapter, perfLogger, debugLogger: termDebugLogWriter });

  // Register terminal IPC handlers (with config save on terminal change)
  registerTerminalHandlers(terminalManager, () => {
    saveTerminalConfig(configManager);
  });

  // Register chat IPC handlers
  registerChatHandlers();
  registerConfigHandlers();
  registerFsHandlers();
  registerFsWatcherHandlers();
  registerFsImageHandlers();
  registerAppHandlers();
  registerAuthHandlers();
  registerWorktreeHandlers();

  // Create backend client for analytics upload
  const isProduction = app?.isPackaged ?? false;
  const backendUrl = process.env.MUXVO_API_URL
    || (isProduction ? 'https://api.muxvo.com' : 'http://localhost:3100');
  const analyticsBackendClient = createBackendClient({ baseUrl: backendUrl });

  // Re-send heartbeat after login so server can associate user_id with device
  configureAuthManager({
    onLoginSuccess: async () => {
      try {
        const deviceId = getDeviceId();
        const deviceInfo = getDeviceInfo();
        const accessToken = await getAuthManager().getAccessToken() ?? undefined;
        await analyticsBackendClient.deviceHeartbeat(deviceId, deviceInfo, accessToken);
      } catch (err) {
        console.warn('[MUXVO:device] Post-login heartbeat failed:', err);
      }
    },
  });

  const uploadToServer = async (events: Array<{ metric: string; value?: number; metadata?: object }>) => {
    try {
      const deviceId = getDeviceId();
      const accessToken = await getAuthManager().getAccessToken() ?? undefined;
      const result = await analyticsBackendClient.trackAnalytics(deviceId, events, accessToken);
      return result.success;
    } catch {
      return false;
    }
  };

  ({ tracker } = registerAnalyticsHandlers({ upload: uploadToServer }));

  chatWatcher = createChatWatcher({ perfLogger: perfLogger! });
  chatArchive = createChatArchiveManager();
  registerChatArchiveHandlers(chatArchive);
  chatWatcher.onSessionUpdate((projectHash, sessionId) => {
    chatArchive?.onSessionUpdate(projectHash, sessionId);
  });
  chatWatcher.start();
  let lastProgressPush = 0;
  chatArchive.start((synced, total) => {
    const now = Date.now();
    // Throttle: push at most once per second, always push final progress
    if (now - lastProgressPush < 1000 && synced < total) return;
    lastProgressPush = now;
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.CHAT.ARCHIVE_PROGRESS, { synced, total });
      }
    });
  });

  configWatcher = createConfigWatcher({ perfLogger: perfLogger! });
  configWatcher.start();

  // Memory warning push (60s interval, 2GB threshold)
  memoryPush = createMemoryPushTimer({ intervalMs: 60000, thresholdMB: 2048 });
  memoryPush.start();

  // Sync status pusher (available for sync operations to report progress)
  const _syncPusher = createSyncStatusPusher();

  // Register app config IPC handlers
  ipcMain.handle(IPC_CHANNELS.APP.GET_CONFIG, async () => {
    return { success: true, data: configManager.loadConfig() };
  });

  ipcMain.handle(IPC_CHANNELS.APP.SAVE_CONFIG, async (_event, config) => {
    const result = configManager.saveConfig(config);
    return { success: true, data: result };
  });

  // Close confirmation: renderer confirms → main proceeds with close
  ipcMain.handle(IPC_CHANNELS.APP.CONFIRM_CLOSE, () => {
    forceClose = true;
    saveWindowBoundsAndClearTerminals();
    if (isQuitting) {
      app.quit();
    } else {
      mainWindow?.close();
    }
  });
  ipcMain.handle(IPC_CHANNELS.APP.CANCEL_CLOSE, () => {
    isQuitting = false;
  });

  // INSTALL_UPDATE handler removed — update installs automatically on next quit

  // Auto-update setup (registered once, outside launchWindowWithTerminals to avoid duplicate registration on macOS activate)
  // Flow: detect → native dialog → user approves → silent download → auto-install on next quit
  // Max 3 prompts per version (initial + 4h + 1d). "Don't remind" skips permanently. Persisted across restarts.
  if (!is.dev) {
    autoUpdater.logger = createUpdateLogger();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    const DISMISS_PREF_KEY = 'updateDismissal';
    let updateDismissCount = 0;
    let dismissedVersion = '';
    let updateReminderTimer: ReturnType<typeof setTimeout> | null = null;
    let isPromptingUpdate = false;
    const REMIND_INTERVALS = [4 * 3600_000, 24 * 3600_000]; // 4h, 1d

    // Restore dismiss state from preferences
    getPreferences().then((prefs) => {
      const saved = prefs.preferences[DISMISS_PREF_KEY] as { version: string; count: number } | undefined;
      if (saved) {
        dismissedVersion = saved.version;
        updateDismissCount = saved.count;
        console.log('[MUXVO:update] Restored dismiss state:', saved);
      }
    }).catch(() => {});

    /** Push initial downloading state so UpdateProgress becomes visible immediately */
    function pushDownloadStart(): void {
      pushToAllWindows(IPC_CHANNELS.APP.UPDATE_DOWNLOADING, {
        percent: 0, bytesPerSecond: 0, transferred: 0, total: 0,
      });
    }

    async function promptUpdate(version: string): Promise<void> {
      if (isPromptingUpdate) return;
      isPromptingUpdate = true;
      try {
        console.log('[MUXVO:update] promptUpdate dialog shown for', version);
        const { response } = await dialog.showMessageBox({
          type: 'info',
          title: 'Muxvo 有可用更新',
          message: `发现新版本 v${version}`,
          detail: '是否立即下载？下载完成后将在下次启动时自动更新。',
          buttons: ['立即下载', '暂不更新', '不再提醒此版本'],
          defaultId: 0,
          cancelId: 1,
        });
        console.log('[MUXVO:update] promptUpdate response:', response);
        if (response === 0) {
          pushDownloadStart();
          autoUpdater.downloadUpdate().catch((err) => {
            console.error('[MUXVO:update] downloadUpdate failed:', err);
            pushToAllWindows(IPC_CHANNELS.APP.UPDATE_ERROR, { message: String(err) });
          });
        } else if (response === 2) {
          // "Don't remind for this version" → permanently skip
          updateDismissCount = 999;
          savePreferences({ [DISMISS_PREF_KEY]: { version, count: 999 } });
          console.log('[MUXVO:update] User chose "don\'t remind" for', version);
        } else {
          updateDismissCount++;
          savePreferences({ [DISMISS_PREF_KEY]: { version, count: updateDismissCount } });
          if (updateDismissCount <= REMIND_INTERVALS.length) {
            const delay = REMIND_INTERVALS[updateDismissCount - 1];
            updateReminderTimer = setTimeout(() => promptUpdate(version), delay);
          }
        }
      } finally {
        isPromptingUpdate = false;
      }
    }

    autoUpdater.on('update-available', (info) => {
      console.log('[MUXVO:update] update-available:', info.version);
      if (updateReminderTimer) clearTimeout(updateReminderTimer);

      if (info.version !== dismissedVersion) {
        // New version → reset dismiss count
        updateDismissCount = 0;
        dismissedVersion = info.version;
        savePreferences({ [DISMISS_PREF_KEY]: { version: info.version, count: 0 } });
      }

      pushToAllWindows(IPC_CHANNELS.APP.UPDATE_AVAILABLE, { version: info.version, releaseDate: info.releaseDate || '' });

      // Already dismissed enough times → don't prompt again
      if (updateDismissCount > REMIND_INTERVALS.length) {
        console.log('[MUXVO:update] Skipping prompt, dismissed', updateDismissCount, 'times for', info.version);
        return;
      }
      promptUpdate(info.version);
    });

    autoUpdater.on('download-progress', (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(progress.percent / 100);
      }
      pushToAllWindows(IPC_CHANNELS.APP.UPDATE_DOWNLOADING, {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', async (info) => {
      console.log('[MUXVO:update] update-downloaded:', info.version, 'file:', (info as any).downloadedFile || 'unknown');
      updateDownloaded = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
      pushToAllWindows(IPC_CHANNELS.APP.UPDATE_DOWNLOADED, { version: info.version });

      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: '下载完成',
        message: `v${info.version} 已下载完成`,
        detail: '立即重启安装，还是下次启动时自动安装？',
        buttons: ['立即重启', '下次启动时安装'],
        defaultId: 0,
        cancelId: 1,
      });
      console.log('[MUXVO:update] install dialog response:', response);
      if (response === 0) {
        console.log('[MUXVO:update] User chose restart, calling quitAndInstall');
        // setImmediate avoids SIGABRT from calling quit inside dialog callback stack
        setImmediate(() => {
          forceClose = true;
          autoUpdater.quitAndInstall(false, true);
        });
      }
    });

    autoUpdater.on('error', (err) => {
      console.error('[MUXVO:update] error:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
      pushToAllWindows(IPC_CHANNELS.APP.UPDATE_ERROR, { message: err.message });
    });

    // IPC handlers for renderer-initiated update actions (production)
    ipcMain.handle(IPC_CHANNELS.APP.CHECK_FOR_UPDATE, () => autoUpdater.checkForUpdates());
    ipcMain.handle(IPC_CHANNELS.APP.DOWNLOAD_UPDATE, () => {
      pushDownloadStart();
      return autoUpdater.downloadUpdate().catch((err) => {
        console.error('[MUXVO:update] downloadUpdate failed:', err);
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_ERROR, { message: String(err) });
      });
    });

    app.on('before-quit', () => {
      console.log('[MUXVO:update] before-quit, autoInstallOnAppQuit =', autoUpdater.autoInstallOnAppQuit);
    });

    autoUpdater.checkForUpdates();

    // Periodic update check every 1 hour
    setInterval(() => {
      console.log('[MUXVO:update] Periodic update check');
      autoUpdater.checkForUpdates().catch(() => {});
    }, 60 * 60 * 1000);
  } else {
    // Dev mode: register no-op handlers so renderer doesn't get unhandled errors
    ipcMain.handle(IPC_CHANNELS.APP.CHECK_FOR_UPDATE, () => null);
    ipcMain.handle(IPC_CHANNELS.APP.DOWNLOAD_UPDATE, () => null);
  }

  // Create window and restore terminals from config
  function launchWindowWithTerminals(): void {
    const config = configManager.loadConfig();
    createWindow(config.window);

    // Restore terminals or create a fresh one after renderer is ready
    if (mainWindow) {
      const terminalsToRestore = config.openTerminals && config.openTerminals.length > 0
        ? config.openTerminals
        : null;

      mainWindow.webContents.once('did-finish-load', () => {
        // Delay to ensure React has mounted and xterm useEffect listeners are active
        setTimeout(() => {
          if (!terminalManager) return;

          if (terminalsToRestore) {
            // Crash recovery: restore previous terminals
            console.log('[MUXVO:restore] did-finish-load, restoring ' + terminalsToRestore.length + ' terminals');
            for (const terminal of terminalsToRestore) {
              const result = terminalManager.spawn({ cwd: terminal.cwd });
              if (result.success && result.id) {
                if (terminal.customName) {
                  terminalManager.setName(result.id, terminal.customName);
                }
                console.log('[MUXVO:restore] spawned id=' + result.id + ' cwd=' + terminal.cwd + (terminal.customName ? ' name=' + terminal.customName : ''));
              }
            }
          } else {
            // Normal start: create terminals based on config
            const homePath = require('os').homedir();
            const count = Math.max(1, Math.min(20, config.startupTerminalCount ?? 1));
            for (let i = 0; i < count; i++) {
              terminalManager.spawn({ cwd: homePath });
            }
            console.log('[MUXVO] fresh start, created ' + count + ' terminal(s) at ' + homePath);
          }

          // Notify renderer to refresh terminal list
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            const list = terminalManager.list();
            win.webContents.send(IPC_CHANNELS.TERMINAL.LIST_UPDATED, list.map((t) => ({
              id: t.id, state: t.state, cwd: t.cwd, customName: t.customName,
            })));
          }

          // Restore auth session from stored tokens (§6.3 / §7.4)
          // Runs after renderer is ready so push events can be received.
          // On failure (expired token + refresh failure), silently stays logged out.
          const manager = getAuthManager();
          manager.tryRestoreSession().then((result) => {
            if (result.success && result.user) {
              console.log('[MUXVO:auth] Session restored for user:', result.user.displayName || result.user.email);
              pushToAllWindows(IPC_CHANNELS.AUTH.STATUS_CHANGE, {
                success: true,
                data: {
                  loggedIn: true,
                  user: result.user,
                },
              });
            } else {
              console.log('[MUXVO:auth] No session to restore');
            }
          }).catch((err) => {
            console.warn('[MUXVO:auth] Session restore failed:', err);
          });
        }, 500);
      });
    }
  }

  launchWindowWithTerminals();

  // Analytics: track session start
  tracker?.track({
    event: 'session.start',
    params: { version: app.getVersion(), platform: process.platform, restored_count: 0 },
  });

  // Device heartbeat: register device info and check blocked status
  (async () => {
    try {
      const deviceInfo = getDeviceInfo();
      const deviceId = getDeviceId();
      const accessToken = await getAuthManager().getAccessToken().catch(() => null) ?? undefined;
      const result = await analyticsBackendClient.deviceHeartbeat(deviceId, deviceInfo, accessToken);

      if (result?.status === 'blocked' && mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBoxSync(mainWindow, {
          type: 'error',
          title: '设备已被限制',
          message: '此设备已被管理员禁止使用 Muxvo。',
          detail: '如有疑问请联系支持。',
          buttons: ['退出'],
        });
        forceClose = true;
        app.quit();
      }
    } catch (err) {
      console.warn('[MUXVO:device] Heartbeat failed:', err);
    }
  })();

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      forceClose = false;
      isQuitting = false;
      // Restart lightweight services stopped by window-all-closed
      chatWatcher?.start();
      configWatcher?.start();
      memoryPush?.start();
      launchWindowWithTerminals();
    }
  });
});

/** Save terminal list to config (called on terminal create/close) */
function saveTerminalConfig(configManager: ReturnType<typeof createConfigManager>): void {
  if (!terminalManager) return;
  const existing = configManager.loadConfig();
  const terminals = terminalManager.list();
  const { cols, rows } = calculateGridLayout(terminals.length);
  configManager.saveConfig({
    ...existing,
    openTerminals: terminals.map((t) => ({
      cwd: t.cwd,
      customName: t.customName,
    })),
    gridLayout: {
      columnRatios: Array(cols).fill(1),
      rowRatios: Array(rows).fill(1),
    },
  });
}

/** Save window bounds and clear terminal list on normal close.
 *  Clearing openTerminals ensures a fresh start on next launch.
 *  If the app crashes, this function never runs, so the real-time
 *  saved terminal list remains and will be restored on next launch. */
function saveWindowBoundsAndClearTerminals(): void {
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
      y: lastBounds.y,
    },
  });
}

app.on('window-all-closed', () => {
  // Analytics: track session end
  tracker?.track({
    event: 'session.end',
    params: {
      duration_sec: Math.floor((Date.now() - sessionStartTime) / 1000),
      terminal_count: terminalManager ? terminalManager.list().length : 0,
    },
  });

  // Config already saved in mainWindow 'close' event
  // Clean up all terminal processes (prevent pty leaks)
  if (terminalManager) {
    terminalManager.closeAll();
  }

  if (process.platform !== 'darwin') {
    // Non-macOS: full cleanup and quit
    chatWatcher?.stop();
    chatArchive?.stop();
    configWatcher?.stop();
    memoryPush?.stop();
    perfLogger?.dispose();
    tracker?.flush();
    tracker?.dispose();
    app.quit();
  } else {
    // macOS no update: stop lightweight services (restarted on activate), keep app running
    chatWatcher?.stop();
    configWatcher?.stop();
    memoryPush?.stop();
    perfLogger?.dispose();
  }
});
