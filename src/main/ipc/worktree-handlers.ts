/** Worktree IPC Handlers — create, list, remove, detect git repo */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { createWorktreeManager } from '@/main/services/worktree/manager';
import type { WorktreeManager } from '@/main/services/worktree/manager';

export function createWorktreeHandlers(manager?: WorktreeManager) {
  const mgr = manager ?? createWorktreeManager();

  return {
    async detectRepo(params: { path: string }) {
      try {
        const result = await mgr.detectRepo(params.path);
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: { code: 'WORKTREE_DETECT_ERROR', message } };
      }
    },

    async list(params: { repoPath: string }) {
      try {
        const worktrees = await mgr.list(params.repoPath);
        return { success: true, data: worktrees };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: { code: 'WORKTREE_LIST_ERROR', message } };
      }
    },

    async create(params: { repoPath: string }) {
      try {
        const result = await mgr.create(params.repoPath);
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: { code: 'WORKTREE_CREATE_ERROR', message } };
      }
    },

    async remove(params: { worktreePath: string; force?: boolean }) {
      try {
        await mgr.remove(params.worktreePath, params.force);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: { code: 'WORKTREE_REMOVE_ERROR', message } };
      }
    },
  };
}

export function registerWorktreeHandlers(manager?: WorktreeManager): void {
  const h = createWorktreeHandlers(manager);

  ipcMain.handle(IPC_CHANNELS.WORKTREE.DETECT_REPO, (_event, params) =>
    h.detectRepo(params)
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE.LIST, (_event, params) =>
    h.list(params)
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE.CREATE, (_event, params) =>
    h.create(params)
  );
  ipcMain.handle(IPC_CHANNELS.WORKTREE.REMOVE, (_event, params) =>
    h.remove(params)
  );
}

// Legacy export for test compatibility
const _defaultManager = createWorktreeManager();
export const worktreeHandlers = createWorktreeHandlers(_defaultManager);
