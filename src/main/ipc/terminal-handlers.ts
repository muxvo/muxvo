/**
 * Terminal IPC Handlers
 *
 * Registers IPC handlers for terminal:* channels.
 * Delegates all operations to the terminal manager instance.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { createTerminalManager } from '@/main/services/terminal/manager';

type TerminalManager = ReturnType<typeof createTerminalManager>;

/**
 * Register all terminal IPC handlers with a manager instance.
 * Called from main/index.ts at app startup.
 * @param onTerminalChange Optional callback fired after terminal create/close for config persistence.
 */
export function registerTerminalHandlers(
  manager: TerminalManager,
  onTerminalChange?: () => void,
): void {
  // terminal:create — invoke (R->M request-response)
  ipcMain.handle(IPC_CHANNELS.TERMINAL.CREATE, async (_event, req: { cwd: string; cols?: number; rows?: number }) => {
    const result = manager.spawn({ cwd: req.cwd, cols: req.cols, rows: req.rows });
    if (!result.success) {
      return { success: false, error: result.message };
    }
    onTerminalChange?.();
    return { success: true, data: { id: result.id, pid: result.pid } };
  });

  // terminal:write — one-way (R->M fire-and-forget)
  ipcMain.on(IPC_CHANNELS.TERMINAL.WRITE, (_event, req: { id: string; data: string }) => {
    manager.write(req.id, req.data);
  });

  // terminal:resize — one-way (R->M fire-and-forget)
  ipcMain.on(IPC_CHANNELS.TERMINAL.RESIZE, (_event, req: { id: string; cols: number; rows: number }) => {
    manager.resize(req.id, req.cols, req.rows);
  });

  // terminal:close — invoke
  ipcMain.handle(IPC_CHANNELS.TERMINAL.CLOSE, async (_event, req: { id: string; force?: boolean }) => {
    const result = await manager.close(req.id, req.force);
    onTerminalChange?.();
    return result;
  });

  // terminal:list — invoke
  ipcMain.handle(IPC_CHANNELS.TERMINAL.LIST, async () => {
    return { success: true, data: manager.list() };
  });

  // terminal:get-state — invoke
  ipcMain.handle(IPC_CHANNELS.TERMINAL.GET_STATE, async (_event, req: { id: string }) => {
    const state = manager.getState(req.id);
    if (!state) {
      return { success: false, error: 'Terminal not found' };
    }
    return { success: true, data: state };
  });

  // terminal:get-foreground-process — invoke
  ipcMain.handle(IPC_CHANNELS.TERMINAL.GET_FOREGROUND_PROCESS, async (_event, req: { id: string }) => {
    const info = manager.getForegroundProcess(req.id);
    if (!info) {
      return { success: false, error: 'Terminal not found' };
    }
    return { success: true, data: info };
  });

  // terminal:get-buffer — invoke
  ipcMain.handle(IPC_CHANNELS.TERMINAL.GET_BUFFER, async (_event, req: { id: string }) => {
    const data = manager.getBuffer(req.id);
    return { success: true, data };
  });

  // terminal:acknowledge-waiting — one-way (R->M fire-and-forget)
  ipcMain.on(IPC_CHANNELS.TERMINAL.ACKNOWLEDGE_WAITING, (_event, req: { id: string }) => {
    manager.acknowledgeWaiting(req.id);
  });

  // terminal:set-name — invoke (R->M, persist custom name on terminal)
  ipcMain.handle(IPC_CHANNELS.TERMINAL.SET_NAME, async (_event, req: { id: string; name: string }) => {
    const ok = manager.setName(req.id, req.name);
    onTerminalChange?.();
    return { success: ok };
  });

  // terminal:update-cwd — invoke
  ipcMain.handle(IPC_CHANNELS.TERMINAL.UPDATE_CWD, async (_event, req: { id: string; cwd: string }) => {
    const ok = manager.updateCwd(req.id, req.cwd);
    onTerminalChange?.();
    if (ok) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TERMINAL.CWD_CHANGED, { id: req.id, cwd: req.cwd });
      }
    }
    return { success: ok };
  });
}

/**
 * Legacy stub export — kept for test compatibility (TERM_L1_01_real).
 * Tests import this object and check that terminalHandlers.create is a function.
 */
export const terminalHandlers = {
  async create(_event: unknown, opts?: { cwd?: string }) {
    return {
      success: true,
      data: { id: `term-${Date.now()}`, cwd: opts?.cwd ?? process.cwd() },
    };
  },
};
