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

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { createTerminalManager } from './services/terminal/manager';
import { createRealPtyAdapter } from './services/terminal/pty-adapter';
import { registerTerminalHandlers } from './ipc/terminal-handlers';
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
    // Save config now — terminals are still in the Map before PTY processes exit
    saveCurrentConfig();
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

  // Register app config IPC handlers
  ipcMain.handle(IPC_CHANNELS.APP.GET_CONFIG, async () => {
    return { success: true, data: configManager.loadConfig() };
  });

  ipcMain.handle(IPC_CHANNELS.APP.SAVE_CONFIG, async (_event, config) => {
    const result = configManager.saveConfig(config);
    return { success: true, data: result };
  });

  // Create window with restored position/size
  createWindow(savedConfig.window);

  // Restore terminals after renderer is ready (so output events are received)
  if (savedConfig.openTerminals && savedConfig.openTerminals.length > 0 && mainWindow) {
    const terminalsToRestore = savedConfig.openTerminals;
    mainWindow.webContents.once('did-finish-load', () => {
      // Small delay to ensure React has mounted and useEffect listeners are active
      setTimeout(() => {
        if (!terminalManager) return;
        for (const terminal of terminalsToRestore) {
          terminalManager.spawn({ cwd: terminal.cwd });
        }
        // Notify renderer to refresh terminal list
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          const list = terminalManager.list();
          win.webContents.send('terminal:list-updated', list.map((t) => ({
            id: t.id, state: t.state,
          })));
        }
      }, 500);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/** Save terminal list to config (called on terminal create/close) */
function saveTerminalConfig(configManager: ReturnType<typeof createConfigManager>): void {
  if (!terminalManager) return;
  const terminals = terminalManager.list();
  configManager.saveConfig({
    openTerminals: terminals.map((t) => ({ cwd: t.cwd })),
  });
}

/** Save full state (window bounds + terminals) to config before closing */
function saveCurrentConfig(): void {
  if (!terminalManager) return;

  const configManager = createConfigManager();
  const terminals = terminalManager.list();
  const config: Record<string, unknown> = {
    openTerminals: terminals.map((t) => ({ cwd: t.cwd })),
  };

  // Use cached bounds (saved in 'close' event before window is destroyed)
  if (lastBounds) {
    config.window = {
      width: lastBounds.width,
      height: lastBounds.height,
      x: lastBounds.x,
      y: lastBounds.y,
    };
  }

  configManager.saveConfig(config);
}

app.on('window-all-closed', () => {
  // Config already saved in mainWindow 'close' event
  // Clean up all terminal processes
  if (terminalManager) {
    terminalManager.closeAll();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
