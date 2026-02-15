/**
 * File Watcher Store
 *
 * State machine for file watching: Inactive -> Watching -> WatchError -> Inactive
 */

type FileWatcherState = 'Inactive' | 'Watching' | 'WatchError';

interface FileWatcherAction {
  type: 'TERMINAL_CREATED' | 'TERMINAL_CLOSED' | 'WATCH_ERROR' | 'RETRY_FAILED' | 'RETRY_SUCCESS';
  cwd?: string;
}

const RETRY_CONFIG = {
  interval: 3000,
  maxRetries: 3,
};

export function createFileWatcherStore() {
  let state: FileWatcherState = 'Inactive';
  let watchedPath: string | null = null;
  let retryCount = 0;

  function dispatch(action: FileWatcherAction): void {
    switch (action.type) {
      case 'TERMINAL_CREATED':
        state = 'Watching';
        watchedPath = action.cwd ?? null;
        retryCount = 0;
        break;

      case 'TERMINAL_CLOSED':
        state = 'Inactive';
        watchedPath = null;
        retryCount = 0;
        break;

      case 'WATCH_ERROR':
        state = 'WatchError';
        break;

      case 'RETRY_FAILED':
        retryCount++;
        if (retryCount >= RETRY_CONFIG.maxRetries) {
          state = 'Inactive';
        }
        break;

      case 'RETRY_SUCCESS':
        state = 'Watching';
        retryCount = 0;
        break;
    }
  }

  function getState(): FileWatcherState {
    return state;
  }

  function getWatchedPath(): string | null {
    return watchedPath;
  }

  function getRetryConfig() {
    return { ...RETRY_CONFIG };
  }

  function getRetryCount(): number {
    return retryCount;
  }

  return {
    dispatch,
    getState,
    getWatchedPath,
    getRetryConfig,
    getRetryCount,
  };
}
