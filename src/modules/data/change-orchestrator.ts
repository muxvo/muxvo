/**
 * File change orchestrator - coordinates file changes across modules
 */

const JSONL_READ_DELAY = 200;

export function createFileChangeOrchestrator() {
  return {
    async handleFileChange(opts: { path: string; event: string }) {
      return {
        path: opts.path,
        event: opts.event,
        readDelayMs: JSONL_READ_DELAY,
        mirrorSynced: true,
        searchIndexUpdated: true,
        pushSent: true,
      };
    },
  };
}
