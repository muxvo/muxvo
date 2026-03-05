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
    console.log(`[DOCK-BADGE] app.dock exists=${!!app.dock} app.dock.setBadge type=${typeof app.dock?.setBadge} app.setBadgeCount type=${typeof app.setBadgeCount}`);

    try {
      const result1 = app.dock.setBadge(badge);
      console.log(`[DOCK-BADGE] app.dock.setBadge("${badge}") returned:`, result1);
    } catch (err) {
      console.error('[DOCK-BADGE] app.dock.setBadge ERROR:', err);
    }

    try {
      const result2 = app.setBadgeCount(count);
      console.log(`[DOCK-BADGE] app.setBadgeCount(${count}) returned:`, result2);
    } catch (err) {
      console.error('[DOCK-BADGE] app.setBadgeCount ERROR:', err);
    }

    // 额外尝试：直接用 dock.setBadge 设置一个固定值验证
    try {
      console.log(`[DOCK-BADGE] current badge from getBadge(): "${app.dock.getBadge()}"`);
    } catch (err) {
      console.error('[DOCK-BADGE] getBadge ERROR:', err);
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
