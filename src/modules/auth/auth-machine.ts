/**
 * Auth State Machine - manages GitHub OAuth PKCE authentication flow
 *
 * States: LoggedOut -> Authorizing -> LoggedIn
 */

type AuthState = 'LoggedOut' | 'Authorizing' | 'LoggedIn';

interface AuthContext {
  codeVerifier: string;
  codeChallenge: string;
  authCode?: string;
  accessToken?: string;
  username?: string;
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
          context.username = payload?.username as string;
          context.tokenStorage = 'safeStorage';
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = 'GitHub 授权失败';
          context.codeVerifier = '';
          context.codeChallenge = '';
        }
        break;

      case 'LoggedIn':
        if (event === 'LOGOUT') {
          state = 'LoggedOut';
          context.accessToken = undefined;
          context.username = undefined;
          context.codeVerifier = '';
          context.codeChallenge = '';
        } else if (event === 'TOKEN_EXPIRED') {
          state = 'LoggedOut';
          context.accessToken = undefined;
          context.codeVerifier = '';
          context.codeChallenge = '';
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
