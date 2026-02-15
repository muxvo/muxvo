/**
 * Sync State Schema
 *
 * Defines the format of sync-state.json which tracks
 * per-project last sync time and file mtime.
 */

export interface SyncStateSchema {
  lastSync: string;
  fileMtime: Record<string, number>;
}

export function getSyncStateSchema(): SyncStateSchema {
  return {
    lastSync: new Date().toISOString(),
    fileMtime: {},
  };
}
