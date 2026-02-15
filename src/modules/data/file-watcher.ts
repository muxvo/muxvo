/**
 * File watcher module with retry support
 */

type Listener = (path: string) => void;

export function createFileWatcher(path: string) {
  const listeners: Record<string, Listener[]> = {};

  return {
    path,
    on(event: string, listener: Listener) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
    },
    emit(event: string, ...args: unknown[]) {
      const handlers = listeners[event] || [];
      for (const h of handlers) {
        h(args[0] as string);
      }
    },
    close() {},
  };
}

export function createFileWatcherWithRetry(opts: {
  retryIntervalMs: number;
  maxRetries: number;
}) {
  let _state: 'Idle' | 'Watching' | 'Retrying' | 'WatchError' = 'Idle';
  let _retryCount = 0;

  return {
    get state() {
      return _state;
    },
    get retryCount() {
      return _retryCount;
    },
    start() {
      _state = 'Watching';
      _retryCount = 0;
    },
    simulateFailure() {
      _retryCount++;
      if (_retryCount >= opts.maxRetries) {
        _state = 'WatchError';
      } else {
        _state = 'Retrying';
      }
    },
    simulateSuccess() {
      _state = 'Watching';
      _retryCount = 0;
    },
  };
}
