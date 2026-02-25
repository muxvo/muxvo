import { useState, useEffect, useCallback } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useI18n } from '@/renderer/i18n';
import './SettingsModal.css';

interface SettingsModalProps {
  uiTheme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function SettingsModal({ uiTheme, onToggleTheme }: SettingsModalProps): JSX.Element | null {
  const { state, dispatch } = usePanelContext();
  const { t, locale, setLocale } = useI18n();
  const [startupCount, setStartupCount] = useState(1);

  // Load startup terminal count from config
  useEffect(() => {
    if (!state.settingsModal.open) return;
    window.api.app.getConfig().then((result: any) => {
      if (result?.data?.startupTerminalCount) {
        setStartupCount(Math.max(1, Math.min(5, result.data.startupTerminalCount)));
      }
    }).catch(() => {});
  }, [state.settingsModal.open]);

  const handleClose = useCallback(() => {
    dispatch({ type: 'CLOSE_SETTINGS' });
  }, [dispatch]);

  // ESC to close
  useEffect(() => {
    if (!state.settingsModal.open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.settingsModal.open, handleClose]);

  const handleStartupCountChange = useCallback((count: number) => {
    setStartupCount(count);
    window.api.app.getConfig().then((result: any) => {
      window.api.app.saveConfig({ ...result?.data, startupTerminalCount: count });
    }).catch(() => {});
  }, []);

  const handleRestartTour = useCallback(() => {
    dispatch({ type: 'CLOSE_SETTINGS' });
    setTimeout(() => dispatch({ type: 'START_TOUR' }), 100);
  }, [dispatch]);

  if (!state.settingsModal.open) return null;

  return (
    <div className="settings-modal__backdrop" onClick={handleClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-modal__header">
          <div className="settings-modal__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t('settings.title')}
          </div>
          <button className="settings-modal__close" onClick={handleClose}>&#x2715;</button>
        </div>

        <div className="settings-modal__body">
          {/* General Section */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t('settings.general')}</div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t('settings.startupTerminals')}</div>
                <div className="settings-modal__desc">{t('settings.startupTerminalsDesc')}</div>
              </div>
              <div className="settings-modal__num-group">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    className={`settings-modal__num-btn${n === startupCount ? ' settings-modal__num-btn--active' : ''}`}
                    onClick={() => handleStartupCountChange(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Appearance Section */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t('settings.appearance')}</div>
            <div className="settings-modal__row">
              <div className="settings-modal__label">{t('settings.theme')}</div>
              <div className="settings-modal__toggle-group">
                <button
                  className={`settings-modal__toggle-btn${uiTheme === 'light' ? ' settings-modal__toggle-btn--active' : ''}`}
                  onClick={() => { if (uiTheme !== 'light') onToggleTheme(); }}
                >
                  {t('settings.themeLight')}
                </button>
                <button
                  className={`settings-modal__toggle-btn${uiTheme === 'dark' ? ' settings-modal__toggle-btn--active' : ''}`}
                  onClick={() => { if (uiTheme !== 'dark') onToggleTheme(); }}
                >
                  {t('settings.themeDark')}
                </button>
              </div>
            </div>
          </div>

          {/* Language Section */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t('settings.language')}</div>
            <div className="settings-modal__row">
              <div className="settings-modal__label">{t('settings.lang')}</div>
              <div className="settings-modal__toggle-group">
                <button
                  className={`settings-modal__toggle-btn${locale === 'zh' ? ' settings-modal__toggle-btn--active' : ''}`}
                  onClick={() => setLocale('zh')}
                >
                  {t('settings.langZh')}
                </button>
                <button
                  className={`settings-modal__toggle-btn${locale === 'en' ? ' settings-modal__toggle-btn--active' : ''}`}
                  onClick={() => setLocale('en')}
                >
                  {t('settings.langEn')}
                </button>
              </div>
            </div>
          </div>

          {/* Help Section */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t('settings.help')}</div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t('settings.restartTour')}</div>
                <div className="settings-modal__desc">{t('settings.restartTourDesc')}</div>
              </div>
              <button className="settings-modal__tour-btn" onClick={handleRestartTour}>
                {t('settings.restartTour')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
