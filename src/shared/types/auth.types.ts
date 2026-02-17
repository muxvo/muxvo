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
