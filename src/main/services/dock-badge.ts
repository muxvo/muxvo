import { app, shell, Notification } from 'electron';
import type { DockBadgeMode } from '@/shared/types/config.types';

interface DockBadgeDeps {
  listTerminals: () => Array<{ state: string }>;
  getConfig: () => { mode: DockBadgeMode; intervalMin: number };
  getPermissionNotified: () => boolean;
  setPermissionNotified: () => void;
}

export function createDockBadgeService(deps: DockBadgeDeps) {
  let timerHandle: ReturnType<typeof setInterval> | null = null;
  /** 首次启用时注册通知中心 + 弹窗提示用户开权限 */
  function notifyBadgePermission(): void {
    if (deps.getPermissionNotified()) return;
    deps.setPermissionNotified();

    if (Notification.isSupported()) {
      const n = new Notification({
        title: '开启通知提醒',
        body: '开启后终端等待处理时会提醒你',
        silent: true,
        actions: [
          { type: 'button' as const, text: '前往设置' },
          { type: 'button' as const, text: '稍后' },
        ],
      });
      n.on('action', (_e: Electron.Event, index: number) => {
        if (index === 0) {
          shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
        }
      });
      n.on('click', () => {
        shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
      });
      n.show();
    }

    console.log('[DOCK-BADGE] permission notification shown');
  }

  function updateBadge(): void {
    if (process.platform !== 'darwin') return;
    const { mode } = deps.getConfig();
    if (mode === 'off') {
      app.dock.setBadge('');
      return;
    }
    const count = deps.listTerminals().filter((t) => t.state === 'WaitingInput').length;
    const badge = count > 0 ? String(count) : '';
    app.dock.setBadge(badge);
  }

  function onStateChange(): void {
    const { mode } = deps.getConfig();
    if (mode === 'realtime') {
      updateBadge();
    }
  }

  function startTimer(): void {
    stopTimer();
    const { mode, intervalMin } = deps.getConfig();
    if (mode !== 'timed') return;
    const ms = Math.max(1, intervalMin) * 60 * 1000;
    timerHandle = setInterval(updateBadge, ms);
  }

  function stopTimer(): void {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function reconfigure(): void {
    const { mode } = deps.getConfig();
    stopTimer();
    if (mode === 'off') {
      if (process.platform === 'darwin') app.dock.setBadge('');
    } else {
      // 首次启用时发通知注册
      notifyBadgePermission();
      if (mode === 'timed') {
        startTimer();
      }
      updateBadge();
    }
  }

  function dispose(): void {
    stopTimer();
    if (process.platform === 'darwin') app.dock.setBadge('');
  }

  return { onStateChange, reconfigure, dispose };
}
