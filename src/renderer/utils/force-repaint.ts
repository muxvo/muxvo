/**
 * Force Chromium compositor to invalidate cached texture layers.
 * Briefly promotes <html> to its own compositing layer via translateZ(0),
 * then removes it — forcing all child layers to be recreated.
 *
 * This is the programmatic equivalent of what happens when user:
 * - Takes a screenshot (macOS forces GPU readback)
 * - Switches views (compositing layers destroyed and recreated)
 *
 * Visual impact: none (translateZ(0) is a zero-offset, double-RAF ~32ms)
 */
export function forceCompositorFlush(): void {
  const el = document.documentElement;
  el.style.transform = 'translateZ(0)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transform = '';
    });
  });
}
