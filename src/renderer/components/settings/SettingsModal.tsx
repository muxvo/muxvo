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
  const [dblClickFocus, setDblClickFocus] = useState(false);
  const [dockBadgeMode, setDockBadgeMode] = useState<'off' | 'realtime' | 'timed'>('off');
  const [dockBadgeInterval, setDockBadgeInterval] = useState(1);
  const [intervalInputValue, setIntervalInputValue] = useState('1');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'up-to-date' | 'error'>('idle');
  const [newVersion, setNewVersion] = useState('');

  // Load startup terminal count from config
  useEffect(() => {
    if (!state.settingsModal.open) return;
    window.api.app.getConfig().then((result: any) => {
      if (result?.data?.startupTerminalCount) {
        setStartupCount(Math.max(1, Math.min(20, result.data.startupTerminalCount)));
      }
      setDblClickFocus(result?.data?.doubleClickToFocus === true);
      setDockBadgeMode(result?.data?.dockBadgeMode ?? 'off');
      const iv = result?.data?.dockBadgeIntervalMin ?? 1;
      setDockBadgeInterval(iv);
      setIntervalInputValue(String(iv));
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

  const handleDblClickFocusChange = useCallback((enabled: boolean) => {
    setDblClickFocus(enabled);
    window.api.app.getConfig().then((result: any) => {
      window.api.app.saveConfig({ ...result?.data, doubleClickToFocus: enabled });
      window.dispatchEvent(new CustomEvent('muxvo:config-changed'));
    }).catch(() => {});
  }, []);

  const handleDockBadgeChange = useCallback((mode: 'off' | 'realtime' | 'timed') => {
    setDockBadgeMode(mode);
    window.api.app.getConfig().then((result: any) => {
      window.api.app.saveConfig({ ...result?.data, dockBadgeMode: mode });
    }).catch(() => {});
  }, []);

  const handleDockBadgeIntervalChange = useCallback((val: number) => {
    setDockBadgeInterval(val);
    setIntervalInputValue(String(val));
    window.api.app.getConfig().then((result: any) => {
      window.api.app.saveConfig({ ...result?.data, dockBadgeIntervalMin: val });
    }).catch(() => {});
  }, []);

  const handleIntervalInputBlur = useCallback(() => {
    const v = parseInt(intervalInputValue, 10);
    if (isNaN(v) || v < 1) {
      handleDockBadgeIntervalChange(1);
    } else {
      handleDockBadgeIntervalChange(v);
    }
  }, [intervalInputValue, handleDockBadgeIntervalChange]);

  const isMac = navigator.platform.startsWith('Mac');

  const handleRestartTour = useCallback(() => {
    dispatch({ type: 'CLOSE_SETTINGS' });
    setTimeout(() => dispatch({ type: 'START_TOUR' }), 100);
  }, [dispatch]);

  const handleCheckUpdate = useCallback(() => {
    setUpdateStatus('checking');
    window.api.app.checkForUpdate().then(() => {
      // Result comes via onUpdateAvailable or we timeout to "up-to-date"
      setTimeout(() => {
        setUpdateStatus((prev) => prev === 'checking' ? 'up-to-date' : prev);
      }, 8000);
    }).catch(() => setUpdateStatus('error'));
  }, []);

  // Listen for update-available event when settings is open
  useEffect(() => {
    if (!state.settingsModal.open) return;
    setUpdateStatus('idle');
    const unsub = window.api.app.onUpdateAvailable((data) => {
      setUpdateStatus('available');
      setNewVersion(data.version);
    });
    return () => { unsub(); };
  }, [state.settingsModal.open]);

  const handleDownloadUpdate = useCallback(() => {
    window.api.app.downloadUpdate();
    dispatch({ type: 'CLOSE_SETTINGS' });
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
              <div className="settings-modal__stepper">
                <button
                  className="settings-modal__stepper-btn"
                  onClick={() => handleStartupCountChange(Math.max(1, startupCount - 1))}
                  disabled={startupCount <= 1}
                >&#x2212;</button>
                <span className="settings-modal__stepper-value">{startupCount}</span>
                <button
                  className="settings-modal__stepper-btn"
                  onClick={() => handleStartupCountChange(Math.min(20, startupCount + 1))}
                  disabled={startupCount >= 20}
                >&#x2b;</button>
              </div>
            </div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t('settings.doubleClickFocus')}</div>
                <div className="settings-modal__desc">{t('settings.doubleClickFocusDesc')}</div>
              </div>
              <div className="settings-modal__toggle-group">
                <button
                  className={`settings-modal__toggle-btn${dblClickFocus ? ' settings-modal__toggle-btn--active' : ''}`}
                  onClick={() => { if (!dblClickFocus) handleDblClickFocusChange(true); }}
                >
                  {t('settings.enabled')}
                </button>
                <button
                  className={`settings-modal__toggle-btn${!dblClickFocus ? ' settings-modal__toggle-btn--active' : ''}`}
                  onClick={() => { if (dblClickFocus) handleDblClickFocusChange(false); }}
                >
                  {t('settings.disabled')}
                </button>
              </div>
            </div>
            {isMac && (
              <>
                <div className="settings-modal__row">
                  <div>
                    <div className="settings-modal__label">{t('settings.dockBadge')}</div>
                    <div className="settings-modal__desc">{t('settings.dockBadgeDesc')}</div>
                  </div>
                  <div className="settings-modal__badge-toggle">
                    <button
                      className={`settings-modal__badge-toggle-btn${dockBadgeMode === 'off' ? ' settings-modal__badge-toggle-btn--active' : ''}`}
                      onClick={() => handleDockBadgeChange('off')}
                    >{t('settings.dockBadgeOff')}</button>
                    <button
                      className={`settings-modal__badge-toggle-btn${dockBadgeMode === 'realtime' ? ' settings-modal__badge-toggle-btn--active' : ''}`}
                      onClick={() => handleDockBadgeChange('realtime')}
                    >{t('settings.dockBadgeRealtime')}</button>
                    <button
                      className={`settings-modal__badge-toggle-btn${dockBadgeMode === 'timed' ? ' settings-modal__badge-toggle-btn--active' : ''}`}
                      onClick={() => handleDockBadgeChange('timed')}
                    >{t('settings.dockBadgeTimed')}</button>
                  </div>
                </div>
                {dockBadgeMode === 'timed' && (
                  <div className="settings-modal__badge-sub-row">
                    <div className="settings-modal__badge-sub-label">{t('settings.dockBadgeInterval')}</div>
                    <div className="settings-modal__badge-sub-controls">
                      <div className="settings-modal__stepper">
                        <button
                          className="settings-modal__stepper-btn"
                          onClick={() => handleDockBadgeIntervalChange(Math.max(1, dockBadgeInterval - 1))}
                          disabled={dockBadgeInterval <= 1}
                        >&#x2212;</button>
                        <input
                          className="settings-modal__stepper-input"
                          type="text"
                          inputMode="numeric"
                          value={intervalInputValue}
                          size={Math.max(1, intervalInputValue.length)}
                          onChange={(e) => setIntervalInputValue(e.target.value.replace(/[^\d]/g, ''))}
                          onBlur={handleIntervalInputBlur}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        />
                        <button
                          className="settings-modal__stepper-btn"
                          onClick={() => handleDockBadgeIntervalChange(dockBadgeInterval + 1)}
                        >&#x2b;</button>
                      </div>
                      <span className="settings-modal__badge-sub-unit">{t('settings.dockBadgeIntervalUnit')}</span>
                    </div>
                  </div>
                )}
              </>
            )}
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

          {/* Shortcuts Section */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t('settings.shortcuts')}</div>
            <div className="settings-modal__shortcut-list">
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t('settings.shortcutNewTerminal')}</span>
                <kbd className="settings-modal__kbd">⌘T</kbd>
              </div>
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t('settings.shortcutLineStart')}</span>
                <kbd className="settings-modal__kbd">⌘←</kbd>
              </div>
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t('settings.shortcutLineEnd')}</span>
                <kbd className="settings-modal__kbd">⌘→</kbd>
              </div>
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t('settings.zoom')}</span>
                <div className="settings-modal__kbd-group">
                  <kbd className="settings-modal__kbd">⌘+</kbd>
                  <kbd className="settings-modal__kbd">⌘-</kbd>
                  <kbd className="settings-modal__kbd">⌘0</kbd>
                </div>
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
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{locale === 'zh' ? '检查更新' : 'Check for Updates'}</div>
                <div className="settings-modal__desc">
                  {locale === 'zh' ? '当前版本' : 'Current version'} v{__APP_VERSION__}
                </div>
              </div>
              {updateStatus === 'idle' && (
                <button className="settings-modal__tour-btn" onClick={handleCheckUpdate}>
                  {locale === 'zh' ? '检查更新' : 'Check'}
                </button>
              )}
              {updateStatus === 'checking' && (
                <span className="settings-modal__desc">{locale === 'zh' ? '检查中...' : 'Checking...'}</span>
              )}
              {updateStatus === 'up-to-date' && (
                <span className="settings-modal__desc">{locale === 'zh' ? '已是最新版本' : 'Up to date'}</span>
              )}
              {updateStatus === 'available' && (
                <button className="settings-modal__tour-btn" onClick={handleDownloadUpdate}>
                  {locale === 'zh' ? `下载 v${newVersion}` : `Download v${newVersion}`}
                </button>
              )}
              {updateStatus === 'error' && (
                <span className="settings-modal__desc" style={{ color: '#ff5f57' }}>
                  {locale === 'zh' ? '检查失败' : 'Check failed'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
