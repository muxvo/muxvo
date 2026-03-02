/**
 * Terminal diagnostic logger — writes to ~/.muxvo/logs/terminal-debug.log
 * Used to diagnose output visibility bugs (data arrives but not rendered).
 * Users send this file when reporting invisible terminal output.
 */
export function termLog(tag: string, msg: string): void {
  const line = `[TERM:${tag}] ${Date.now()} ${msg}`;
  try {
    window.api.termDebugLog(line);
  } catch {
    // preload not ready or API unavailable — silently ignore
  }
}
