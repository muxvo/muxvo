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

import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { createTerminalManager } from './services/terminal/manager';
import { createRealPtyAdapter } from './services/terminal/pty-adapter';
import { registerTerminalHandlers } from './ipc/terminal-handlers';
import { registerChatHandlers } from './ipc/chat-handlers';
import { registerConfigHandlers } from './ipc/config-handlers';
import { registerFsHandlers } from './ipc/fs-handlers';
import { registerAppHandlers } from './ipc/app-handlers';
import { createChatWatcher } from './services/chat-watcher';
import { initConfigDir, createConfigManager } from './services/app/config';
import { IPC_CHANNELS } from '@/shared/constants/channels';

let mainWindow: BrowserWindow | null = null;
let lastBounds: Electron.Rectangle | null = null;

interface WindowConfig {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

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
    // Save window bounds only — terminal list already saved in real-time
    saveWindowBounds();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Development: load Vite dev server; Production: load built files
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

let terminalManager: ReturnType<typeof createTerminalManager> | null = null;
let chatWatcher: ReturnType<typeof createChatWatcher> | null = null;

app.whenReady().then(() => {
  // Initialize config persistence
  initConfigDir(app.getPath('userData'));
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
  registerAppHandlers();

  chatWatcher = createChatWatcher();
  chatWatcher.start();

  // Register app config IPC handlers
  ipcMain.handle(IPC_CHANNELS.APP.GET_CONFIG, async () => {
    return { success: true, data: configManager.loadConfig() };
  });

  ipcMain.handle(IPC_CHANNELS.APP.SAVE_CONFIG, async (_event, config) => {
    const result = configManager.saveConfig(config);
    return { success: true, data: result };
  });

  // Register fs:select-directory handler
  ipcMain.handle(IPC_CHANNELS.FS.SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false };
    }
    return { success: true, data: result.filePaths[0] };
  });

  // Create window and restore terminals from config
  function launchWindowWithTerminals(): void {
    const config = configManager.loadConfig();
    createWindow(config.window);

    // Restore terminals after renderer is ready (so output events are received)
    if (config.openTerminals && config.openTerminals.length > 0 && mainWindow) {
      const terminalsToRestore = config.openTerminals;
      mainWindow.webContents.once('did-finish-load', () => {
        console.log('[MUXVO:restore] did-finish-load, scheduling restore in 500ms');
        // Delay to ensure React has mounted and xterm useEffect listeners are active
        setTimeout(() => {
          if (!terminalManager) return;
          const restoredIds: string[] = [];
          for (const terminal of terminalsToRestore) {
            const result = terminalManager.spawn({ cwd: terminal.cwd });
            if (result.success && result.id) {
              console.log('[MUXVO:restore] spawned id=' + result.id + ' cwd=' + terminal.cwd);
              restoredIds.push(result.id);
            }
          }
          // Notify renderer to refresh terminal list
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            const list = terminalManager.list();
            win.webContents.send(IPC_CHANNELS.TERMINAL.LIST_UPDATED, list.map((t) => ({
              id: t.id, state: t.state,
            })));
            console.log('[MUXVO:restore] sent list-updated, count=' + restoredIds.length);
          }
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

/** Save window bounds to config before closing (terminals saved in real-time via onTerminalChange) */
function saveWindowBounds(): void {
  if (!lastBounds) return;

  const configManager = createConfigManager();
  // Only save window bounds — terminal list is already saved in real-time
  // by onTerminalChange callback whenever terminals are created/closed
  const existing = configManager.loadConfig();
  configManager.saveConfig({
    ...existing,
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

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
