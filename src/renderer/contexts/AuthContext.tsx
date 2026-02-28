/**
 * AuthContext — Global authentication state management
 * Follows PanelContext pattern (createContext + useReducer + Provider + Hook)
 */

import { createContext, useContext, useReducer, useEffect, useCallback, useRef, type ReactNode } from 'react';

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
  sendEmailCode: (email: string, purpose?: string) => Promise<boolean>;
  loginEmail: (email: string, code: string) => Promise<void>;
  loginPassword: (email: string, password: string) => Promise<void>;
  register: (email: string, code: string, password: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──

const OAUTH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const oauthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear OAuth timeout when status changes away from loading
  useEffect(() => {
    if (state.status !== 'loading' && oauthTimerRef.current) {
      clearTimeout(oauthTimerRef.current);
      oauthTimerRef.current = null;
    }
  }, [state.status]);

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
            provider: u.provider || u.identities?.[0]?.provider || 'unknown',
          },
        });
      }
    }).catch(() => {});

    // Listen for session expired push event
    const unsubExpired = window.api.auth.onSessionExpired?.(() => {
      dispatch({ type: 'LOGOUT' });
    });

    // Listen for auth status change push event (Deep Link OAuth callback)
    const unsubStatus = window.api.auth.onStatusChange?.((data: any) => {
      if (data?.success && data.data?.loggedIn && data.data.user) {
        const u = data.data.user;
        dispatch({
          type: 'LOGIN_SUCCESS',
          user: {
            username: u.displayName || u.username || u.email || '',
            email: u.email,
            avatarUrl: u.avatarUrl || '',
            provider: u.provider || u.identities?.[0]?.provider || 'unknown',
          },
        });
      } else if (data && !data.success) {
        // OAuth callback failed — clear loading state
        dispatch({ type: 'LOGIN_FAILED', error: data.error || '登录失败，请重试' });
      }
    });

    return () => {
      unsubExpired?.();
      unsubStatus?.();
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
        // Set timeout to clear loading state if callback never arrives
        oauthTimerRef.current = setTimeout(() => {
          dispatch({ type: 'LOGIN_FAILED', error: '登录超时，请重试' });
        }, OAUTH_TIMEOUT_MS);
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
      } else {
        // OAuth flow opened browser - set timeout
        oauthTimerRef.current = setTimeout(() => {
          dispatch({ type: 'LOGIN_FAILED', error: '登录超时，请重试' });
        }, OAUTH_TIMEOUT_MS);
      }
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: 'Google 登录失败' });
    }
  }, []);

  const sendEmailCode = useCallback(async (email: string, purpose?: string): Promise<boolean> => {
    try {
      const result = await window.api.auth.sendEmailCode(email, purpose);
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

  const loginPassword = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const result = await window.api.auth.loginPassword(email, password);
      if (result?.success && result.data?.user) {
        const u = result.data.user;
        dispatch({
          type: 'LOGIN_SUCCESS',
          user: {
            username: u.displayName || u.email || email,
            email: u.email || email,
            avatarUrl: u.avatarUrl || '',
            provider: 'email',
          },
        });
      } else {
        dispatch({ type: 'LOGIN_FAILED', error: result?.data?.error || result?.error?.message || '登录失败' });
      }
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: '登录失败' });
    }
  }, []);

  const register = useCallback(async (email: string, code: string, password: string) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const result = await window.api.auth.register(email, code, password);
      if (result?.success && result.data?.user) {
        const u = result.data.user;
        dispatch({
          type: 'LOGIN_SUCCESS',
          user: {
            username: u.displayName || u.email || email,
            email: u.email || email,
            avatarUrl: u.avatarUrl || '',
            provider: 'email',
          },
        });
      } else {
        dispatch({ type: 'LOGIN_FAILED', error: result?.data?.error || result?.error?.message || '注册失败' });
      }
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: '注册失败' });
    }
  }, []);

  const resetPassword = useCallback(async (email: string, code: string, newPassword: string): Promise<boolean> => {
    try {
      const result = await window.api.auth.resetPassword(email, code, newPassword);
      if (result?.success) return true;
      dispatch({ type: 'LOGIN_FAILED', error: result?.data?.error || result?.error?.message || '密码重置失败' });
      return false;
    } catch {
      dispatch({ type: 'LOGIN_FAILED', error: '密码重置失败' });
      return false;
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
    <AuthContext.Provider value={{ state, dispatch, loginGithub, loginGoogle, sendEmailCode, loginEmail, loginPassword, register, resetPassword, logout }}>
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
