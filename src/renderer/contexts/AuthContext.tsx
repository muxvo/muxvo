/**
 * AuthContext — Global authentication state management
 * Follows PanelContext pattern (createContext + useReducer + Provider + Hook)
 */

import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';

// ── Types ──

interface AuthUser {
  username: string;
  email?: string;
  avatarUrl: string;
  provider: 'github' | 'google' | 'email';
}

interface AuthState {
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  user: AuthUser | null;
  error: string | null;
  loginModalOpen: boolean;
}

const initialState: AuthState = {
  status: 'idle',
  user: null,
  error: null,
  loginModalOpen: false,
};

// ── Actions ──

type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: AuthUser }
  | { type: 'LOGIN_FAILED'; error: string }
  | { type: 'LOGOUT' }
  | { type: 'OPEN_LOGIN_MODAL' }
  | { type: 'CLOSE_LOGIN_MODAL' }
  | { type: 'CLEAR_ERROR' };

// ── Reducer ──

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, status: 'loading', error: null };
    case 'LOGIN_SUCCESS':
      return { ...state, status: 'authenticated', user: action.user, error: null, loginModalOpen: false };
    case 'LOGIN_FAILED':
      return { ...state, status: 'error', error: action.error };
    case 'LOGOUT':
      return { ...initialState };
    case 'OPEN_LOGIN_MODAL':
      return { ...state, loginModalOpen: true };
    case 'CLOSE_LOGIN_MODAL':
      return { ...state, loginModalOpen: false, error: null };
    case 'CLEAR_ERROR':
      return { ...state, error: null, status: state.user ? 'authenticated' : 'idle' };
    default:
      return state;
  }
}

// ── Context ──

interface AuthContextValue {
  state: AuthState;
  dispatch: React.Dispatch<AuthAction>;
  loginGithub: () => Promise<void>;
  loginGoogle: () => Promise<void>;
  sendEmailCode: (email: string) => Promise<boolean>;
  loginEmail: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Check login status on mount + listen for push events
  useEffect(() => {
    window.api.auth.getStatus().then((result: any) => {
      if (result?.success && result.data?.loggedIn && result.data.user) {
        const u = result.data.user;
        dispatch({
          type: 'LOGIN_SUCCESS',
          user: {
            username: u.displayName || u.username || u.email || '',
            email: u.email,
            avatarUrl: u.avatarUrl || '',
            provider: u.provider || 'github',
          },
        });
      }
    }).catch(() => {});

    // Listen for session expired push event
    const unsubExpired = window.api.auth.onSessionExpired?.(() => {
      dispatch({ type: 'LOGOUT' });
    });

    return () => {
      unsubExpired?.();
    };
  }, []);

  const loginGithub = useCallback(async () => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const result = await window.api.auth.loginGithub();
      if (result?.success && result.data?.user) {
        const u = result.data.user;
        dispatch({
          type: 'LOGIN_SUCCESS',
          user: {
            username: u.displayName || u.username || '',
            email: u.email,
            avatarUrl: u.avatarUrl || '',
            provider: 'github',
          },
        });
      } else {
        // OAuth flow opened browser - login will complete via deep link callback
        // Don't treat as failure, keep loading state
        // The session-expired or getStatus polling will update state
      }
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: 'GitHub 登录失败' });
    }
  }, []);

  const loginGoogle = useCallback(async () => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const result = await window.api.auth.loginGoogle();
      if (result?.success && result.data?.user) {
        const u = result.data.user;
        dispatch({
          type: 'LOGIN_SUCCESS',
          user: {
            username: u.displayName || u.username || '',
            email: u.email,
            avatarUrl: u.avatarUrl || '',
            provider: 'google',
          },
        });
      }
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: 'Google 登录失败' });
    }
  }, []);

  const sendEmailCode = useCallback(async (email: string): Promise<boolean> => {
    try {
      const result = await window.api.auth.sendEmailCode(email);
      if (!result?.success) {
        dispatch({ type: 'LOGIN_FAILED', error: result?.error?.message || '发送失败' });
        return false;
      }
      return true;
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: '发送失败' });
      return false;
    }
  }, []);

  const loginEmail = useCallback(async (email: string, code: string) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const result = await window.api.auth.verifyEmailCode(email, code);
      if (result?.success && result.data?.user) {
        const u = result.data.user;
        dispatch({
          type: 'LOGIN_SUCCESS',
          user: {
            username: u.displayName || u.username || u.email || '',
            email: u.email,
            avatarUrl: u.avatarUrl || '',
            provider: 'email',
          },
        });
      } else {
        dispatch({ type: 'LOGIN_FAILED', error: result?.error?.message || '验证码错误' });
      }
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: '验证码错误' });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await window.api.auth.logout();
    } catch {
      // Logout locally regardless
    }
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <AuthContext.Provider value={{ state, dispatch, loginGithub, loginGoogle, sendEmailCode, loginEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
