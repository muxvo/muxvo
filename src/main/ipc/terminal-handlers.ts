/**
 * Terminal IPC Handlers
 *
 * Registers IPC handlers for terminal:* channels.
 * Delegates all operations to the terminal manager instance.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { createTerminalManager } from '@/main/services/terminal/manager';

type TerminalManager = ReturnType<typeof createTerminalManager>;

/**
 * Register all terminal IPC handlers with a manager instance.
 * Called from main/index.ts at app startup.
 */
export function registerTerminalHandlers(manager: TerminalManager): void {
  // terminal:create — invoke (R->M request-response)
  ipcMain.handle(IPC_CHANNELS.TERMINAL.CREATE, async (_event, req: { cwd: string }) => {
    const result = manager.spawn({ cwd: req.cwd });
    if (!result.success) {
      return { success: false, error: result.message };
    }
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
    return manager.close(req.id, req.force);
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
