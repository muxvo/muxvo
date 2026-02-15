/**
 * Chat Sync
 *
 * Manages mtime comparison, sync planning, and throttling for chat mirror sync.
 */

interface MtimeResult {
  needsSync: boolean;
}

interface SessionRef {
  sessionId: string;
  mtime: number;
}

interface SyncPlan {
  toSync: SessionRef[];
  skipped: SessionRef[];
}

/**
 * Compare mtime with second-level precision (floor to seconds).
 */
export function compareMtime(ccMtime: number, mirrorMtime: number): MtimeResult {
  const ccSeconds = Math.floor(ccMtime / 1000);
  const mirrorSeconds = Math.floor(mirrorMtime / 1000);

  return {
    needsSync: ccSeconds !== mirrorSeconds,
  };
}

/**
 * Sync Manager -- calculates sync plans based on sessionId deduplication.
 */
export function createSyncManager() {
  return {
    calculateSyncPlan(ccSessions: SessionRef[], mirrorSessions: SessionRef[]): SyncPlan {
      const mirrorMap = new Map<string, SessionRef>();
      for (const s of mirrorSessions) {
        mirrorMap.set(s.sessionId, s);
      }

      const toSync: SessionRef[] = [];
      const skipped: SessionRef[] = [];

      for (const cc of ccSessions) {
        const mirror = mirrorMap.get(cc.sessionId);
        if (mirror && Math.floor(cc.mtime / 1000) === Math.floor(mirror.mtime / 1000)) {
          skipped.push(cc);
        } else {
          toSync.push(cc);
        }
      }

      return { toSync, skipped };
    },
  };
}

/**
 * Sync Throttler -- batches rapid sync triggers into a single operation.
 */
export function createSyncThrottler() {
  let syncHandler: (() => void) | null = null;
  let pending = false;

  return {
    onSync(fn: () => void) {
      syncHandler = fn;
    },

    triggerSync() {
      pending = true;
    },

    async flush() {
      if (pending && syncHandler) {
        syncHandler();
        pending = false;
      }
    },
  };
}
