/**
 * Muxvo — Electron Main Process Entry
 * DEV-PLAN A1: Electron 应用骨架搭建
 *
 * Responsibilities:
 * - BrowserWindow creation with security isolation
 * - Window position/size persistence
 * - IPC handler registration (per-domain)
 * - Graceful shutdown of child processes
 */

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { createTerminalManager } from './services/terminal/manager';
import { createRealPtyAdapter } from './services/terminal/pty-adapter';
import { registerTerminalHandlers } from './ipc/terminal-handlers';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
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
  // Initialize PTY adapter and terminal manager
  const ptyAdapter = createRealPtyAdapter();
  terminalManager = createTerminalManager({ pty: ptyAdapter });

  // Register terminal IPC handlers
  registerTerminalHandlers(terminalManager);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Clean up all terminal processes
  if (terminalManager) {
    terminalManager.closeAll();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
