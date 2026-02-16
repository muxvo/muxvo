/**
 * Chat Sync
 *
 * Manages mtime comparison, sync planning, and throttling for chat mirror sync.
 */

import { readdir, stat, copyFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

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
 * Sync Manager -- calculates sync plans and performs file sync.
 */
export function createSyncManager(ccBasePath: string, mirrorBasePath: string) {
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

    /**
     * Full scan: walk CC directory tree, compare mtime, copy changed files to mirror.
     */
    async fullScan(): Promise<{ synced: number; skipped: number }> {
      let synced = 0;
      let skipped = 0;

      async function scanDir(ccDir: string, mirrorDir: string): Promise<void> {
        try {
          const entries = await readdir(ccDir, { withFileTypes: true });

          for (const entry of entries) {
            const ccPath = join(ccDir, entry.name);
            const mirrorPath = join(mirrorDir, entry.name);

            if (entry.isDirectory()) {
              await scanDir(ccPath, mirrorPath);
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
              try {
                const ccStats = await stat(ccPath);
                let mirrorStats;
                try {
                  mirrorStats = await stat(mirrorPath);
                } catch {
                  mirrorStats = null;
                }

                const ccMtimeSeconds = Math.floor(ccStats.mtimeMs / 1000);
                const mirrorMtimeSeconds = mirrorStats ? Math.floor(mirrorStats.mtimeMs / 1000) : 0;

                if (ccMtimeSeconds !== mirrorMtimeSeconds) {
                  // Copy file to mirror
                  await mkdir(dirname(mirrorPath), { recursive: true });
                  await copyFile(ccPath, mirrorPath);
                  synced++;
                } else {
                  skipped++;
                }
              } catch {
                // Skip files that fail to stat or copy
              }
            }
          }
        } catch {
          // Skip directories that fail to read
        }
      }

      await scanDir(ccBasePath, mirrorBasePath);
      return { synced, skipped };
    },

    /**
     * Incremental sync: sync a single changed file.
     */
    async incrementalSync(ccPath: string): Promise<boolean> {
      try {
        // Calculate mirror path by replacing ccBasePath with mirrorBasePath
        const relativePath = ccPath.replace(ccBasePath, '');
        const mirrorPath = join(mirrorBasePath, relativePath);

        const ccStats = await stat(ccPath);
        let mirrorStats;
        try {
          mirrorStats = await stat(mirrorPath);
        } catch {
          mirrorStats = null;
        }

        const ccMtimeSeconds = Math.floor(ccStats.mtimeMs / 1000);
        const mirrorMtimeSeconds = mirrorStats ? Math.floor(mirrorStats.mtimeMs / 1000) : 0;

        if (ccMtimeSeconds !== mirrorMtimeSeconds) {
          await mkdir(dirname(mirrorPath), { recursive: true });
          await copyFile(ccPath, mirrorPath);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Sync Throttler -- batches rapid sync triggers into a single operation.
 */
export function createSyncThrottler(fn?: () => void, delayMs = 300) {
  let timeoutId: NodeJS.Timeout | null = null;
  let syncHandler: (() => void) | null = fn || null;

  return {
    // Test-friendly API
    onSync(handler: () => void) {
      syncHandler = handler;
    },

    triggerSync() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        if (syncHandler) {
          syncHandler();
        }
        timeoutId = null;
      }, delayMs);
    },

    flush() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        if (syncHandler) {
          syncHandler();
        }
        timeoutId = null;
      }
    },
  };
}
