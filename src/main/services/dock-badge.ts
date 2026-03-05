import { app, dialog, BrowserWindow, Notification } from 'electron';
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

    // 1. 发静默通知注册应用到 macOS 通知中心（角标依赖此注册）
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Muxvo', body: 'Dock 角标已启用', silent: true });
      n.show();
      setTimeout(() => n.close(), 200);
    }

    // 2. 弹原生对话框提示用户开启角标权限
    const appName = app.isPackaged ? 'Muxvo' : 'Electron';
    const win = BrowserWindow.getAllWindows()[0];
    dialog.showMessageBox(win ?? null as any, {
      type: 'info',
      title: 'Dock 角标通知',
      message: '请开启 Dock 角标权限',
      detail: `前往「系统设置 → 通知 → ${appName}」，开启「标记 App 图标」即可在 Dock 图标上显示终端等待数量。`,
      buttons: ['知道了'],
    }).catch(() => {});

    console.log('[DOCK-BADGE] permission dialog shown');
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
