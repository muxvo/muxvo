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

  function countWaiting(): number {
    return deps.listTerminals().filter((t) => t.state === 'WaitingInput').length;
  }

  function updateBadge(): void {
    if (process.platform !== 'darwin') return;
    const { mode } = deps.getConfig();
    if (mode === 'off') {
      app.dock.setBadge('');
      return;
    }
    const count = countWaiting();
    app.dock.setBadge(count > 0 ? String(count) : '');
  }

  /** 终端状态变化时调用（实时模式下立即更新角标） */
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
    stopTimer();
    if (mode === 'off') {
      if (process.platform === 'darwin') app.dock.setBadge('');
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
    if (process.platform === 'darwin') app.dock.setBadge('');
  }

  return { onStateChange, reconfigure, dispose };
}
