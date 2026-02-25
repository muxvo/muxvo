/**
 * UserDropdown — Dropdown menu for logged-in user (avatar, name, logout)
 */

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/renderer/contexts/AuthContext';
import { useI18n } from '@/renderer/i18n';
import './UserDropdown.css';

export function UserDropdown(): JSX.Element | null {
  const { state, logout } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!state.user) return null;

  const { user } = state;

  return (
    <div className="user-dropdown" ref={dropdownRef}>
      <button className="user-dropdown__trigger" onClick={() => setOpen(!open)}>
        {user.avatarUrl ? (
          <img className="user-dropdown__avatar" src={user.avatarUrl} alt={user.username} />
        ) : (
          <span className="user-dropdown__avatar-placeholder">
            {(user.username || user.email || '?')[0].toUpperCase()}
          </span>
        )}
      </button>

      {open && (
        <div className="user-dropdown__menu">
          <div className="user-dropdown__info">
            {user.avatarUrl ? (
              <img className="user-dropdown__menu-avatar" src={user.avatarUrl} alt={user.username} />
            ) : (
              <span className="user-dropdown__menu-avatar-placeholder">
                {(user.username || user.email || '?')[0].toUpperCase()}
              </span>
            )}
            <div className="user-dropdown__details">
              <span className="user-dropdown__name">{user.username || user.email}</span>
              <span className="user-dropdown__provider">{user.provider}</span>
            </div>
          </div>
          <div className="user-dropdown__divider" />
          <button
            className="user-dropdown__logout-btn"
            onClick={() => { setOpen(false); logout(); }}
          >
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
