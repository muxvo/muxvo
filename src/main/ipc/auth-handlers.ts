/**
 * Auth IPC Handlers
 *
 * Handles auth IPC channels.
 * Original: auth:login-github, auth:logout, auth:get-status
 * Phase 5: auth:login-google, auth:send-email-code, auth:verify-email-code,
 *          auth:oauth-callback, auth:refresh-token, auth:get-profile
 */

import { app, ipcMain, BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { createAuthManager } from '@/main/services/auth/auth-manager';

// Lazy singleton auth manager (created on first use)
let authManager: ReturnType<typeof createAuthManager> | null = null;

export function getAuthManager() {
  if (!authManager) {
    const isProduction = app?.isPackaged ?? false;
    const backendUrl = process.env.MUXVO_API_URL
      || (isProduction ? 'https://api.muxvo.com' : 'http://localhost:3000');
    authManager = createAuthManager({ backendUrl });
  }
  return authManager;
}

export function createAuthHandlers() {
  return {
    // ─── Original handlers (preserved) ───
    async loginGithub(): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.loginGithub();
        await shell.openExternal(result.authUrl);
        return { success: true, data: { authUrl: result.authUrl } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async logout(): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.logout();
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async getStatus(): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.getStatus();
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    // ─── Phase 5 新增 handlers ───

    async loginGoogle(): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.loginGoogle();
        await shell.openExternal(result.authUrl);
        return { success: true, data: { authUrl: result.authUrl } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async sendEmailCode(params: { email: string }): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.sendEmailCode(params.email);
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async verifyEmailCode(params: { email: string; code: string }): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.verifyEmailCode(params.email, params.code);
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async oauthCallback(params: { accessToken: string; refreshToken: string }): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.handleOAuthCallback(params.accessToken, params.refreshToken);
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async refreshToken(): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.refreshToken();
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async getProfile(): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const status = await manager.getStatus();
        return { success: true, data: status };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },
  };
}

export function registerAuthHandlers(): void {
  const handlers = createAuthHandlers();

  // ─── Original registrations (preserved) ───
  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_GITHUB, async () => {
    return handlers.loginGithub();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.LOGOUT, async () => {
    return handlers.logout();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.GET_STATUS, async () => {
    return handlers.getStatus();
  });

  // ─── Phase 5 新增 registrations ───
  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_GOOGLE, async () => {
    return handlers.loginGoogle();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.SEND_EMAIL_CODE, async (_e, params) => {
    return handlers.sendEmailCode(params);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.VERIFY_EMAIL_CODE, async (_e, params) => {
    return handlers.verifyEmailCode(params);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.OAUTH_CALLBACK, async (_e, params) => {
    return handlers.oauthCallback(params);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.REFRESH_TOKEN, async () => {
    return handlers.refreshToken();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.GET_PROFILE, async () => {
    return handlers.getProfile();
  });
}

/** Push session expired event to all windows */
export function pushSessionExpired(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AUTH.SESSION_EXPIRED);
    }
  });
}
