/**
 * TourOverlay — Interactive onboarding tour using driver.js
 * Users perform actions at each step; the tour auto-advances after 0.5s.
 */

import { useEffect, useRef, useCallback } from 'react';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useI18n } from '@/renderer/i18n';
import { TOUR_STEPS } from '@/renderer/features/tour/steps';
import { trackEvent } from '@/renderer/hooks/useAnalytics';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import './TourOverlay.css';

const ADVANCE_DELAY = 500; // 0.5s delay before auto-advancing

interface Props {
  terminalCount: number;
  viewMode: 'Tiling' | 'Focused';
  terminalNames: Record<string, string>;
}

export function TourOverlay({ terminalCount, viewMode, terminalNames }: Props): null {
  const { state, dispatch } = usePanelContext();
  const { t } = useI18n();
  const driverRef = useRef<Driver | null>(null);
  const currentStepRef = useRef<number>(0);
  const prevTerminalCountRef = useRef<number>(terminalCount);
  const prevViewModeRef = useRef<'Tiling' | 'Focused'>(viewMode);
  const prevHasNameRef = useRef<boolean>(Object.values(terminalNames).some(n => n && n.length > 0));

  const completeTour = useCallback((skipped = false) => {
    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
    trackEvent(ANALYTICS_EVENTS.ONBOARDING.COMPLETE, { skipped });
    dispatch({ type: 'COMPLETE_TOUR' });
    window.api.app.savePreferences({ tourCompleted: true }).catch(() => {});
  }, [dispatch]);

  const moveNext = useCallback(() => {
    setTimeout(() => {
      if (driverRef.current) {
        trackEvent(ANALYTICS_EVENTS.ONBOARDING.STEP, { step: currentStepRef.current, total: TOUR_STEPS.length });
        if (!driverRef.current.hasNextStep()) {
          completeTour();
        } else {
          driverRef.current.moveNext();
        }
      }
    }, ADVANCE_DELAY);
  }, [completeTour]);

  // Get the actionType of the current active step
  const getCurrentActionType = useCallback(() => {
    const idx = currentStepRef.current;
    if (idx >= 0 && idx < TOUR_STEPS.length) {
      return TOUR_STEPS[idx].actionType;
    }
    return null;
  }, []);

  // === Sync refs when tour starts (runs BEFORE step detection effects) ===
  useEffect(() => {
    if (state.tour.active) {
      prevTerminalCountRef.current = terminalCount;
      prevViewModeRef.current = viewMode;
      prevHasNameRef.current = Object.values(terminalNames).some(n => n && n.length > 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tour.active]);

  // === Action detection effects ===

  // Step 1: Detect terminal created — hide overlay so user can see new terminal
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'create-terminal') return;
    if (terminalCount > prevTerminalCountRef.current) {
      const overlay = document.querySelector('.driver-overlay') as HTMLElement;
      if (overlay) overlay.style.display = 'none';
      moveNext();
    }
    prevTerminalCountRef.current = terminalCount;
  }, [state.tour.active, terminalCount, getCurrentActionType, moveNext]);

  // Step 2: Detect focus mode (viewMode changed to Focused)
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'focus') return;
    if (viewMode === 'Focused' && prevViewModeRef.current === 'Tiling') {
      moveNext();
    }
    prevViewModeRef.current = viewMode;
  }, [state.tour.active, viewMode, getCurrentActionType, moveNext]);

  // Step 3: Detect rename
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'rename') return;
    const hasName = Object.values(terminalNames).some(n => n && n.length > 0);
    if (hasName && !prevHasNameRef.current) {
      moveNext();
    }
    prevHasNameRef.current = hasName;
  }, [state.tour.active, terminalNames, getCurrentActionType, moveNext]);

  // Step 4: Detect file panel opened → complete tour after delay
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'open-file') return;
    if (state.filePanel.open) {
      setTimeout(() => completeTour(), ADVANCE_DELAY);
    }
  }, [state.tour.active, state.filePanel.open, getCurrentActionType, completeTour]);

  // === Main driver.js lifecycle ===
  useEffect(() => {
    if (!state.tour.active) {
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
      return;
    }

    // Reset refs
    prevTerminalCountRef.current = terminalCount;
    prevViewModeRef.current = viewMode;
    prevHasNameRef.current = Object.values(terminalNames).some(n => n && n.length > 0);
    currentStepRef.current = 0;

    // Build driver.js steps
    const steps: DriveStep[] = TOUR_STEPS.map((step) => ({
      ...(step.selector ? { element: step.selector } : {}),
      disableActiveInteraction: !step.interactive,
      popover: {
        title: t(step.i18nTitleKey as any),
        description: t(step.i18nDescKey as any),
        side: step.side,
        popoverClass: 'tour-popover',
        showButtons: step.showButtons as any[],
      },
    }));

    const driverInstance = driver({
      showProgress: true,
      animate: true,
      overlayColor: 'rgba(6, 8, 12, 0.85)',
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: 'tour-popover',
      nextBtnText: t('tour.next'),
      prevBtnText: t('tour.prev'),
      doneBtnText: t('tour.done'),
      progressText: '{{current}} / {{total}}',
      allowClose: true,
      overlayClickBehavior: () => {},
      onHighlighted: (_el, _step, { driver: d }) => {
        const idx = d.getActiveIndex();
        if (idx !== undefined) {
          currentStepRef.current = idx;
        }
      },
      onCloseClick: () => {
        completeTour(true);
      },
      onDestroyed: () => {
        dispatch({ type: 'COMPLETE_TOUR' });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tour.active]);

  return null;
}
