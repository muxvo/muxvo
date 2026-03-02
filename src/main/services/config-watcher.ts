/**
 * Config Resource Watcher
 *
 * Watches ~/.claude/ resource directories (skills, hooks, plugins, etc.)
 * and pushes config:resource-change events to renderer.
 */

import { watch, type FSWatcher } from 'fs';
import { BrowserWindow } from 'electron';
import { join } from 'path';
import { homedir } from 'os';
import { IPC_CHANNELS } from '@/shared/constants/channels';

const CLAUDE_DIR = join(homedir(), '.claude');
const CODEX_DIR = join(homedir(), '.codex');
const GEMINI_DIR = join(homedir(), '.gemini');

/** Resource directories to watch and their type names */
const WATCH_DIRS: Array<{ dir: string; type: string }> = [
  { dir: join(CLAUDE_DIR, 'skills'), type: 'skills' },
  { dir: join(CODEX_DIR, 'skills'), type: 'skills' },
  { dir: join(GEMINI_DIR, 'skills'), type: 'skills' },
  { dir: join(CLAUDE_DIR, 'hooks'), type: 'hooks' },
  { dir: join(CLAUDE_DIR, 'plugins'), type: 'plugins' },
  { dir: join(CLAUDE_DIR, 'plans'), type: 'plans' },
  { dir: join(CLAUDE_DIR, 'tasks'), type: 'tasks' },
];

interface ConfigWatcherDeps {
  perfLogger?: { track(event: string, terminalId?: string): void };
}

export function createConfigWatcher(deps?: ConfigWatcherDeps) {
  const watchers: FSWatcher[] = [];
  const perfLogger = deps?.perfLogger;

  return {
    start(): void {
      for (const { dir, type } of WATCH_DIRS) {
        try {
          const watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
            if (!filename) return;
            perfLogger?.track('fsWatch');
            const event = _eventType === 'rename' ? 'add' : 'change';
            BrowserWindow.getAllWindows().forEach((win) => {
              win.webContents.send(IPC_CHANNELS.CONFIG.RESOURCE_CHANGE, {
                type,
                event,
                name: filename,
              });
            });
          });
          watchers.push(watcher);
        } catch {
          // Directory may not exist yet, that's ok
        }
      }
    },

    stop(): void {
      for (const w of watchers) {
        w.close();
      }
      watchers.length = 0;
    },
  };
}
