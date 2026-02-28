/**
 * LoginModal — Modal dialog with login, register, and forgot-password modes
 */

import { useEffect, useCallback, useState } from 'react';
import { useAuth } from '@/renderer/contexts/AuthContext';
import { useI18n } from '@/renderer/i18n';
import { OAuthButton } from './OAuthButton';
import { PasswordLoginForm } from './PasswordLoginForm';
import { RegisterForm } from './RegisterForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import './LoginModal.css';

type Mode = 'login' | 'register' | 'forgot-password';

export function LoginModal(): JSX.Element | null {
  const { state, dispatch, loginGithub, loginGoogle, sendEmailCode, loginPassword, register, resetPassword } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('login');

  const isLoading = state.status === 'loading';

  // Reset mode when modal opens
  useEffect(() => {
    if (state.loginModalOpen) setMode('login');
  }, [state.loginModalOpen]);

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dispatch({ type: 'CLOSE_LOGIN_MODAL' });
    }
  }, [dispatch]);

  useEffect(() => {
    if (!state.loginModalOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.loginModalOpen, handleKeyDown]);

  // Auto-clear error after 3s
  useEffect(() => {
    if (!state.error) return;
    const timer = setTimeout(() => dispatch({ type: 'CLEAR_ERROR' }), 3000);
    return () => clearTimeout(timer);
  }, [state.error, dispatch]);

  if (!state.loginModalOpen) return null;

  const title =
    mode === 'register' ? t('auth.createAccount')
      : mode === 'forgot-password' ? t('auth.resetPassword')
        : t('auth.modalTitle');

  return (
    <div className="login-modal__backdrop" onClick={() => dispatch({ type: 'CLOSE_LOGIN_MODAL' })}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="login-modal__header">
          <span className="login-modal__title">{title}</span>
          <button
            className="login-modal__close-btn"
            onClick={() => dispatch({ type: 'CLOSE_LOGIN_MODAL' })}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {state.error && (
          <div className="login-modal__error-bar">
            <span>{state.error}</span>
            <button className="login-modal__error-dismiss" onClick={() => dispatch({ type: 'CLEAR_ERROR' })}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        <div className="login-modal__body">
          {mode === 'login' && (
            <>
              <OAuthButton
                provider="github"
                label={t('auth.loginGithub')}
                onClick={loginGithub}
                disabled={isLoading}
              />
              <OAuthButton
                provider="google"
                label={t('auth.loginGoogle')}
                onClick={loginGoogle}
                disabled={isLoading}
              />

              <div className="login-modal__divider">
                <span>{t('auth.orPassword')}</span>
              </div>

              <PasswordLoginForm
                onLogin={loginPassword}
                disabled={isLoading}
              />

              <div className="login-modal__links">
                <button className="login-modal__link" onClick={() => setMode('register')}>
                  {t('auth.createAccount')}
                </button>
                <button className="login-modal__link" onClick={() => setMode('forgot-password')}>
                  {t('auth.forgotPassword')}
                </button>
              </div>
            </>
          )}

          {mode === 'register' && (
            <>
              <RegisterForm
                onSendCode={sendEmailCode}
                onRegister={register}
                disabled={isLoading}
              />

              <div className="login-modal__links">
                <button className="login-modal__link" onClick={() => setMode('login')}>
                  {t('auth.alreadyHaveAccount')}
                </button>
              </div>
            </>
          )}

          {mode === 'forgot-password' && (
            <ForgotPasswordForm
              onSendCode={sendEmailCode}
              onReset={resetPassword}
              onBackToLogin={() => setMode('login')}
              disabled={isLoading}
            />
          )}
        </div>

        <div className="login-modal__footer">
          <span className="login-modal__terms">{t('auth.termsNotice')}</span>
        </div>

        {isLoading && (
          <div className="login-modal__loading">
            <div className="login-modal__spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
