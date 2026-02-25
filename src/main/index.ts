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

import { app, BrowserWindow, ipcMain, shell, protocol, net, Menu } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { is } from '@electron-toolkit/utils';

// Register custom protocol for serving local files (images, etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, supportFetchAPI: true, stream: true } },
]);
import { createTerminalManager } from './services/terminal/manager';
import { createRealPtyAdapter } from './services/terminal/pty-adapter';
import { registerTerminalHandlers } from './ipc/terminal-handlers';
import { registerChatHandlers, registerChatArchiveHandlers } from './ipc/chat-handlers';
import { registerConfigHandlers } from './ipc/config-handlers';
import { registerFsHandlers } from './ipc/fs-handlers';
import { registerAppHandlers } from './ipc/app-handlers';
import { registerFsWatcherHandlers } from './ipc/fs-watcher-handlers';
import { registerFsImageHandlers } from './ipc/fs-image-handlers';
import { registerAuthHandlers, getAuthManager } from './ipc/auth-handlers';
import { registerAnalyticsHandlers } from './ipc/analytics-handlers';
import { autoUpdater } from 'electron-updater';
import { createChatWatcher } from './services/chat-watcher';
import { createChatArchiveManager } from './services/chat-archive';
import { createConfigWatcher } from './services/config-watcher';
import { createMemoryPushTimer } from './services/perf/memory-push';
import { createSyncStatusPusher } from './services/chat-sync-push';
import { initConfigDir, createConfigManager } from './services/app/config';
import { initPrefsDir } from './services/app/preferences';
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
    });
  } catch (err) {
    console.error('[MUXVO:deeplink] Failed to parse URL:', err);
  }
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
  if (mainWindow) {
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

  // Save full config before window is destroyed (terminals still alive at this point)
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      lastBounds = mainWindow.getBounds();
    }
    // Save window bounds and clear terminal list on normal close.
    // On crash/kill the close event won't fire, so openTerminals stays
    // intact from real-time saves, enabling restore on next launch.
    saveWindowBoundsAndClearTerminals();
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
}

let terminalManager: ReturnType<typeof createTerminalManager> | null = null;
let chatWatcher: ReturnType<typeof createChatWatcher> | null = null;
let chatArchive: ReturnType<typeof createChatArchiveManager> | null = null;
let configWatcher: ReturnType<typeof createConfigWatcher> | null = null;
let memoryPush: ReturnType<typeof createMemoryPushTimer> | null = null;

app.whenReady().then(() => {
  // Register muxvo:// protocol handler (packaged app only; dev uses open-url event)
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('muxvo');
  }

  // Process any deep link URL that arrived before app was ready
  if (pendingDeepLinkUrl) {
    handleDeepLink(pendingDeepLinkUrl);
    pendingDeepLinkUrl = null;
  }

  // Set application menu with Edit menu for copy/paste/select-all shortcuts
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
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+=',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(IPC_CHANNELS.TERMINAL.ZOOM, 'in');
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(IPC_CHANNELS.TERMINAL.ZOOM, 'out');
          },
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CommandOrControl+0',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send(IPC_CHANNELS.TERMINAL.ZOOM, 'reset');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

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

  // Initialize PTY adapter and terminal manager
  const ptyAdapter = createRealPtyAdapter();
  terminalManager = createTerminalManager({ pty: ptyAdapter });

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
    // Throttle: push at most once per second, always push final progress
    if (now - lastProgressPush < 1000 && synced < total) return;
    lastProgressPush = now;
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.CHAT.ARCHIVE_PROGRESS, { synced, total });
      }
    });
  });

  configWatcher = createConfigWatcher();
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

  ipcMain.handle(IPC_CHANNELS.APP.INSTALL_UPDATE, () => {
    autoUpdater.quitAndInstall();
  });

  // Create window and restore terminals from config
  function launchWindowWithTerminals(): void {
    const config = configManager.loadConfig();
    createWindow(config.window);

    // Auto-update (production only)
    if (!is.dev) {
      autoUpdater.logger = null;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on('checking-for-update', () => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_CHECKING, {});
      });
      autoUpdater.on('update-available', (info) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_AVAILABLE, {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      });
      autoUpdater.on('update-not-available', () => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_NOT_AVAILABLE, {});
      });
      autoUpdater.on('download-progress', (progress) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_DOWNLOADING, {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        });
      });
      autoUpdater.on('update-downloaded', (info) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_DOWNLOADED, {
          version: info.version,
        });
      });
      autoUpdater.on('error', (err) => {
        pushToAllWindows(IPC_CHANNELS.APP.UPDATE_ERROR, {
          message: err.message,
        });
      });

      autoUpdater.checkForUpdates();
    }

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
                console.log('[MUXVO:restore] spawned id=' + result.id + ' cwd=' + terminal.cwd);
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
              id: t.id, state: t.state, cwd: t.cwd,
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launchWindowWithTerminals();
    }
  });
});

/** Save terminal list to config (called on terminal create/close) */
function saveTerminalConfig(configManager: ReturnType<typeof createConfigManager>): void {
  if (!terminalManager) return;
  const existing = configManager.loadConfig();
  const terminals = terminalManager.list();
  configManager.saveConfig({
    ...existing,
    openTerminals: terminals.map((t) => ({ cwd: t.cwd })),
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
  // Config already saved in mainWindow 'close' event
  // Clean up all terminal processes
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

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
