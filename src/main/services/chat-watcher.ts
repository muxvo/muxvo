import { watch, FSWatcher } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';

export function createChatWatcher() {
  let watcher: FSWatcher | null = null;
  const projectsDir = join(homedir(), '.claude', 'projects');
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let sessionUpdateCallback: ((projectHash: string, sessionId: string) => void) | null = null;

  return {
    /**
     * Register a callback invoked on every debounced session-update event.
     * Used by chat-archive to trigger incremental archive.
     */
    onSessionUpdate(cb: (projectHash: string, sessionId: string) => void): void {
      sessionUpdateCallback = cb;
    },

    start(): void {
      try {
        watcher = watch(projectsDir, { recursive: true }, (eventType, filename) => {
          if (!filename || !filename.endsWith('.jsonl')) return;
          const parts = filename.split('/');
          if (parts.length >= 2) {
            const projectHash = parts[parts.length - 2];
            const sessionId = parts[parts.length - 1].replace('.jsonl', '');
            const key = `${projectHash}/${sessionId}`;

            // Debounce: CC writes many lines per second during active conversations
            const existing = pendingTimers.get(key);
            if (existing) clearTimeout(existing);
            pendingTimers.set(key, setTimeout(() => {
              pendingTimers.delete(key);
              BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed()) {
                  win.webContents.send(IPC_CHANNELS.CHAT.SESSION_UPDATE, { projectHash, sessionId });
                }
              });
              sessionUpdateCallback?.(projectHash, sessionId);
            }, 500));
          }
        });
      } catch {
        // projectsDir may not exist yet, that's ok
      }
    },
    stop(): void {
      watcher?.close();
      watcher = null;
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
    },
  };
}
