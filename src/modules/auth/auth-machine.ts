/**
 * Auth State Machine - manages authentication flow
 *
 * Original states: LoggedOut -> Authorizing -> LoggedIn
 * Extended states: LoggedOut -> Authorizing -> ExchangingToken -> LoggedIn
 *
 * The original path (LOGIN → AUTH_CALLBACK → TOKEN_RECEIVED → LoggedIn)
 * is fully preserved for backward compatibility.
 *
 * New path adds ExchangingToken for backend token exchange:
 * LOGIN → AUTH_CALLBACK → EXCHANGE_TOKEN → ExchangingToken
 * → BACKEND_TOKEN_RECEIVED → LoggedIn
 */

export type AuthMethod = 'github' | 'google' | 'email';

type AuthState = 'LoggedOut' | 'Authorizing' | 'ExchangingToken' | 'LoggedIn';

interface AuthContext {
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
    tokenStorage: 'safeStorage',
  };

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
        }
        break;

      case 'Authorizing':
        if (event === 'AUTH_CALLBACK') {
          if (payload?.authCode) {
            context.authCode = payload.authCode as string;
          }
        } else if (event === 'TOKEN_RECEIVED') {
          // Original path: Authorizing → LoggedIn (preserved for backward compat)
          state = 'LoggedIn';
          context.accessToken = payload?.accessToken as string;
          context.username = payload?.username as string;
          context.tokenStorage = 'safeStorage';
        } else if (event === 'EXCHANGE_TOKEN') {
          // New path: Authorizing → ExchangingToken (for backend token exchange)
          state = 'ExchangingToken';
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = 'GitHub 授权失败';
          context.codeVerifier = '';
          context.codeChallenge = '';
          context.authMethod = undefined;
        }
        break;

      case 'ExchangingToken':
        if (event === 'BACKEND_TOKEN_RECEIVED') {
          state = 'LoggedIn';
          context.accessToken = payload?.accessToken as string;
          context.refreshToken = payload?.refreshToken as string;
          context.username = payload?.username as string;
          context.userId = payload?.userId as string;
          context.email = payload?.email as string;
          context.tokenStorage = 'safeStorage';
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = (payload?.error as string) || '授权失败';
          context.codeVerifier = '';
          context.codeChallenge = '';
          context.authMethod = undefined;
        }
        break;

      case 'LoggedIn':
        if (event === 'LOGOUT') {
          state = 'LoggedOut';
          context.accessToken = undefined;
          context.refreshToken = undefined;
          context.username = undefined;
          context.userId = undefined;
          context.email = undefined;
          context.authMethod = undefined;
          context.codeVerifier = '';
          context.codeChallenge = '';
        } else if (event === 'TOKEN_EXPIRED') {
          state = 'LoggedOut';
          context.accessToken = undefined;
          context.refreshToken = undefined;
          context.codeVerifier = '';
          context.codeChallenge = '';
        } else if (event === 'TOKEN_REFRESH') {
          // Stay in LoggedIn, update tokens
          context.accessToken = payload?.accessToken as string;
          if (payload?.refreshToken) {
            context.refreshToken = payload.refreshToken as string;
          }
        } else if (event === 'REFRESH_FAILED') {
          state = 'LoggedOut';
          context.accessToken = undefined;
          context.refreshToken = undefined;
          context.username = undefined;
          context.userId = undefined;
          context.email = undefined;
          context.authMethod = undefined;
          context.codeVerifier = '';
          context.codeChallenge = '';
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
