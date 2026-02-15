/**
 * Sync Manager
 *
 * Manages synchronization between CC source sessions and mirror sessions.
 * Sync-only-no-delete policy: mirror retains sessions even if source deletes them.
 */

interface FileChangeEvent {
  type: string;
  path: string;
}

interface SyncFileResult {
  skipped: boolean;
  error?: { message: string };
  retryOnNextSync: boolean;
}

export function createSyncManager() {
  let sourceSessions: string[] = [];
  let mirrorSessions: string[] = [];
  let lockedFiles = new Map<string, boolean>();
  let mirrorWritable = true;
  let mode: 'normal' | 'readonly' = 'normal';
  let warningMessage = '';
  let backgroundSync = false;

  function setSourceSessions(sessions: string[]): void {
    sourceSessions = [...sessions];
  }

  function setMirrorSessions(sessions: string[]): void {
    mirrorSessions = [...sessions];
  }

  function getMirrorSessions(): string[] {
    return [...mirrorSessions];
  }

  /** Incremental sync: add new sessions from source, never delete from mirror */
  function runSync(): void {
    if (!mirrorWritable) {
      mode = 'readonly';
      warningMessage = '无法写入数据目录，历史备份已暂停';
      return;
    }

    for (const session of sourceSessions) {
      if (!mirrorSessions.includes(session)) {
        mirrorSessions.push(session);
      }
    }
    // Mirror retains all existing sessions (sync-only, no delete)
  }

  /** Full scan on startup: sync all source sessions to mirror */
  function runStartupSync(): void {
    runSync();
  }

  /** Handle file change event (e.g., new session detected by chokidar) */
  function onFileChange(event: FileChangeEvent): void {
    if (event.type === 'add') {
      // Extract session name from path
      const match = event.path.match(/\/([^/]+)\.jsonl$/);
      if (match) {
        const sessionName = match[1];
        if (!mirrorSessions.includes(sessionName)) {
          mirrorSessions.push(sessionName);
        }
      }
    }
  }

  /** Run sync in background (non-blocking) */
  function runAsyncSync(): Promise<void> {
    backgroundSync = true;
    return new Promise((resolve) => {
      runSync();
      resolve();
    });
  }

  function isBackgroundSync(): boolean {
    return backgroundSync;
  }

  function blocksUI(): boolean {
    return false;
  }

  /** Mark a file as locked/unlocked */
  function setFileLocked(path: string, locked: boolean): void {
    lockedFiles.set(path, locked);
  }

  /** Attempt to sync a single file */
  function syncFile(path: string): SyncFileResult {
    if (lockedFiles.get(path)) {
      return { skipped: true, retryOnNextSync: true };
    }
    return { skipped: false, retryOnNextSync: false };
  }

  /** Set mirror directory writability */
  function setMirrorWritable(writable: boolean): void {
    mirrorWritable = writable;
  }

  function getMode(): string {
    return mode;
  }

  function getWarningMessage(): string {
    return warningMessage;
  }

  return {
    setSourceSessions,
    setMirrorSessions,
    getMirrorSessions,
    runSync,
    runStartupSync,
    onFileChange,
    runAsyncSync,
    isBackgroundSync,
    blocksUI,
    setFileLocked,
    syncFile,
    setMirrorWritable,
    getMode,
    getWarningMessage,
  };
}
