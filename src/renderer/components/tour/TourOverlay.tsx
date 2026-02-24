/**
 * TourOverlay — Interactive onboarding tour using driver.js
 * Highlights terminal UI elements step-by-step to teach core features.
 */

import { useEffect, useRef, useCallback } from 'react';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useI18n } from '@/renderer/i18n';
import { TOUR_STEPS } from '@/renderer/features/tour/steps';
import './TourOverlay.css';

interface Props {
  terminalCount: number;
}

export function TourOverlay({ terminalCount }: Props): JSX.Element | null {
  const { state, dispatch } = usePanelContext();
  const { t } = useI18n();
  const driverRef = useRef<Driver | null>(null);

  const completeTour = useCallback(() => {
    dispatch({ type: 'COMPLETE_TOUR' });
    window.api.app.savePreferences({ tourCompleted: true }).catch(() => {});
  }, [dispatch]);

  useEffect(() => {
    if (!state.tour.active) {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
      return;
    }

    // Check if terminal-dependent steps can be shown
    const hasTerminal = terminalCount > 0;

    // Build steps for driver.js
    const steps: DriveStep[] = TOUR_STEPS
      .filter((step) => {
        if (step.needsTerminal && !hasTerminal) return false;
        return true;
      })
      .map((step) => ({
        element: step.selector,
        popover: {
          title: t(step.i18nTitleKey as any),
          description: t(step.i18nDescKey as any),
          side: step.side,
          popoverClass: 'tour-popover',
        },
      }));

    // If no terminals exist, show a prompt step pointing to the + button
    if (!hasTerminal) {
      steps.push({
        element: '.menu-bar__add-btn',
        popover: {
          title: t('tour.noTerminal.title'),
          description: t('tour.noTerminal.desc'),
          side: 'bottom',
          popoverClass: 'tour-popover',
        },
      });
    }

    const driverInstance = driver({
      showProgress: true,
      animate: true,
      overlayColor: 'rgba(6, 8, 12, 0.8)',
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: 'tour-popover',
      nextBtnText: t('tour.next'),
      prevBtnText: t('tour.prev'),
      doneBtnText: t('tour.done'),
      progressText: '{{current}} / {{total}}',
      onCloseClick: () => {
        driverInstance.destroy();
        completeTour();
      },
      onDestroyed: () => {
        completeTour();
      },
    });

    driverInstance.setSteps(steps);
    driverInstance.drive();
    driverRef.current = driverInstance;

    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, [state.tour.active, terminalCount, t, completeTour]);

  return null;
}
