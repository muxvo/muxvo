/**
 * 登录弹窗屏（specs/behavior/login-modal.md）：380px 居中 modal，golden 两态
 * buttons（OAuth 按钮组）/ login（账号密码表单）。纯 props 吃 fixture（login payload），
 * 永不 mock IPC。
 * B5 加性扩渲（右上角批）：register / forgot-password 表单、__terms-confirm 二层、__error-bar、
 * __loading——全部由新 fx.login 字段门控（缺席=旧 DOM 逐字节不变 → lg-* golden 冻结安全）；
 * 交互接线在 LoginModalLive（事件委托），本组件保持纯展示。
 */

import '../../styles/surfaces.css';
import './modals.css';

/** 屏级文案表（spec §4：legacy locales/zh.ts auth.*；lg 两张 golden 均 zh） */
const STR = {
  zh: {
    modalTitle: 'Muxvo 登录',
    login: '登录',
    loginGithub: '使用 GitHub 登录',
    loginGoogle: '使用 Google 登录',
    emailPassword: '账号密码登录',
    emailPlaceholder: '邮箱地址',
    passwordPlaceholder: '密码',
    createAccount: '创建账号',
    forgotPassword: '忘记密码？',
    // B5 加性态（legacy zh.ts auth.*）
    register: '注册',
    registerTitle: '创建账号',
    forgotTitle: '重置密码',
    codePlaceholder: '验证码',
    newPasswordPlaceholder: '新密码',
    sendCode: '发送验证码',
    resendCode: '重新发送',
    sending: '发送中...',
    alreadyHaveAccount: '已有账号？登录',
    backToLogin: '返回登录',
    resetPassword: '重置密码',
    resetSuccess: '密码重置成功，请重新登录',
    termsConfirmTitle: '服务条款确认',
    termsConfirmBefore: '继续前，请阅读并同意',
    termsOfService: '服务条款',
    termsAnd: '和',
    privacyPolicy: '隐私政策',
    agreeAndContinue: '同意并继续',
    cancel: '取消',
  },
  // MAJOR-1 回修：en 表逐字取 legacy en.ts（语言切换全界面重绘对齐）
  en: {
    modalTitle: 'Login to Muxvo',
    login: 'Login',
    loginGithub: 'Continue with GitHub',
    loginGoogle: 'Continue with Google',
    emailPassword: 'Email & Password',
    emailPlaceholder: 'Email address',
    passwordPlaceholder: 'Password',
    createAccount: 'Create Account',
    forgotPassword: 'Forgot password?',
    register: 'Register',
    registerTitle: 'Create Account',
    forgotTitle: 'Reset Password',
    codePlaceholder: 'Verification code',
    newPasswordPlaceholder: 'New Password',
    sendCode: 'Send Code',
    resendCode: 'Resend',
    sending: 'Sending...',
    alreadyHaveAccount: 'Already have an account? Login',
    backToLogin: 'Back to Login',
    resetPassword: 'Reset Password',
    resetSuccess: 'Password reset successful. Please log in again.',
    termsConfirmTitle: 'Terms of Service',
    termsConfirmBefore: 'Before continuing, please read and agree to the ',
    termsOfService: 'Terms of Service',
    termsAnd: ' and ',
    privacyPolicy: 'Privacy Policy',
    agreeAndContinue: 'Agree & Continue',
    cancel: 'Cancel',
  },
} as const;

/** B5 login payload（全 optional：旧 fixture 缺席 → 旧 DOM 逐字节不变）。 */
export interface LoginFx {
  mode?: 'buttons' | 'login' | 'register' | 'forgot-password';
  error?: string;
  loading?: boolean;
  termsConfirm?: boolean;
  canSubmit?: boolean;
  registerReady?: boolean;
  resetReady?: boolean;
  /** >0 = 冷却中显示「Ns」（发送钮 disabled）；sending 优先。 */
  codeCooldown?: number;
  codeSending?: boolean;
  codeSendEnabled?: boolean;
  resetSuccess?: boolean;
  /** 已成功发过一次码 → 重发文案粘住「重新发送」（legacy codeSent 粘性，MINOR-3 部分回修）。 */
  codeSentOnce?: boolean;
}

/* OAuth 图标（legacy OAuthButton.tsx 同款 path） */
const githubIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.607.069-.607 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
  </svg>
);

const googleIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const emailIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

