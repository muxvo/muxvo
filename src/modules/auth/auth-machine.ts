/**
 * Auth State Machine - manages authentication flow
 *
 * 5 states: LoggedOut → Authorizing → LoggedIn (OAuth path)
 *           LoggedOut → CodeSent → Verifying → LoggedIn (Email path)
 *
 * OAuth path (GitHub / Google):
 *   LOGIN → Authorizing → AUTH_CALLBACK → Verifying → TOKEN_RECEIVED → LoggedIn
 *
 * Email path:
 *   SEND_EMAIL_CODE → CodeSent → VERIFY_CODE → Verifying → TOKEN_RECEIVED → LoggedIn
 */

export type AuthMethod = 'github' | 'google' | 'email';

type AuthState = 'LoggedOut' | 'Authorizing' | 'CodeSent' | 'Verifying' | 'LoggedIn';

export interface AuthContext {
  codeVerifier: string;
  codeChallenge: string;
  authCode?: string;
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  userId?: string;
  email?: string;
  authMethod?: AuthMethod;
  tokenStorage: string;
  error?: string;
  emailCodeSentAt?: number;
  avatarUrl?: string;
}

function generatePKCE() {
  const verifier = 'pkce-verifier-' + Math.random().toString(36).slice(2);
  const challenge = 'pkce-challenge-' + Math.random().toString(36).slice(2);
  return { verifier, challenge };
}

export function createAuthMachine() {
  let state: AuthState = 'LoggedOut';
  const context: AuthContext = {
    codeVerifier: '',
    codeChallenge: '',
    tokenStorage: 'plaintext',
  };

  function resetOAuthContext() {
    context.codeVerifier = '';
    context.codeChallenge = '';
    context.authCode = undefined;
  }

  function resetAll() {
    resetOAuthContext();
    context.accessToken = undefined;
    context.refreshToken = undefined;
    context.username = undefined;
    context.userId = undefined;
    context.email = undefined;
    context.authMethod = undefined;
    context.emailCodeSentAt = undefined;
    context.avatarUrl = undefined;
  }

  function send(event: string, payload?: Record<string, unknown>) {
    switch (state) {
      case 'LoggedOut':
        if (event === 'LOGIN') {
          state = 'Authorizing';
          const pkce = generatePKCE();
          context.codeVerifier = pkce.verifier;
          context.codeChallenge = pkce.challenge;
          context.error = undefined;
          if (payload?.authMethod) {
            context.authMethod = payload.authMethod as AuthMethod;
          }
        } else if (event === 'SEND_EMAIL_CODE') {
          state = 'CodeSent';
          context.authMethod = 'email';
          if (payload?.email) {
            context.email = payload.email as string;
          }
          context.emailCodeSentAt = Date.now();
          context.error = undefined;
        }
        break;

      case 'Authorizing':
        if (event === 'AUTH_CALLBACK') {
          if (payload?.authCode) {
            context.authCode = payload.authCode as string;
          }
        } else if (event === 'TOKEN_RECEIVED') {
          state = 'LoggedIn';
          context.accessToken = payload?.accessToken as string;
          if (payload?.refreshToken) {
            context.refreshToken = payload.refreshToken as string;
          }
          if (payload?.username) {
            context.username = payload.username as string;
          }
          if (payload?.userId) {
            context.userId = payload.userId as string;
          }
          if (payload?.email) {
            context.email = payload.email as string;
          }
          if (payload?.avatarUrl) {
            context.avatarUrl = payload.avatarUrl as string;
          }
          context.tokenStorage = 'plaintext';
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = (payload?.error as string) || '授权失败';
          resetOAuthContext();
          context.authMethod = undefined;
        }
        break;

      case 'CodeSent':
        if (event === 'VERIFY_CODE') {
          state = 'Verifying';
        } else if (event === 'RESEND_CODE') {
          // Stay in CodeSent, update timestamp
          context.emailCodeSentAt = Date.now();
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = (payload?.error as string) || '验证码发送失败';
          context.authMethod = undefined;
          context.emailCodeSentAt = undefined;
        } else if (event === 'CANCEL') {
          state = 'LoggedOut';
          context.authMethod = undefined;
          context.emailCodeSentAt = undefined;
          context.error = undefined;
        }
        break;

      case 'Verifying':
        if (event === 'TOKEN_RECEIVED') {
          state = 'LoggedIn';
          context.accessToken = payload?.accessToken as string;
          if (payload?.refreshToken) {
            context.refreshToken = payload.refreshToken as string;
          }
          if (payload?.username) {
            context.username = payload.username as string;
          }
          if (payload?.userId) {
            context.userId = payload.userId as string;
          }
          if (payload?.email) {
            context.email = payload.email as string;
          }
          if (payload?.avatarUrl) {
            context.avatarUrl = payload.avatarUrl as string;
          }
          context.tokenStorage = 'plaintext';
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = (payload?.error as string) || '验证失败';
          resetOAuthContext();
          context.authMethod = undefined;
          context.emailCodeSentAt = undefined;
        }
        break;

      case 'LoggedIn':
        if (event === 'LOGOUT') {
          state = 'LoggedOut';
          resetAll();
        } else if (event === 'TOKEN_EXPIRED') {
          state = 'LoggedOut';
          resetAll();
        } else if (event === 'TOKEN_REFRESH') {
          // Stay in LoggedIn, update tokens
          context.accessToken = payload?.accessToken as string;
          if (payload?.refreshToken) {
            context.refreshToken = payload.refreshToken as string;
          }
        } else if (event === 'REFRESH_FAILED') {
          state = 'LoggedOut';
          resetAll();
          context.error = (payload?.error as string) || 'Token 刷新失败';
        }
        break;
    }
  }

  return {
    get state() {
      return state;
    },
    get context() {
      return context;
    },
    send,
  };
}
