/**
 * AuthButton — MenuBar entry point for auth
 * Shows "Login" when not authenticated, shows avatar when authenticated
 */

import { useAuth } from '@/renderer/contexts/AuthContext';
import { useI18n } from '@/renderer/i18n';
import { UserDropdown } from './UserDropdown';

export function AuthButton(): JSX.Element {
  const { state, dispatch } = useAuth();
  const { t } = useI18n();

  if (state.status === 'authenticated' && state.user) {
    return <UserDropdown />;
  }

  return (
    <button
      className="menu-bar__icon-btn"
      onClick={() => dispatch({ type: 'OPEN_LOGIN_MODAL' })}
      title={t('auth.loginButton')}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </button>
  );
}
