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
import './TourOverlay.css';

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

  const completeTour = useCallback(() => {
    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
    dispatch({ type: 'COMPLETE_TOUR' });
    window.api.app.savePreferences({ tourCompleted: true }).catch(() => {});
  }, [dispatch]);

  const moveNext = useCallback(() => {
    setTimeout(() => {
      if (driverRef.current) {
        if (!driverRef.current.hasNextStep()) {
          completeTour();
        } else {
          driverRef.current.moveNext();
        }
      }
    }, 300);
  }, [completeTour]);

  // Build active steps list (filtered by terminal availability)
  const getActiveSteps = useCallback((hasTerminal: boolean): typeof TOUR_STEPS => {
    return TOUR_STEPS.filter(step => {
      if (step.needsTerminal && !hasTerminal) return false;
      return true;
    });
  }, []);

  // Get the actionType of the current active step
  const getCurrentActionType = useCallback(() => {
    const hasTerminal = terminalCount > 0;
    const activeSteps = getActiveSteps(hasTerminal);
    const idx = currentStepRef.current;
    if (idx >= 0 && idx < activeSteps.length) {
      return activeSteps[idx].actionType;
    }
    return null;
  }, [terminalCount, getActiveSteps]);

  // === Action detection effects ===

  // Step 1: Detect terminal created
  useEffect(() => {
    if (!state.tour.active) return;
    if (getCurrentActionType() !== 'create-terminal') return;
    if (terminalCount > prevTerminalCountRef.current) {
      moveNext();
    }
    prevTerminalCountRef.current = terminalCount;
  }, [state.tour.active, terminalCount, getCurrentActionType, moveNext]);

  // Step 3: Detect focus mode
  useEffect(() => {
    if (!state.tour.active) return;
    if (getCurrentActionType() !== 'focus') return;
    if (viewMode === 'Focused' && prevViewModeRef.current === 'Tiling') {
      moveNext();
    }
    prevViewModeRef.current = viewMode;
  }, [state.tour.active, viewMode, getCurrentActionType, moveNext]);

  // Step 4: Detect rename
  useEffect(() => {
    if (!state.tour.active) return;
    if (getCurrentActionType() !== 'rename') return;
    const hasName = Object.values(terminalNames).some(n => n && n.length > 0);
    if (hasName && !prevHasNameRef.current) {
      moveNext();
    }
    prevHasNameRef.current = hasName;
  }, [state.tour.active, terminalNames, getCurrentActionType, moveNext]);

  // Step 5: Detect file panel opened
  useEffect(() => {
    if (!state.tour.active) return;
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

    const hasTerminal = terminalCount > 0;
    const activeSteps = getActiveSteps(hasTerminal);

    // Reset refs
    prevTerminalCountRef.current = terminalCount;
    prevViewModeRef.current = viewMode;
    prevHasNameRef.current = Object.values(terminalNames).some(n => n && n.length > 0);
    currentStepRef.current = 0;

    // Build driver.js steps
    const steps: DriveStep[] = activeSteps.map((step) => ({
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

    // If no terminals, add a prompt step
    if (!hasTerminal) {
      steps.push({
        element: '.menu-bar__add-btn',
        disableActiveInteraction: false,
        popover: {
          title: t('tour.noTerminal.title'),
          description: t('tour.noTerminal.desc'),
          side: 'bottom',
          popoverClass: 'tour-popover',
          showButtons: ['close'] as any[],
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
      allowClose: true,
      overlayClickBehavior: () => {},
      onHighlighted: (_el, _step, { driver: d }) => {
        const idx = d.getActiveIndex();
        if (idx !== undefined) {
          currentStepRef.current = idx;
        }
      },
      onCloseClick: () => {
        completeTour();
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
