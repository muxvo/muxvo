/**
 * Glyph diagnostic logger — writes to ~/.muxvo/logs/glyph-debug.log
 * Used to diagnose intermittent text rendering corruption.
 * Users send this file when reporting garbled text issues.
 */
export function glyphLog(tag: string, msg: string): void {
  const line = `[GLYPH:${tag}] ${Date.now()} ${msg}`;
  try {
    window.api.glyphLog(line);
  } catch {
    // preload not ready or API unavailable — silently ignore
  }
}
