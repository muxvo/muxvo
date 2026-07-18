/**
 * auth 错误码 → 中文文案（右上角批 B5；login-modal.md §5）：native 只产稳定 code + 英文 debug
 * message（AuthRequestRouter），中文落 web 层（屏级 STR 表纪律同源）。文案照 legacy
 * backend-client.ts ERROR_MESSAGE_MAP + AuthContext 硬编码串提炼；未知 code 回落通用文案。
 */

const AUTH_ERROR_ZH: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: '邮箱或密码错误',
  AUTH_CODE_INVALID: '验证码无效或已过期',
  AUTH_CODE_EXPIRED: '验证码无效或已过期',
  AUTH_EMAIL_TAKEN: '该邮箱已注册',
  AUTH_WEAK_PASSWORD: '密码至少 8 个字符',
  AUTH_RATE_LIMITED: '操作过于频繁，请稍后再试',
  AUTH_TIMEOUT: '登录超时，请重试',
  AUTH_NETWORK: '网络错误，请检查网络后重试',
  AUTH_SESSION_EXPIRED: '登录已过期，请重新登录',
  AUTH_SERVER: '服务异常，请稍后再试',
  AUTH_UNAVAILABLE: '登录服务暂不可用',
};

/** 兜底文案按动作域（legacy：'登录失败'/'注册失败'/'发送失败'/'密码重置失败'/'验证码错误'）。 */
export type AuthErrorScope = 'login' | 'register' | 'sendCode' | 'reset' | 'generic';

const SCOPE_FALLBACK: Record<AuthErrorScope, string> = {
  login: '登录失败，请重试',
  register: '注册失败',
  sendCode: '发送失败',
  reset: '密码重置失败',
  generic: '操作失败，请重试',
};

export function authErrorText(code: string | undefined, scope: AuthErrorScope = 'generic'): string {
  return (code && AUTH_ERROR_ZH[code]) || SCOPE_FALLBACK[scope];
}
