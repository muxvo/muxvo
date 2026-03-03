/**
 * Compositor Guard — prevents Chromium GPU text garbling
 *
 * Chromium's GPU compositor caches glyph textures in GPU memory.
 * Over time (especially with CJK characters + multiple WebGL contexts),
 * the cache can become corrupted, displaying wrong characters.
 * Any action that forces compositing layer recreation fixes it.
 *
 * This hook automates that fix with three triggers:
 * 1. Periodic flush (every 30s) — catches gradual corruption
 * 2. Window focus — catches returning from other apps
 * 3. Overlay close — catches stale layers after panel transitions
 */

import { useEffect, useRef } from 'react';
import { forceCompositorFlush } from '../utils/force-repaint';
import type { PanelState } from '../contexts/PanelContext';

export function useCompositorGuard(panelState: PanelState): void {
  // 1. Periodic flush (30s interval, only when app is visible)
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) forceCompositorFlush();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // 2. Flush on window focus (returning from other apps)
  useEffect(() => {
    const onFocus = (): void => forceCompositorFlush();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // 3. Flush when any overlay closes (panel state transitions)
  const prevOverlayRef = useRef(false);
  useEffect(() => {
    const hasOverlay =
      panelState.chatHistory.open ||
      panelState.skillsPanel.open ||
      panelState.mcpPanel.open ||
      panelState.hooksPanel.open ||
      panelState.pluginsPanel.open ||
      panelState.tempView.active;
    if (prevOverlayRef.current && !hasOverlay) {
      forceCompositorFlush();
    }
    prevOverlayRef.current = hasOverlay;
  }, [panelState]);
}
