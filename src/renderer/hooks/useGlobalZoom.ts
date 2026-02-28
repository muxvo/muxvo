/**
 * useGlobalZoom — Unified zoom for the entire Muxvo UI
 *
 * Handles Cmd+/Cmd-/Cmd+0 via:
 *   1. Electron Menu IPC (app:zoom) — when terminal is not focused
 *   2. DOM custom event (muxvo:global-zoom-request) — from xterm key interception
 *
 * Uses webFrame.setZoomFactor() for uniform scaling of the entire renderer.
 */
import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_ZOOM_LEVEL = 0;
const MIN_ZOOM_LEVEL = -5; // 50%
const MAX_ZOOM_LEVEL = 10; // 200%
const ZOOM_STEP = 0.1; // 10% per step
const SAVE_DEBOUNCE_MS = 500;

function zoomLevelToFactor(level: number): number {
  return 1.0 + level * ZOOM_STEP;
}

export function useGlobalZoom(): void {
  const zoomLevelRef = useRef(DEFAULT_ZOOM_LEVEL);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyZoom = useCallback((level: number) => {
    zoomLevelRef.current = level;
    window.api.app.setZoomFactor(zoomLevelToFactor(level));
  }, []);

  const saveToConfig = useCallback((level: number) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      window.api.app.getConfig().then((result) => {
        const config = result?.data ?? {};
        window.api.app.saveConfig({ ...config, zoomLevel: level });
      });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const handleZoom = useCallback(
    (direction: string) => {
      const current = zoomLevelRef.current;
      let next: number;
      if (direction === 'in') next = Math.min(current + 1, MAX_ZOOM_LEVEL);
      else if (direction === 'out') next = Math.max(current - 1, MIN_ZOOM_LEVEL);
      else next = DEFAULT_ZOOM_LEVEL;
      applyZoom(next);
      saveToConfig(next);
      // Notify xterm instances to refit after zoom change
      window.dispatchEvent(new CustomEvent('muxvo:global-zoom'));
    },
    [applyZoom, saveToConfig],
  );

  useEffect(() => {
    // Load persisted zoomLevel and apply on startup
    window.api.app
      .getConfig()
      .then((result) => {
        const saved = result?.data?.zoomLevel;
        if (
          typeof saved === 'number' &&
          saved >= MIN_ZOOM_LEVEL &&
          saved <= MAX_ZOOM_LEVEL
        ) {
          applyZoom(saved);
        }
      })
      .catch(() => {});

    // Listen for IPC zoom from Electron menu
    const unsubIpc = window.api.app.onZoom((direction: string) =>
      handleZoom(direction),
    );

    // Listen for DOM event from xterm key handler (when terminal is focused)
    const onDomZoom = (e: Event) =>
      handleZoom((e as CustomEvent).detail);
    window.addEventListener('muxvo:global-zoom-request', onDomZoom);

    return () => {
      unsubIpc();
      window.removeEventListener('muxvo:global-zoom-request', onDomZoom);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [applyZoom, handleZoom]);
}
