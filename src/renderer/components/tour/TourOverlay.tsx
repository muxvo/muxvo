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

  // Get the actionType of the current active step
  const getCurrentActionType = useCallback(() => {
    const idx = currentStepRef.current;
    if (idx >= 0 && idx < TOUR_STEPS.length) {
      return TOUR_STEPS[idx].actionType;
    }
    return null;
  }, []);

  // === Action detection effects ===

  // Step 1: Detect terminal created
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'create-terminal') return;
    if (terminalCount > prevTerminalCountRef.current) {
      moveNext();
    }
    prevTerminalCountRef.current = terminalCount;
  }, [state.tour.active, terminalCount, getCurrentActionType, moveNext]);

  // Step 2a: Detect drag reorder (terminal order changed)
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    if (getCurrentActionType() !== 'drag-reorder') return;
    const prev = prevTerminalOrderRef.current;
    if (prev.length > 0 && terminalOrder.length === prev.length && terminalOrder.some((id, i) => id !== prev[i])) {
      moveNext();
    }
    prevTerminalOrderRef.current = terminalOrder;
  }, [state.tour.active, terminalOrder, getCurrentActionType, moveNext]);

  // Step 2b: Detect drag resize — relies on "Next" button (no reliable prop to detect)

  // Step 3: Detect focus mode — user clicks "Next" to advance (no auto-advance)
  useEffect(() => {
    if (!state.tour.active || !driverRef.current) return;
    prevViewModeRef.current = viewMode;
  }, [state.tour.active, viewMode]);

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
    currentStepRef.current = 0;

    // Build driver.js steps — always include all steps (step 1 creates terminal, so steps 2-6 will have valid selectors)
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
        // For drag steps, toggle body class to override driver.js global pointer-events: none
        const step = TOUR_STEPS[idx ?? 0];
        const needsPassThrough = step?.actionType === 'drag-reorder'
          || step?.actionType === 'drag-resize';
        document.body.classList.toggle('tour-drag-active', needsPassThrough);
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
      document.body.classList.remove('tour-drag-active');
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tour.active]);

  return null;
}
