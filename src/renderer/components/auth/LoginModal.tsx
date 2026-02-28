/**
 * LoginModal — Modal dialog with login, register, and forgot-password modes
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { useAuth } from '@/renderer/contexts/AuthContext';
import { useI18n } from '@/renderer/i18n';
import { OAuthButton } from './OAuthButton';
import { PasswordLoginForm } from './PasswordLoginForm';
import { RegisterForm } from './RegisterForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import './LoginModal.css';

type Mode = 'buttons' | 'login' | 'register' | 'forgot-password';

export function LoginModal(): JSX.Element | null {
  const { state, dispatch, loginGithub, loginGoogle, sendEmailCode, loginPassword, register, resetPassword } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('buttons');
  const [agreed, setAgreed] = useState(false);
  const [showTermsConfirm, setShowTermsConfirm] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const isLoading = state.status === 'loading';

  // Reset mode and agreement when modal opens
  useEffect(() => {
    if (state.loginModalOpen) {
      setMode('buttons');
      setAgreed(false);
      setShowTermsConfirm(false);
      pendingActionRef.current = null;
    }
  }, [state.loginModalOpen]);

  // Guard action: if not agreed, show terms confirm; otherwise execute immediately
  const guardAction = useCallback((action: () => void) => {
    if (agreed) {
      action();
    } else {
      pendingActionRef.current = action;
      setShowTermsConfirm(true);
    }
  }, [agreed]);

  const handleConfirmTerms = useCallback(() => {
    setAgreed(true);
    setShowTermsConfirm(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  }, []);

  const handleCancelTerms = useCallback(() => {
    setShowTermsConfirm(false);
    pendingActionRef.current = null;
  }, []);

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
        : mode === 'login' ? t('auth.login')
          : t('auth.modalTitle');

  return (
    <div className="login-modal__backdrop" onClick={() => dispatch({ type: 'CLOSE_LOGIN_MODAL' })}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="login-modal__header">
          {mode !== 'buttons' ? (
            <button
              className="login-modal__back-btn"
              onClick={() => setMode(mode === 'forgot-password' ? 'login' : 'buttons')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : (
            <span />
          )}
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
          {mode === 'buttons' && (
            <>
              <OAuthButton
                provider="github"
                label={t('auth.loginGithub')}
                onClick={() => guardAction(loginGithub)}
                disabled={isLoading}
              />
              <OAuthButton
                provider="google"
                label={t('auth.loginGoogle')}
                onClick={() => guardAction(loginGoogle)}
                disabled={isLoading}
              />
              <OAuthButton
                provider="email"
                label={t('auth.emailPassword')}
                onClick={() => guardAction(() => setMode('login'))}
                disabled={isLoading}
              />
            </>
          )}

          {mode === 'login' && (
            <>
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

        {showTermsConfirm && (
          <div className="login-modal__terms-confirm-backdrop">
            <div className="login-modal__terms-confirm">
              <p className="login-modal__terms-confirm-title">{t('auth.termsConfirmTitle')}</p>
              <p className="login-modal__terms-confirm-desc">
                {t('auth.termsConfirmBefore')}
                <a href="https://muxvo.com/terms" target="_blank" rel="noopener noreferrer" className="login-modal__terms-link">
                  {t('auth.termsOfService')}
                </a>
                {t('auth.termsAnd')}
                <a href="https://muxvo.com/privacy" target="_blank" rel="noopener noreferrer" className="login-modal__terms-link">
                  {t('auth.privacyPolicy')}
                </a>
              </p>
              <div className="login-modal__terms-confirm-actions">
                <button className="login-modal__terms-confirm-cancel" onClick={handleCancelTerms}>
                  {t('auth.cancel')}
                </button>
                <button className="login-modal__terms-confirm-agree" onClick={handleConfirmTerms}>
                  {t('auth.agreeAndContinue')}
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="login-modal__loading">
            <div className="login-modal__spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
