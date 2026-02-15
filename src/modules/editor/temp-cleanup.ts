/**
 * Temp file cleanup module
 */

const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export async function cleanupTempFiles(terminalId: string) {
  return {
    terminalId,
    filesRemoved: 0,
  };
}

export function createTempFileCleaner() {
  return {
    async cleanOnTerminalClose(terminalId: string) {
      return {
        terminalId,
        cleaned: true,
        filesRemoved: 0,
      };
    },
    checkAge(opts: { createdAtMs: number }) {
      const ageMs = Date.now() - opts.createdAtMs;
      return {
        shouldClean: ageMs >= CLEANUP_AGE_MS,
        ageMs,
      };
    },
  };
}
