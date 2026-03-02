/**
 * WelcomeOverlay — Full-screen welcome page shown before the onboarding tour.
 * Shown on first launch; user can start tour or skip.
 */

import { useCallback } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useI18n } from '@/renderer/i18n';
import { trackEvent } from '@/renderer/hooks/useAnalytics';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import './WelcomeOverlay.css';

export function WelcomeOverlay(): JSX.Element | null {
  const { state, dispatch } = usePanelContext();
  const { t } = useI18n();

  const handleStartTour = useCallback(() => {
    window.api.app.savePreferences({ tourCompleted: true }).catch(() => {});
    dispatch({ type: 'START_TOUR' });
  }, [dispatch]);

  const handleSkip = useCallback(() => {
    window.api.app.savePreferences({ tourCompleted: true }).catch(() => {});
    trackEvent(ANALYTICS_EVENTS.ONBOARDING.COMPLETE, { skipped: true });
    dispatch({ type: 'DISMISS_WELCOME' });
  }, [dispatch]);

  if (!state.tour.welcomeVisible) return null;

  return (
    <div className="welcome-overlay">
      <div className="welcome-overlay__card">
        <h1 className="welcome-overlay__title">
          {t('welcome.title' as any)}
        </h1>
        <p className="welcome-overlay__desc">
          {t('welcome.desc' as any)}
        </p>
        <div className="welcome-overlay__actions">
          <button
            className="welcome-overlay__start-btn"
            onClick={handleStartTour}
          >
            {t('welcome.startTour' as any)}
          </button>
          <button
            className="welcome-overlay__skip-btn"
            onClick={handleSkip}
          >
            {t('welcome.skip' as any)}
          </button>
        </div>
      </div>
    </div>
  );
}
