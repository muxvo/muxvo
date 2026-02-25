/**
 * EmailLoginForm — Email + verification code login form
 */

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';

interface Props {
  onSendCode: (email: string) => Promise<boolean>;
  onLogin: (email: string, code: string) => Promise<void>;
  disabled?: boolean;
  error?: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

export function EmailLoginForm({ onSendCode, onLogin, disabled, error }: Props): JSX.Element {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendCode = useCallback(async () => {
    if (!EMAIL_REGEX.test(email) || cooldown > 0 || sending) return;
    setSending(true);
    const ok = await onSendCode(email);
    setSending(false);
    if (ok) {
      setCodeSent(true);
      setCooldown(COOLDOWN_SECONDS);
    }
  }, [email, cooldown, sending, onSendCode]);

  const handleLogin = useCallback(async () => {
    if (!email || !code || disabled) return;
    await onLogin(email, code);
  }, [email, code, disabled, onLogin]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (!codeSent) {
        handleSendCode();
      } else if (code.length > 0) {
        handleLogin();
      }
    }
  }, [codeSent, code, handleSendCode, handleLogin]);

  const emailValid = EMAIL_REGEX.test(email);

  return (
    <div className="login-modal__email-form" onKeyDown={handleKeyDown}>
      <div className="login-modal__field">
        <input
          type="email"
          className="login-modal__input"
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          autoComplete="email"
        />
        <button
          className="login-modal__send-code-btn"
          onClick={handleSendCode}
          disabled={!emailValid || cooldown > 0 || disabled || sending}
        >
          {sending
            ? t('auth.sending')
            : cooldown > 0
              ? `${cooldown}s`
              : codeSent
                ? t('auth.resendCode')
                : t('auth.sendCode')}
        </button>
      </div>

      {codeSent && (
        <div className="login-modal__field">
          <input
            type="text"
            className="login-modal__input"
            placeholder={t('auth.codePlaceholder')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={disabled}
            autoComplete="one-time-code"
            maxLength={6}
          />
          <button
            className="login-modal__login-btn"
            onClick={handleLogin}
            disabled={!code || disabled}
          >
            {t('auth.login')}
          </button>
        </div>
      )}

      {error && (
        <div className="login-modal__error">{error}</div>
      )}
    </div>
  );
}