function OAuthButton({
  provider,
  icon,
  label,
}: {
  provider: string;
  icon: JSX.Element;
  label: string;
}): JSX.Element {
  return (
    <button className={`login-modal__oauth-btn login-modal__oauth-btn--${provider}`}>
      <span className="login-modal__oauth-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** 验证码发送钮文案（legacy 60s 冷却：sending → 发送中... / cooldown → Ns / 其余 → 发送/重发）。 */
function sendCodeLabel(t: (typeof STR)['zh' | 'en'], login: LoginFx): string {
  if (login.codeSending) return t.sending;
  if ((login.codeCooldown ?? 0) > 0) return `${login.codeCooldown}s`;
  return login.codeSentOnce ? t.resendCode : t.sendCode;
}

export function LoginModalScreen({ fx }: { fx: any }): JSX.Element {
  // locale 缺席 → zh（旧 fixture/golden 逐字节不变）；live 由 cfg.language 驱动（MAJOR-1 回修）。
  const t = STR[fx.locale === 'en' ? 'en' : 'zh'];
  const login: LoginFx = fx.login ?? {};
  const mode = login.mode ?? 'buttons';
  const title =
    mode === 'login' ? t.login
    : mode === 'register' ? t.registerTitle
    : mode === 'forgot-password' ? t.forgotTitle
    : t.modalTitle;
  const codeDisabled = !!login.codeSending || (login.codeCooldown ?? 0) > 0 || login.codeSendEnabled === false;

  return (
    <div className="login-modal__backdrop">
      <div className="login-modal">
        <div className="login-modal__header">
          {mode !== 'buttons' ? (
            <button className="login-modal__back-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : (
            <span />
          )}
          <span className="login-modal__title">{title}</span>
          <button className="login-modal__close-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* B5：错误条（legacy state.error 非空渲染，3s 自清在 Live 层；✕=手动即清，MINOR-1 回修） */}
        {login.error && (
          <div className="login-modal__error-bar">
            <span>{login.error}</span>
            <button className="login-modal__error-dismiss">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        <div className="login-modal__body">
          {mode === 'buttons' && (
            <>
              <OAuthButton provider="github" icon={githubIcon} label={t.loginGithub} />
              <OAuthButton provider="google" icon={googleIcon} label={t.loginGoogle} />
              <OAuthButton provider="email" icon={emailIcon} label={t.emailPassword} />
            </>
          )}

          {mode === 'login' && (
            <>
              <div className="login-modal__email-form">
                <div className="login-modal__field">
                  <input
                    type="email"
                    className="login-modal__input"
                    placeholder={t.emailPlaceholder}
                  />
                </div>
                <div className="login-modal__field">
                  <input
                    type="password"
                    className="login-modal__input"
                    placeholder={t.passwordPlaceholder}
                  />
                </div>
                {/* legacy 实况：邮箱/密码为空 → canSubmit=false → disabled（opacity .5） */}
                <button
                  className="login-modal__login-btn"
                  disabled={!login.canSubmit}
                  style={{ width: '100%', marginTop: '4px' }}
                >
                  {t.login}
                </button>
              </div>
              <div className="login-modal__links">
                <button className="login-modal__link">{t.createAccount}</button>
                <button className="login-modal__link">{t.forgotPassword}</button>
              </div>
            </>
          )}

          {/* B5：注册（legacy RegisterForm——邮箱+发送验证码 → 验证码+密码+注册） */}
          {mode === 'register' && (
            <>
              <div className="login-modal__email-form">
                <div className="login-modal__field login-modal__field--code-row">
                  <input type="email" className="login-modal__input" placeholder={t.emailPlaceholder} />
                  <button className="login-modal__send-code-btn" disabled={codeDisabled}>
                    {sendCodeLabel(t, login)}
                  </button>
                </div>
                <div className="login-modal__field">
                  <input
                    type="text"
                    className="login-modal__input login-modal__input--code"
                    placeholder={t.codePlaceholder}
                    maxLength={6}
                    autoComplete="one-time-code"
                  />
                </div>
                <div className="login-modal__field">
                  <input type="password" className="login-modal__input" placeholder={t.passwordPlaceholder} />
                </div>
                <button
                  className="login-modal__login-btn"
                  disabled={!login.registerReady}
                  style={{ width: '100%', marginTop: '4px' }}
                >
                  {t.register}
                </button>
              </div>
              <div className="login-modal__links">
                <button className="login-modal__link">{t.alreadyHaveAccount}</button>
              </div>
            </>
          )}

          {/* B5：忘记密码（legacy ForgotPasswordForm——成功后不自动登录，显示提示+返回登录） */}
          {mode === 'forgot-password' &&
            (login.resetSuccess ? (
              <>
                <div className="login-modal__reset-success">{t.resetSuccess}</div>
                <div className="login-modal__links">
                  <button className="login-modal__link">{t.backToLogin}</button>
                </div>
              </>
            ) : (
              <>
                <div className="login-modal__email-form">
                  <div className="login-modal__field login-modal__field--code-row">
                    <input type="email" className="login-modal__input" placeholder={t.emailPlaceholder} />
                    <button className="login-modal__send-code-btn" disabled={codeDisabled}>
                      {sendCodeLabel(t, login)}
                    </button>
                  </div>
                  <div className="login-modal__field">
                    <input
                      type="text"
                      className="login-modal__input login-modal__input--code"
                      placeholder={t.codePlaceholder}
                      maxLength={6}
                      autoComplete="one-time-code"
                    />
                  </div>
                  <div className="login-modal__field">
                    <input type="password" className="login-modal__input" placeholder={t.newPasswordPlaceholder} />
                  </div>
                  <button
                    className="login-modal__login-btn"
                    disabled={!login.resetReady}
                    style={{ width: '100%', marginTop: '4px' }}
                  >
                    {t.resetPassword}
                  </button>
                </div>
                <div className="login-modal__links">
                  <button className="login-modal__link">{t.backToLogin}</button>
                </div>
              </>
            ))}
        </div>

        {/* B5：条款守卫二层（legacy guardAction——未同意时先弹，同意并继续执行挂起动作） */}
        {login.termsConfirm && (
          <div className="login-modal__terms-confirm-backdrop">
            <div className="login-modal__terms-confirm">
              <div className="login-modal__terms-confirm-title">{t.termsConfirmTitle}</div>
              <div className="login-modal__terms-confirm-desc">
                {t.termsConfirmBefore}
                <button className="login-modal__terms-link login-modal__terms-link--terms">{t.termsOfService}</button>
                {t.termsAnd}
                <button className="login-modal__terms-link login-modal__terms-link--privacy">{t.privacyPolicy}</button>
              </div>
              <div className="login-modal__terms-confirm-actions">
                <button className="login-modal__terms-confirm-cancel">{t.cancel}</button>
                <button className="login-modal__terms-confirm-agree">{t.agreeAndContinue}</button>
              </div>
            </div>
          </div>
        )}

        {/* B5：loading 蒙层 + spinner（legacy status==='loading'） */}
        {login.loading && (
          <div className="login-modal__loading">
            <div className="login-modal__spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
