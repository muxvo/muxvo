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
import { createAuthManager, type AuthManagerOptions } from '@/main/services/auth/auth-manager';
import { createBackendClient } from '@/main/services/auth/backend-client';

// Lazy singleton auth manager (created on first use)
let authManager: ReturnType<typeof createAuthManager> | null = null;
let authManagerExtraOptions: Partial<AuthManagerOptions> = {};

/** Pre-configure options (e.g. onLoginSuccess) before first getAuthManager() call */
export function configureAuthManager(opts: Partial<AuthManagerOptions>): void {
  authManagerExtraOptions = opts;
}

export function getAuthManager() {
  if (!authManager) {
    const isProduction = app?.isPackaged ?? false;
    const backendUrl = process.env.MUXVO_API_URL
      || (isProduction ? 'https://api.muxvo.com' : 'http://localhost:3100');
    authManager = createAuthManager({ backendUrl, ...authManagerExtraOptions });
  }
  return authManager;
}

function pushToAllWindows(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

/**
 * Poll server for OAuth completion.
 * After user authorizes in browser, server stores tokens in Redis keyed by state.
 * We poll every 2s for up to 2 minutes.
 */
function startOAuthPolling(
  state: string,
  manager: ReturnType<typeof createAuthManager>,
): void {
  const isProduction = app?.isPackaged ?? false;
  const backendUrl = process.env.MUXVO_API_URL
    || (isProduction ? 'https://api.muxvo.com' : 'http://localhost:3100');
  const client = createBackendClient({ baseUrl: backendUrl });

  let attempts = 0;
  const maxAttempts = 60; // 2 minutes at 2s intervals
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(interval);
      return;
    }

    try {
      const result = await client.pollOAuthResult(state);
      if (!result.pending && result.accessToken && result.refreshToken) {
        clearInterval(interval);
        // Complete the OAuth flow via auth manager
        const callbackResult = await manager.handleOAuthCallback(
          result.accessToken,
          result.refreshToken,
        );
        pushToAllWindows(IPC_CHANNELS.AUTH.STATUS_CHANGE, {
          success: true,
          data: { loggedIn: true, user: callbackResult.user },
        });
      }
    } catch {
      // Silently retry on network errors
    }
  }, 2000);
}

export function createAuthHandlers() {
  return {
    // ─── Original handlers (preserved) ───
    async loginGithub(): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.loginGithub();
        await shell.openExternal(result.authUrl);

        // Poll for OAuth completion (deep links don't work in dev mode)
        startOAuthPolling(result.state, manager);

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

        // Poll for OAuth completion (deep links don't work in dev mode)
        startOAuthPolling(result.state, manager);

        return { success: true, data: { authUrl: result.authUrl } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async sendEmailCode(params: { email: string; purpose?: string }): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.sendEmailCode(params.email, params.purpose);
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

    async register(params: { email: string; code: string; password: string }): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.register(params.email, params.code, params.password);
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async loginPassword(params: { email: string; password: string }): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.loginPassword(params.email, params.password);
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'AUTH_ERROR', message } };
      }
    },

    async resetPassword(params: { email: string; code: string; newPassword: string }): Promise<Record<string, unknown>> {
      try {
        const manager = getAuthManager();
        const result = await manager.resetPassword(params.email, params.code, params.newPassword);
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

  ipcMain.handle(IPC_CHANNELS.AUTH.REGISTER, (_e, p) => handlers.register(p));
  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_PASSWORD, (_e, p) => handlers.loginPassword(p));
  ipcMain.handle(IPC_CHANNELS.AUTH.RESET_PASSWORD, (_e, p) => handlers.resetPassword(p));
}

/** Push session expired event to all windows */
export function pushSessionExpired(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AUTH.SESSION_EXPIRED);
    }
  });
}
