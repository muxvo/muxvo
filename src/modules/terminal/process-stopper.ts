/**
 * Process stopper - handles terminal process shutdown with timeout
 */

export function createProcessStopper(timeoutMs: number) {
  return {
    stop(opts: { exitAfterMs: number }) {
      if (opts.exitAfterMs < timeoutMs) {
        return { finalState: 'Stopped' as const };
      }
      // >= timeout -> Disconnected
      return { finalState: 'Disconnected' as const };
    },
  };
}
