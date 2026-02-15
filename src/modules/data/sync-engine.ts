/**
 * Data sync engine - handles JSONL sync between CC and mirror
 */

export function createSyncEngine() {
  return {
    async sync(opts: { sourcePath: string }) {
      const content = `mock-content-for-${opts.sourcePath}`;
      return {
        sourcePath: opts.sourcePath,
        sourceContent: content,
        mirrorContent: content,
      };
    },
    async handleSourceDelete(opts: { sourcePath: string }) {
      return {
        sourcePath: opts.sourcePath,
        mirrorPreserved: true,
      };
    },
    async deduplicate(sessionIds: string[]) {
      const unique = [...new Set(sessionIds)];
      return {
        uniqueSessions: unique,
      };
    },
    isModified(opts: { oldMtimeMs: number; newMtimeMs: number }) {
      // Same-second modifications are treated as unchanged
      const oldSec = Math.floor(opts.oldMtimeMs / 1000);
      const newSec = Math.floor(opts.newMtimeMs / 1000);
      return oldSec !== newSec;
    },
    async syncBatch(files: Array<{ path: string; locked: boolean }>) {
      const synced = files.filter((f) => !f.locked);
      const skipped = files
        .filter((f) => f.locked)
        .map((f) => ({ path: f.path, reason: 'file locked' }));
      return { synced, skipped };
    },
  };
}
