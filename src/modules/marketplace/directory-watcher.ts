/**
 * Directory Watcher
 *
 * Watches a directory for file changes and emits events.
 * Used to auto-refresh the installed skills list after install/uninstall.
 */

type EventCallback = (...args: string[]) => void;

export interface DirectoryWatcher {
  on(event: string, callback: EventCallback): void;
  emit(event: string, ...args: string[]): void;
}

export function createDirectoryWatcher(_path: string): DirectoryWatcher {
  const listeners = new Map<string, Set<EventCallback>>();

  return {
    on(event: string, callback: EventCallback) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);
    },

    emit(event: string, ...args: string[]) {
      // 'add' and 'remove' are sub-events of 'change'
      const changeListeners = listeners.get('change');
      if (changeListeners) {
        changeListeners.forEach((cb) => cb(event, ...args));
      }
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        eventListeners.forEach((cb) => cb(...args));
      }
    },
  };
}
