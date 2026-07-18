/**
 * 登录弹窗 live 接线（右上角批 B5；login-modal.md §1/§5，legacy LoginModal.tsx 行为对齐）：
 * golden 视觉件 LoginModalScreen 零 onClick——本层持状态机（mode/error/loading/termsAgreed/冷却）
 * 经事件委托驱动，输入用非受控 input（提交时 DOM 读值；React 重渲保留 DOM 值）。
 *
 * 行为合同（legacy 逐条）：
 * - mode 机：buttons ⇄ login/register/forgot；back：forgot→login、其余→buttons；每次挂载=打开重置
 *   （buttons 态 + termsAgreed=false——条款同意不持久化，每开重置）。
 * - 条款守卫：三入口（GitHub/Google/账号密码）均先过 guard——未同意先弹 __terms-confirm 二层，
 *   「同意并继续」置 agreed 并执行挂起动作；条款/隐私链接经 app.request openExternal 系统浏览器。
 * - OAuth：authLoginOAuth{provider} → authAck（native 已开浏览器+起轮询）→ loading 至
 *   authStatusChanged 登录成功（AuthContext）或 **2 分钟超时**（'登录超时，请重试'）。
 * - 密码登录：email 合法 + 密码非空才可提交（Enter 同）；rejected → 错误条（3s 自清）。
 * - 注册/重置：6 位验证码（输入即剥非数字截 6 位）+ 密码 ≥8；发送验证码 60s 冷却；
 *   重置成功**不自动登录**（服务端吊销全部 token），显示成功提示 + 返回登录。
 * - 登录成功（auth.loggedIn 翻真）→ 自动关闭弹窗（legacy LOGIN_SUCCESS 连带 close）。
 * golden 铁律：仅 LiveChrome（bridge 路径）挂载。
 */

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { AppRequest } from '../../bridge/gen/protocol';
import { useConfig, useConfigApi } from '../../config/ConfigContext';
import { useAuth } from '../../config/AuthContext';
import { authErrorText, type AuthErrorScope } from './auth-strings';
import { LoginModalScreen, type LoginFx } from './LoginModalScreen';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // legacy client regex
const OAUTH_TIMEOUT_MS = 2 * 60 * 1000; // legacy OAUTH_TIMEOUT_MS
const COOLDOWN_SECONDS = 60; // legacy 重发冷却
const ERROR_AUTO_CLEAR_MS = 3000; // legacy 错误条 3s 自清

type Mode = 'buttons' | 'login' | 'register' | 'forgot-password';

