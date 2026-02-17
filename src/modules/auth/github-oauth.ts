/**
 * GitHub OAuth - handles GitHub login/logout/status
 */

import type { AuthLoginResponse, AuthStatus } from '@/shared/types/auth.types';

export interface LogoutResult {
  success: boolean;
}

let currentUser: { username: string; avatarUrl: string } | undefined;

export async function loginGithub(): Promise<AuthLoginResponse> {
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
