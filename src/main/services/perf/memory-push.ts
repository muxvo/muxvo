/**
 * Memory Warning Push Timer
 *
 * Periodically checks memory usage and pushes app:memory-warning events
 * to renderer when threshold is exceeded.
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { createMemoryMonitor } from './memory-monitor';

interface MemoryPushOptions {
  intervalMs: number;
  thresholdMB: number;
}

export function createMemoryPushTimer(opts: MemoryPushOptions) {
  const monitor = createMemoryMonitor({ thresholdMB: opts.thresholdMB });
  let intervalId: NodeJS.Timeout | null = null;

  function check(): void {
    const result = monitor.checkMemory();
    if (result.exceeded) {
      const payload = {
        usageMB: result.currentMB,
        threshold: opts.thresholdMB,
      };
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(IPC_CHANNELS.APP.MEMORY_WARNING, payload);
      });
    }
  }

  return {
    start(): void {
      if (intervalId) return; // Already running
      intervalId = setInterval(check, opts.intervalMs);
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },

    /** Single check without interval — useful for testing */
    checkOnce(): void {
      check();
    },
  };
}
