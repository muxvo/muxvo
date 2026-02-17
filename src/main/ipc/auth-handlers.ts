/**
 * Auth IPC Handlers
 *
 * Handles auth:login-github, auth:logout, auth:get-status IPC channels.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import {
  loginGithub as oauthLoginGithub,
  logout as oauthLogout,
  getAuthStatus,
} from '@/modules/auth/github-oauth';

export function createAuthHandlers() {
  return {
    async loginGithub(): Promise<Record<string, unknown>> {
      try {
        const result = await oauthLoginGithub();
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async logout(): Promise<Record<string, unknown>> {
      try {
        const result = await oauthLogout();
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async getStatus(): Promise<Record<string, unknown>> {
      try {
        const result = await getAuthStatus();
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },
  };
}

export function registerAuthHandlers(): void {
  const handlers = createAuthHandlers();

  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_GITHUB, async () => {
    return handlers.loginGithub();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.LOGOUT, async () => {
    return handlers.logout();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.GET_STATUS, async () => {
    return handlers.getStatus();
  });
}
