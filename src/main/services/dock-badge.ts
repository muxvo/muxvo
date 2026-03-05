import { app, dialog, shell, BrowserWindow } from 'electron';
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

    const showDialog = (): void => {
      const appName = app.isPackaged ? 'Muxvo' : 'Electron';
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;
      dialog.showMessageBox(win, {
        type: 'info',
        message: '开启通知提醒',
        detail: '终端等待处理时会及时提醒你。',
        buttons: ['前往设置', '稍后'],
        defaultId: 0,
      }).then((result) => {
        if (result.response === 0) {
          shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
        }
      }).catch(() => {});
    };

    // 确保窗口存在且可见后再弹对话框
    const win = BrowserWindow.getAllWindows()[0];
    if (win && win.isVisible()) {
      // 窗口已可见（如模式切换），延迟一帧确保脱离 IPC handler 上下文
      setImmediate(showDialog);
    } else {
      // 窗口还没创建或没显示（如启动时），监听窗口就绪
      app.once('browser-window-created', (_e, newWin) => {
        newWin.once('ready-to-show', () => {
          setImmediate(showDialog);
        });
      });
    }

    console.log('[DOCK-BADGE] permission dialog scheduled');
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