export function LoginModalLive({ onClose }: { onClose: () => void }): JSX.Element | null {
  const api = useConfigApi();
  const cfg = useConfig();
  const { auth } = useAuth();
  const [mode, setMode] = useState<Mode>('buttons');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [termsConfirm, setTermsConfirm] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [codeSending, setCodeSending] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [codeSentOnce, setCodeSentOnce] = useState(false); // 重发文案粘性（legacy codeSent）
  const [formTick, setFormTick] = useState(0); // 输入变化重算 disabled（非受控值在 DOM）
  const agreedRef = useRef(false); // 条款同意（内存态，不持久化）
  const pendingActionRef = useRef<(() => void) | null>(null);
  const oauthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 登录成功 → 自动关闭（legacy LOGIN_SUCCESS 连带 CLOSE_LOGIN_MODAL）。
  useEffect(() => {
    if (auth?.loggedIn) {
      if (oauthTimerRef.current) clearTimeout(oauthTimerRef.current);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.loggedIn]);

  // 错误条 3s 自清（legacy CLEAR_ERROR 定时器）。
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), ERROR_AUTO_CLEAR_MS);
    return () => clearTimeout(t);
  }, [error]);

  // 冷却倒计时（legacy 60s 每秒递减）。
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Esc 关闭（legacy modal Esc；capture 先于 LiveChrome 面板 Esc）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (oauthTimerRef.current) clearTimeout(oauthTimerRef.current);
    },
    [],
  );

  if (!api) return null;

  // —— 非受控输入读值（按 mode 内结构定位；React 重渲保留 DOM 值） ——
  const readInputs = (): { email: string; password: string; code: string } => {
    const root = rootRef.current;
    const email = (root?.querySelector('input[type="email"]') as HTMLInputElement | null)?.value ?? '';
    const password = (root?.querySelector('input[type="password"]') as HTMLInputElement | null)?.value ?? '';
    const code = (root?.querySelector('.login-modal__input--code') as HTMLInputElement | null)?.value ?? '';
    return { email: email.trim(), password, code };
  };

  const request = (
    req: AppRequest,
    scope: AuthErrorScope,
    onOk?: (kind: string) => void,
  ): void => {
    void api
      .sendAppRequest(req)
      .then((resp) => {
        if (resp.kind === 'rejected') {
          setLoading(false);
          setCodeSending(false);
          setError(authErrorText(resp.code, scope));
        } else {
          onOk?.(resp.kind);
        }
      })
      .catch(() => {
        setLoading(false);
        setCodeSending(false);
        setError(authErrorText('AUTH_NETWORK', scope));
      });
  };

  // —— 条款守卫（legacy guardAction）——
  const guardAction = (action: () => void): void => {
    if (agreedRef.current) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setTermsConfirm(true);
  };

  const startOAuth = (provider: 'github' | 'google'): void => {
    setLoading(true);
    request({ kind: 'authLoginOAuth', provider }, 'login', () => {
      // authAck：native 已开系统浏览器 + 起 /auth/poll 轮询；2 分钟无果 → 超时（legacy 同窗）。
      if (oauthTimerRef.current) clearTimeout(oauthTimerRef.current);
      oauthTimerRef.current = setTimeout(() => {
        setLoading(false);
        setError(authErrorText('AUTH_TIMEOUT', 'login'));
      }, OAUTH_TIMEOUT_MS);
    });
  };

  const submitLogin = (): void => {
    const { email, password } = readInputs();
    if (!EMAIL_RE.test(email) || password.length === 0) return;
    setLoading(true);
    request({ kind: 'authLoginPassword', email, password }, 'login');
    // 成功走 authStatusChanged → auth.loggedIn effect 关窗；此处不清 loading（成功关窗/失败分支清）
  };

  const sendCode = (purpose: 'register' | 'reset'): void => {
    const { email } = readInputs();
    if (!EMAIL_RE.test(email) || cooldown > 0 || codeSending) return;
    setCodeSending(true);
    request({ kind: 'authSendEmailCode', email, purpose }, 'sendCode', () => {
      setCodeSending(false);
      setCodeSentOnce(true); // 粘住「重新发送」（legacy codeSent 粘性）
      setCooldown(COOLDOWN_SECONDS);
    });
  };

  const submitRegister = (): void => {
    const { email, password, code } = readInputs();
    if (!EMAIL_RE.test(email) || code.length !== 6 || password.length < 8) return;
    setLoading(true);
    request({ kind: 'authRegister', email, code, password }, 'register');
  };

  const submitReset = (): void => {
    const { email, password, code } = readInputs();
    if (!EMAIL_RE.test(email) || code.length !== 6 || password.length < 8) return;
    setLoading(true);
    request({ kind: 'authResetPassword', email, code, newPassword: password }, 'reset', () => {
      setLoading(false);
      setResetSuccess(true); // legacy：重置成功不自动登录（服务端吊销全部 token）
    });
  };

  const switchMode = (next: Mode): void => {
    setMode(next);
    setError(null);
    setResetSuccess(false);
    setCooldown(0);
    setCodeSentOnce(false);
    setFormTick(0);
  };

  // —— 事件委托 ——
  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('login-modal__backdrop')) {
      onClose();
      return;
    }
    if (target.closest('.login-modal__error-dismiss')) {
      setError(null); // 手动即清（MINOR-1，legacy dismiss 钮）
      return;
    }
    // 条款二层优先（盖在正文上）
    if (target.closest('.login-modal__terms-link--terms')) {
      void api.sendAppRequest({ kind: 'openExternal', url: 'https://muxvo.com/terms' });
      return;
    }
    if (target.closest('.login-modal__terms-link--privacy')) {
      void api.sendAppRequest({ kind: 'openExternal', url: 'https://muxvo.com/privacy' });
      return;
    }
    if (target.closest('.login-modal__terms-confirm-agree')) {
      agreedRef.current = true;
      setTermsConfirm(false);
      const pending = pendingActionRef.current;
      pendingActionRef.current = null;
      pending?.();
      return;
    }
    if (target.closest('.login-modal__terms-confirm-cancel')) {
      setTermsConfirm(false);
      pendingActionRef.current = null;
      return;
    }
    const btn = target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('login-modal__close-btn')) {
      onClose();
      return;
    }
    if (btn.classList.contains('login-modal__back-btn')) {
      switchMode(mode === 'forgot-password' ? 'login' : 'buttons'); // legacy back 规则
      return;
    }
    if (btn.classList.contains('login-modal__oauth-btn--github')) {
      guardAction(() => startOAuth('github'));
      return;
    }
    if (btn.classList.contains('login-modal__oauth-btn--google')) {
      guardAction(() => startOAuth('google'));
      return;
    }
    if (btn.classList.contains('login-modal__oauth-btn--email')) {
      guardAction(() => switchMode('login'));
      return;
    }
    if (btn.classList.contains('login-modal__send-code-btn')) {
      sendCode(mode === 'register' ? 'register' : 'reset');
      return;
    }
    if (btn.classList.contains('login-modal__login-btn')) {
      if (mode === 'login') submitLogin();
      else if (mode === 'register') submitRegister();
      else if (mode === 'forgot-password') submitReset();
      return;
    }
    if (btn.classList.contains('login-modal__link')) {
      const label = btn.textContent ?? '';
      if (label.includes('创建账号')) switchMode('register');
      else if (label.includes('忘记密码')) switchMode('forgot-password');
      else switchMode('login'); // 已有账号？登录 / 返回登录
    }
  };

  const onInput = (e: FormEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLInputElement;
    // 验证码输入即剥非数字截 6 位（legacy one-time-code 语义）
    if (target.classList?.contains('login-modal__input--code')) {
      const digits = target.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== target.value) target.value = digits;
    }
    setFormTick((n) => n + 1); // 重算 disabled
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter') return;
    if (mode === 'login') submitLogin(); // legacy Enter 提交
    else if (mode === 'register') submitRegister();
    else if (mode === 'forgot-password') submitReset();
  };

  // —— fx 派生（禁用态从 DOM 现值算；formTick 驱动重算） ——
  void formTick;
  const { email, password, code } = readInputs();
  const emailValid = EMAIL_RE.test(email);
  const login: LoginFx = {
    mode,
    error: error ?? undefined,
    loading: loading || undefined,
    termsConfirm: termsConfirm || undefined,
    canSubmit: mode === 'login' && emailValid && password.length > 0,
    registerReady: mode === 'register' && emailValid && code.length === 6 && password.length >= 8,
    resetReady: mode === 'forgot-password' && emailValid && code.length === 6 && password.length >= 8,
    codeCooldown: cooldown > 0 ? cooldown : undefined,
    codeSending: codeSending || undefined,
    codeSendEnabled: emailValid && cooldown === 0 && !codeSending,
    resetSuccess: resetSuccess || undefined,
    codeSentOnce: codeSentOnce || undefined,
  };

  return (
    <div ref={rootRef} onClick={onClick} onInput={onInput} onKeyDown={onKeyDown} data-hit-island="" data-live-login="">
      <LoginModalScreen fx={{ login, locale: cfg?.language === 'en' ? 'en' : 'zh' }} />
    </div>
  );
}
