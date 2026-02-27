/**
 * Auth Manager
 *
 * Coordinates auth-machine + token-storage + backend-client.
 * Manages token refresh timer (access token 15min expiry, refresh before expiry).
 */

import { createAuthMachine, type AuthMethod } from '@/modules/auth/auth-machine';
import { storeTokenPair, getTokenPair, clearToken } from '@/modules/auth/token-storage';
import { createBackendClient, type BackendClientOptions } from './backend-client';

const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 1000; // 12 minutes (before 15min expiry)

export interface AuthManagerOptions {
  backendUrl: string;
  backendTimeout?: number;
  onLoginSuccess?: () => void;
}

export function createAuthManager(options: AuthManagerOptions) {
  const machine = createAuthMachine();
  const client = createBackendClient({
    baseUrl: options.backendUrl,
    timeout: options.backendTimeout,
  });

  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function startRefreshTimer() {
    stopRefreshTimer();
    refreshTimer = setInterval(async () => {
      try {
        const tokens = await getTokenPair();
        if (!tokens.refreshToken) {
          stopRefreshTimer();
          return;
        }
        const newTokens = await client.refreshToken(tokens.refreshToken);
        await storeTokenPair(newTokens.accessToken, newTokens.refreshToken);
        machine.send('TOKEN_REFRESH', {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
        });
      } catch {
        machine.send('REFRESH_FAILED', { error: 'Token 自动刷新失败' });
        stopRefreshTimer();
        await clearToken();
      }
    }, TOKEN_REFRESH_INTERVAL_MS);
  }

  function stopRefreshTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  return {
    get state() {
      return machine.state;
    },
    get context() {
      return machine.context;
    },

    /** Start GitHub OAuth flow — opens browser */
    async loginGithub(): Promise<{ authUrl: string; state: string }> {
      machine.send('LOGIN', { authMethod: 'github' as AuthMethod });
      const result = await client.initGithubAuth();
      return result;
    },

    /** Start Google OAuth flow — opens browser */
    async loginGoogle(): Promise<{ authUrl: string; state: string }> {
      machine.send('LOGIN', { authMethod: 'google' as AuthMethod });
      const result = await client.initGoogleAuth();
      return result;
    },

    /** Send email verification code */
    async sendEmailCode(email: string): Promise<{ success: boolean; expiresIn: number }> {
      machine.send('SEND_EMAIL_CODE', { email });
      return client.sendEmailCode(email);
    },

    /** Verify email code and complete login */
    async verifyEmailCode(email: string, code: string) {
      machine.send('VERIFY_CODE');
      try {
        const result = await client.verifyEmailCode(email, code);
        await storeTokenPair(result.accessToken, result.refreshToken);
        machine.send('TOKEN_RECEIVED', {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          username: result.user.displayName || email,
          userId: result.user.id,
          email: result.user.email || email,
          avatarUrl: result.user.avatarUrl || '',
        });
        startRefreshTimer();
        options.onLoginSuccess?.();
        return { success: true, user: result.user };
      } catch (err) {
        machine.send('AUTH_FAILED', {
          error: err instanceof Error ? err.message : '验证码验证失败',
        });
        return { success: false, error: err instanceof Error ? err.message : '验证码验证失败' };
      }
    },

    /** Handle OAuth callback (deep link with tokens from server redirect) */
    async handleOAuthCallback(accessToken: string, refreshToken: string) {
      machine.send('AUTH_CALLBACK', { authCode: 'oauth-callback' });
      try {
        await storeTokenPair(accessToken, refreshToken);
        // Fetch user profile with the access token
        const user = await client.getUserProfile(accessToken);
        machine.send('TOKEN_RECEIVED', {
          accessToken,
          refreshToken,
          username: user.displayName || user.email || '',
          userId: user.id,
          email: user.email || '',
          avatarUrl: user.avatarUrl || '',
        });
        startRefreshTimer();
        options.onLoginSuccess?.();
        return { success: true, user };
      } catch (err) {
        machine.send('AUTH_FAILED', {
          error: err instanceof Error ? err.message : 'OAuth 回调处理失败',
        });
        await clearToken();
        return { success: false, error: err instanceof Error ? err.message : 'OAuth 回调处理失败' };
      }
    },

    /** Manual token refresh */
    async refreshToken() {
      const tokens = await getTokenPair();
      if (!tokens.refreshToken) {
        return { success: false, error: 'No refresh token available' };
      }
      try {
        const newTokens = await client.refreshToken(tokens.refreshToken);
        await storeTokenPair(newTokens.accessToken, newTokens.refreshToken);
        machine.send('TOKEN_REFRESH', {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
        });
        return { success: true };
      } catch (err) {
        machine.send('REFRESH_FAILED', { error: 'Token 刷新失败' });
        await clearToken();
        stopRefreshTimer();
        return { success: false, error: err instanceof Error ? err.message : 'Token 刷新失败' };
      }
    },

    /** Logout — revoke server token + clear local */
    async logout() {
      const tokens = await getTokenPair();
      stopRefreshTimer();
      if (tokens.refreshToken) {
        try {
          await client.logout(tokens.refreshToken);
        } catch {
          // Best effort: continue local cleanup even if server revoke fails
        }
      }
      await clearToken();
      machine.send('LOGOUT');
      return { success: true };
    },

    /** Get current auth status */
    async getStatus() {
      const isLoggedIn = machine.state === 'LoggedIn';
      if (isLoggedIn) {
        return {
          loggedIn: true,
          user: {
            username: machine.context.username || '',
            avatarUrl: machine.context.avatarUrl || '',
            userId: machine.context.userId,
            email: machine.context.email,
          },
        };
      }
      return { loggedIn: false };
    },

    /** Get current access token (from storage), or null if not logged in */
    async getAccessToken(): Promise<string | null> {
      const tokens = await getTokenPair();
      return tokens.accessToken || null;
    },

    /** Try to restore session from stored tokens on startup */
    async tryRestoreSession() {
      const tokens = await getTokenPair();
      if (!tokens.accessToken || !tokens.refreshToken) {
        return { success: false };
      }
      try {
        const user = await client.getUserProfile(tokens.accessToken);
        machine.send('LOGIN', { authMethod: undefined });
        machine.send('TOKEN_RECEIVED', {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          username: user.displayName || user.email || '',
          userId: user.id,
          email: user.email || '',
          avatarUrl: user.avatarUrl || '',
        });
        startRefreshTimer();
        options.onLoginSuccess?.();
        return { success: true, user };
      } catch {
        // Token may be expired, try refresh
        try {
          const newTokens = await client.refreshToken(tokens.refreshToken);
          await storeTokenPair(newTokens.accessToken, newTokens.refreshToken);
          const user = await client.getUserProfile(newTokens.accessToken);
          machine.send('LOGIN', { authMethod: undefined });
          machine.send('TOKEN_RECEIVED', {
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            username: user.displayName || user.email || '',
            userId: user.id,
            email: user.email || '',
            avatarUrl: user.avatarUrl || '',
          });
          startRefreshTimer();
          options.onLoginSuccess?.();
          return { success: true, user };
        } catch {
          await clearToken();
          return { success: false };
        }
      }
    },

    /** Stop refresh timer (for cleanup) */
    destroy() {
      stopRefreshTimer();
    },
  };
}
