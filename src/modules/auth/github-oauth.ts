/**
 * GitHub OAuth - handles GitHub login/logout/status
 */

export interface LoginResult {
  success: boolean;
  user?: {
    username: string;
    avatarUrl: string;
  };
}

export interface LogoutResult {
  success: boolean;
}

export interface AuthStatus {
  loggedIn: boolean;
  user?: {
    username: string;
    avatarUrl: string;
  };
  tokenExpiry?: string;
}

let currentUser: { username: string; avatarUrl: string } | undefined;

export async function loginGithub(): Promise<LoginResult> {
  // Default: not connected, returns structure with success=false
  return {
    success: false,
  };
}

export async function logout(): Promise<LogoutResult> {
  currentUser = undefined;
  return { success: true };
}

export async function getAuthStatus(): Promise<AuthStatus> {
  if (currentUser) {
    return {
      loggedIn: true,
      user: currentUser,
    };
  }
  return { loggedIn: false };
}
