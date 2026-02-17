/**
 * FS Watcher IPC Handlers
 *
 * Handles fs:watch-start, fs:watch-stop IPC channels and pushes fs:change events.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { watch, type FSWatcher } from 'fs';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { WatchStartRequest, WatchStopRequest } from '@/shared/types/fs.types';
import { createFileWatcherStore } from '../services/file-watcher/store';

function pushToAllWindows(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

// Internal watcher map
const watchers = new Map<string, FSWatcher[]>();

export function createFsWatcherHandlers() {
  const store = createFileWatcherStore();

  return {
    async watchStart(params: WatchStartRequest): Promise<Record<string, unknown>> {
      // params: { id: string, paths: string[] }
      try {
        // Close existing watchers for this id if any
        const existing = watchers.get(params.id);
        if (existing) {
          existing.forEach(w => w.close());
        }

        const fsWatchers: FSWatcher[] = [];
        for (const watchPath of params.paths) {
          const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
            if (!filename) return;
            const type = eventType === 'rename' ? 'add' : 'change';
            // Push fs:change event to all windows
            pushToAllWindows(IPC_CHANNELS.FS.CHANGE, {
              watchId: params.id,
              type,
              path: filename,
            });
          });

          watcher.on('error', () => {
            store.dispatch({ type: 'WATCH_ERROR' });
          });

          fsWatchers.push(watcher);
        }

        watchers.set(params.id, fsWatchers);
        store.dispatch({ type: 'TERMINAL_CREATED', cwd: params.paths[0] });

        return { success: true, data: { watchId: params.id } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        store.dispatch({ type: 'WATCH_ERROR' });
        return { success: false, error: { code: 'WATCH_ERROR', message } };
      }
    },

    async watchStop(params: WatchStopRequest): Promise<Record<string, unknown>> {
      // params: { id: string }
      const existing = watchers.get(params.id);
      if (!existing) {
        return { success: false, error: { code: 'NOT_FOUND', message: `No watcher with id: ${params.id}` } };
      }

      existing.forEach(w => w.close());
      watchers.delete(params.id);
      store.dispatch({ type: 'TERMINAL_CLOSED' });

      return { success: true };
    },
  };
}

export function registerFsWatcherHandlers(): void {
  const handlers = createFsWatcherHandlers();

  ipcMain.handle(IPC_CHANNELS.FS.WATCH_START, async (_event, params: WatchStartRequest) => {
    return handlers.watchStart(params);
  });

  ipcMain.handle(IPC_CHANNELS.FS.WATCH_STOP, async (_event, params: WatchStopRequest) => {
    return handlers.watchStop(params);
  });
}
