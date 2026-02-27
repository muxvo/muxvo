/**
 * TourOverlay — Interactive onboarding tour using driver.js
 * Users perform actions at each step; the tour auto-advances on completion.
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

interface Props {
  terminalCount: number;
  terminalOrder: string[];
  viewMode: 'Tiling' | 'Focused';
  terminalNames: Record<string, string>;
}

export function TourOverlay({ terminalCount, terminalOrder, viewMode, terminalNames }: Props): null {
  const { state, dispatch } = usePanelContext();
  const { t } = useI18n();
  const driverRef = useRef<Driver | null>(null);
  const currentStepRef = useRef<number>(0);
  const prevTerminalCountRef = useRef<number>(terminalCount);
  const prevViewModeRef = useRef<'Tiling' | 'Focused'>(viewMode);
  const prevHasNameRef = useRef<boolean>(Object.values(terminalNames).some(n => n && n.length > 0));
  const prevTerminalOrderRef = useRef<string[]>(terminalOrder);
  // Guard: prevent onDestroyed from completing tour during intentional restart
  const restartingRef = useRef<boolean>(false);

  const completeTour = useCallback((skipped = false) => {
    document.body.classList.remove('tour-drag-active');
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
    }, 300);
  }, [completeTour]);

  // Build driver.js steps from TOUR_STEPS starting at given index
  const buildSteps = useCallback((startIndex: number): DriveStep[] => {
    return TOUR_STEPS.slice(startIndex).map((step) => ({
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
  }, [t]);

  // Initialize (or reinitialize) driver.js tour from a given step index
  const initTour = useCallback((startIndex: number) => {
    // Clean up existing instance
    if (driverRef.current) {
      restartingRef.current = true;
      driverRef.current.destroy();
      driverRef.current = null;
      restartingRef.current = false;
    }

    const steps = buildSteps(startIndex);
    if (steps.length === 0) {
      completeTour();
      return;
    }

    // Adjust currentStepRef to match the new starting index in TOUR_STEPS
    currentStepRef.current = startIndex;

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
      progressText: `{{current}} / ${TOUR_STEPS.length}`,
      allowClose: true,
      overlayClickBehavior: () => {},
      onHighlighted: (_el, _step, { driver: d }) => {
        const localIdx = d.getActiveIndex();
        if (localIdx !== undefined) {
          // Map local driver index back to global TOUR_STEPS index
          currentStepRef.current = startIndex + localIdx;
        }
        const step = TOUR_STEPS[currentStepRef.current];
        const needsPassThrough = step?.actionType === 'drag-reorder';
        document.body.classList.toggle('tour-drag-active', needsPassThrough);
      },
      onCloseClick: () => {
        completeTour(true);
      },
      onDestroyed: () => {
        // Only complete tour if NOT in an intentional restart
        if (!restartingRef.current) {
          dispatch({ type: 'COMPLETE_TOUR' });
        }
      },
    });

    driverInstance.setSteps(steps);
    driverInstance.drive();
    driverRef.current = driverInstance;
  }, [buildSteps, completeTour, dispatch, t]);

  // Get the actionType of the current active step
  const getCurrentActionType = useCallback(() => {
    const idx = currentStepRef.current;
    if (idx >= 0 && idx < TOUR_STEPS.length) {
      return TOUR_STEPS[idx].actionType;
    }
    return null;
  }, []);

  // === Sync refs when tour starts (must run BEFORE step detection effects) ===
  useEffect(() => {
    if (state.tour.active) {
      prevTerminalCountRef.current = terminalCount;
      prevTerminalOrderRef.current = terminalOrder;
      prevViewModeRef.current = viewMode;
      prevHasNameRef.current = Object.values(terminalNames).some(n => n && n.length > 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tour.active]);

  // === Action detection effects ===

  // Step 1: Detect terminal created → destroy & reinit from step 2 (FAB element gets remounted)
  useEffect(() => {
    if (!state.tour.active) return;
    if (getCurrentActionType() !== 'create-terminal') return;
    if (terminalCount > prevTerminalCountRef.current) {
      trackEvent(ANALYTICS_EVENTS.ONBOARDING.STEP, { step: 0, total: TOUR_STEPS.length });
      // Destroy current driver immediately (before driver.js detects element removal)
      if (driverRef.current) {
        restartingRef.current = true;
        driverRef.current.destroy();
        driverRef.current = null;
        restartingRef.current = false;
      }
      document.body.classList.remove('tour-drag-active');
      // Wait for DOM to settle after terminal creation, then restart from step 2
      setTimeout(() => {
        if (state.tour.active) {
          initTour(1);
        }
      }, 800);
    }
    prevTerminalCountRef.current = terminalCount;
  }, [state.tour.active, terminalCount, getCurrentActionType, initTour]);

  // Step 2: Detect drag reorder (terminal order changed)
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'drag-reorder') return;
    const prev = prevTerminalOrderRef.current;
    if (prev.length > 0 && terminalOrder.length === prev.length && terminalOrder.some((id, i) => id !== prev[i])) {
      moveNext();
    }
    prevTerminalOrderRef.current = terminalOrder;
  }, [state.tour.active, terminalOrder, getCurrentActionType, moveNext]);

  // Step 3: Detect focus mode (viewMode changed to Focused)
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'focus') return;
    if (viewMode === 'Focused' && prevViewModeRef.current === 'Tiling') {
      moveNext();
    }
    prevViewModeRef.current = viewMode;
  }, [state.tour.active, viewMode, getCurrentActionType, moveNext]);

  // Step 4: Detect rename
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'rename') return;
    const hasName = Object.values(terminalNames).some(n => n && n.length > 0);
    if (hasName && !prevHasNameRef.current) {
      moveNext();
    }
    prevHasNameRef.current = hasName;
  }, [state.tour.active, terminalNames, getCurrentActionType, moveNext]);

  // Step 5: Detect file panel opened
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'open-file') return;
    if (state.filePanel.open) {
      completeTour();
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
    prevTerminalOrderRef.current = terminalOrder;
    prevViewModeRef.current = viewMode;
    prevHasNameRef.current = Object.values(terminalNames).some(n => n && n.length > 0);

    initTour(0);

    return () => {
      document.body.classList.remove('tour-drag-active');
      if (driverRef.current) {
        restartingRef.current = true;
        driverRef.current.destroy();
        driverRef.current = null;
        restartingRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tour.active]);

  return null;
}
