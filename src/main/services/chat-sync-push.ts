/**
 * Chat Sync Status Pusher
 *
 * Pushes chat:sync-status events to renderer to report mirror sync progress.
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { ChatSyncStatus } from '@/shared/types/chat.types';

export function createSyncStatusPusher() {
  function pushStatus(status: ChatSyncStatus, extra?: { lastSync?: string }): void {
    const payload = {
      status,
      lastSync: extra?.lastSync || new Date().toISOString(),
    };
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.CHAT.SYNC_STATUS, payload);
    });
  }

  return {
    pushStatus,

    /** Mark sync as started */
    syncStarted(): void {
      pushStatus('syncing');
    },

    /** Mark sync as completed */
    syncCompleted(): void {
      pushStatus('idle', { lastSync: new Date().toISOString() });
    },

    /** Mark sync as failed */
    syncFailed(): void {
      pushStatus('error');
    },
  };
}
