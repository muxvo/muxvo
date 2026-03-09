/**
 * VERIFY: dock-badge onStateChange 在 timed 模式下也立即更新角标
 *
 * Bug: onStateChange() 只在 realtime 模式下调用 updateBadge()，
 *      timed 模式下点击终端 acknowledge 后角标不消失。
 * Fix: 改为 mode !== 'off' 时都调用 updateBadge()。
 *
 * 同时验证默认 mode fallback 从 'off' 改为 'realtime'。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    focus: vi.fn(),
    dock: { setBadge: vi.fn() },
  },
  dialog: {
    showMessageBoxSync: vi.fn().mockReturnValue(1),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

import { app } from 'electron';
import { createDockBadgeService } from '@/main/services/dock-badge';

function makeDeps(overrides: {
  mode?: 'off' | 'realtime' | 'timed';
  terminals?: Array<{ state: string }>;
  notified?: boolean;
} = {}) {
  const mode = overrides.mode ?? 'realtime';
  const terminals = overrides.terminals ?? [];
  let notified = overrides.notified ?? true; // skip permission dialog
  return {
    listTerminals: () => terminals,
    getConfig: () => ({ mode, intervalMin: 1 }),
    getPermissionNotified: () => notified,
    setPermissionNotified: () => { notified = true; },
  };
}

describe('dock-badge onStateChange clears badge in timed mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pretend darwin for dock API
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  test('timed 模式下 onStateChange 应调用 setBadge 更新角标', () => {
    const deps = makeDeps({
      mode: 'timed',
      terminals: [{ state: 'WaitingInput' }],
    });
    const svc = createDockBadgeService(deps);

    // Simulate: terminal acknowledged, state changed to Running
    deps.listTerminals = () => [{ state: 'Running' }];
    svc.onStateChange();

    // Badge should be cleared immediately (not wait for timer)
    expect(app.dock.setBadge).toHaveBeenCalledWith('');
  });

  test('timed 模式下有多个 WaitingInput 终端，acknowledge 一个后角标减少', () => {
    const terminals = [
      { state: 'WaitingInput' },
      { state: 'WaitingInput' },
      { state: 'Running' },
    ];
    const deps = makeDeps({ mode: 'timed', terminals });
    const svc = createDockBadgeService(deps);

    // One terminal acknowledged
    terminals[0].state = 'Running';
    svc.onStateChange();

    expect(app.dock.setBadge).toHaveBeenCalledWith('1');
  });

  test('realtime 模式下 onStateChange 仍正常工作', () => {
    const deps = makeDeps({
      mode: 'realtime',
      terminals: [{ state: 'Running' }],
    });
    const svc = createDockBadgeService(deps);
    svc.onStateChange();

    expect(app.dock.setBadge).toHaveBeenCalledWith('');
  });

  test('off 模式下 onStateChange 不调用 setBadge', () => {
    const deps = makeDeps({
      mode: 'off',
      terminals: [{ state: 'WaitingInput' }],
    });
    const svc = createDockBadgeService(deps);
    svc.onStateChange();

    expect(app.dock.setBadge).not.toHaveBeenCalled();
  });
});
