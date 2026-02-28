/**
 * PasswordLoginForm — Email + password login form
 */

import { useState, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  disabled?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PasswordLoginForm({ onLogin, disabled }: Props): JSX.Element {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const emailValid = EMAIL_REGEX.test(email);
  const canSubmit = emailValid && password.length > 0 && !disabled;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    await onLogin(email, password);
  }, [canSubmit, email, password, onLogin]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  }, [handleSubmit]);

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
      </div>
      <div className="login-modal__field">
        <input
          type="password"
          className="login-modal__input"
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={disabled}
          autoComplete="current-password"
        />
      </div>
      <button
        className="login-modal__login-btn"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{ width: '100%', marginTop: '4px' }}
      >
        {t('auth.login')}
      </button>
    </div>
  );
}
