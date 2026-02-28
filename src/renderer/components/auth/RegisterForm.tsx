/**
 * RegisterForm — Email + code + password registration form
 */

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';

interface Props {
  onSendCode: (email: string, purpose?: string) => Promise<boolean>;
  onRegister: (email: string, code: string, password: string) => Promise<void>;
  disabled?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

export function RegisterForm({ onSendCode, onRegister, disabled }: Props): JSX.Element {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const emailValid = EMAIL_REGEX.test(email);
  const passwordValid = password.length >= 8;

  const handleSendCode = useCallback(async () => {
    if (!emailValid || cooldown > 0 || sending) return;
    setSending(true);
    const ok = await onSendCode(email, 'register');
    setSending(false);
    if (ok) {
      setCodeSent(true);
      setCooldown(COOLDOWN_SECONDS);
    }
  }, [email, emailValid, cooldown, sending, onSendCode]);

  const handleRegister = useCallback(async () => {
    if (!email || !code || !passwordValid || disabled) return;
    await onRegister(email, code, password);
  }, [email, code, password, passwordValid, disabled, onRegister]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (!codeSent) {
        handleSendCode();
      } else if (code.length > 0 && passwordValid) {
        handleRegister();
      }
    }
  }, [codeSent, code, passwordValid, handleSendCode, handleRegister]);

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
        <>
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
          </div>
          <div className="login-modal__field">
            <input
              type="password"
              className="login-modal__input"
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={disabled}
              autoComplete="new-password"
            />
          </div>
          {password.length > 0 && !passwordValid && (
            <div className="login-modal__hint login-modal__hint--error">
              {t('auth.passwordTooShort')}
            </div>
          )}
          <button
            className="login-modal__login-btn"
            onClick={handleRegister}
            disabled={!code || !passwordValid || disabled}
            style={{ width: '100%', marginTop: '4px' }}
          >
            {t('auth.register')}
          </button>
        </>
      )}
    </div>
  );
}
