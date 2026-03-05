import { app } from 'electron';
import type { DockBadgeMode } from '@/shared/types/config.types';

interface DockBadgeDeps {
  /** 获取当前所有终端的状态列表 */
  listTerminals: () => Array<{ state: string }>;
  /** 获取当前角标配置 */
  getConfig: () => { mode: DockBadgeMode; intervalMin: number };
}

export function createDockBadgeService(deps: DockBadgeDeps) {
  let timerHandle: ReturnType<typeof setInterval> | null = null;
  let notificationRegistered = false;

  /** macOS 要求应用先发过通知才能显示 Dock 角标，发一次静默通知完成注册 */
  function ensureNotificationRegistered(): void {
    if (notificationRegistered) return;
    notificationRegistered = true;
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Muxvo', body: '角标通知已启用', silent: true });
        n.show();
        // 立即关闭，用户几乎看不到
        setTimeout(() => n.close(), 100);
        console.log('[DOCK-BADGE] notification registered for badge support');
      }
    } catch (err) {
      console.error('[DOCK-BADGE] ensureNotificationRegistered ERROR:', err);
    }
  }

  function updateBadge(): void {
    if (process.platform !== 'darwin') {
      console.log('[DOCK-BADGE] skip: not darwin, platform=' + process.platform);
      return;
    }
    const { mode } = deps.getConfig();
    if (mode === 'off') {
      clearBadge();
      return;
    }
    const terminals = deps.listTerminals();
    const count = terminals.filter((t) => t.state === 'WaitingInput').length;
    const badge = count > 0 ? String(count) : '';
    console.log(`[DOCK-BADGE] updateBadge: mode=${mode} terminals=${terminals.length} states=[${terminals.map(t => t.state).join(',')}] waiting=${count} badge="${badge}"`);
    if (count > 0) ensureNotificationRegistered();

    try {
      app.dock.setBadge(badge);
      app.setBadgeCount(count);
      console.log(`[DOCK-BADGE] badge set, getBadge()="${app.dock.getBadge()}"`);
    } catch (err) {
      console.error('[DOCK-BADGE] setBadge ERROR:', err);
    }
  }

  function clearBadge(): void {
    try {
      app.dock.setBadge('');
      app.setBadgeCount(0);
    } catch (err) {
      console.error('[DOCK-BADGE] clearBadge ERROR:', err);
    }
  }

  /** 终端状态变化时调用（实时模式下立即更新角标） */
  function onStateChange(): void {
    const { mode } = deps.getConfig();
    console.log(`[DOCK-BADGE] onStateChange called, mode=${mode}`);
    if (mode === 'realtime') {
      updateBadge();
    }
  }

  function startTimer(): void {
    stopTimer();
    const { mode, intervalMin } = deps.getConfig();
    if (mode !== 'timed') return;
    const ms = Math.max(1, Math.min(30, intervalMin)) * 60 * 1000;
    timerHandle = setInterval(updateBadge, ms);
  }

  function stopTimer(): void {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  /** 配置变化时重新初始化模式 */
  function reconfigure(): void {
    const { mode } = deps.getConfig();
    console.log(`[DOCK-BADGE] reconfigure: mode=${mode}`);
    stopTimer();
    if (mode === 'off') {
      clearBadge();
    } else if (mode === 'timed') {
      startTimer();
      updateBadge();
    } else if (mode === 'realtime') {
      updateBadge();
    }
  }

  /** 应用退出时清理 */
  function dispose(): void {
    stopTimer();
    clearBadge();
  }

  return { onStateChange, reconfigure, dispose };
}
