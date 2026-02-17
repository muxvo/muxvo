import { watch, FSWatcher } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';

export function createChatWatcher() {
  let watcher: FSWatcher | null = null;
  const projectsDir = join(homedir(), '.claude', 'projects');

  return {
    start(): void {
      try {
        watcher = watch(projectsDir, { recursive: true }, (eventType, filename) => {
          if (!filename || !filename.endsWith('.jsonl')) return;
          const parts = filename.split('/');
          if (parts.length >= 2) {
            const projectId = parts[parts.length - 2];
            const sessionId = parts[parts.length - 1].replace('.jsonl', '');
            BrowserWindow.getAllWindows().forEach(win => {
              win.webContents.send(IPC_CHANNELS.CHAT.SESSION_UPDATE, { projectId, sessionId });
            });
          }
        });
      } catch {
        // projectsDir may not exist yet, that's ok
      }
    },
    stop(): void {
      watcher?.close();
      watcher = null;
    },
  };
}
