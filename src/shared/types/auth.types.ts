/**
 * 认证域类型定义
 * 来源: DEV-PLAN.md §2.9 auth:*
 */

/** auth:login-github 返回值 */
export interface AuthLoginResponse {
  success: boolean;
  user?: {
    username: string;
    avatarUrl: string;
  };
}

/** auth:get-status 返回值 */
export interface AuthStatus {
  loggedIn: boolean;
  user?: {
    username: string;
    avatarUrl: string;
  };
  tokenExpiry?: string;
}

// ─── Phase 5 新增类型（仅追加，不修改上方接口） ───

/** 认证方式 */
export type AuthMethod = 'github' | 'google' | 'email';

/** 用户资料（来自后端） */
export interface UserProfile {
  id: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
}

/** Token 对 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** auth:send-email-code 请求 */
export interface EmailCodeRequest {
  email: string;
}

/** auth:send-email-code 返回值 */
export interface EmailCodeResponse {
  success: boolean;
  expiresIn: number;
}

/** auth:verify-email-code 请求 */
export interface EmailVerifyRequest {
  email: string;
  code: string;
}

/** auth:oauth-callback 请求（从 deep link 接收） */
export interface OAuthCallbackRequest {
  accessToken: string;
  refreshToken: string;
}

/** OAuth init 返回值 */
export interface OAuthInitResponse {
  authUrl: string;
  state: string;
}

/** Purpose for sending email verification code */
export type EmailCodePurpose = 'login' | 'register' | 'reset-password';

/** auth:register request */
export interface RegisterRequest {
  email: string;
  code: string;
  password: string;
}

/** auth:login-password request */
export interface PasswordLoginRequest {
  email: string;
  password: string;
}

/** auth:reset-password request */
export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

/** auth:reset-password response */
export interface ResetPasswordResponse {
  success: boolean;
}
