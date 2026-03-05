/**
 * VERIFY: dock-badge 通知权限对话框的决策层逻辑
 *
 * 验证点：
 * 1. 首次启用模式时调用 showMessageBoxSync（无 parent window）
 * 2. 已通知过则不重复弹
 * 3. 点击"前往设置"时打开系统设置
 * 4. mode=off 时不弹对话框
 * 5. app.focus() 在弹对话框前被调用
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock electron before importing
vi.mock('electron', () => ({
  app: {
    focus: vi.fn(),
    dock: { setBadge: vi.fn() },
  },
  dialog: {
    showMessageBoxSync: vi.fn().mockReturnValue(1), // default: "稍后" (index 1)
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

import { app, dialog, shell } from 'electron';
import { createDockBadgeService } from '@/main/services/dock-badge';

function makeDeps(overrides: {
  mode?: 'off' | 'realtime' | 'timed';
  notified?: boolean;
} = {}) {
  const mode = overrides.mode ?? 'realtime';
  let notified = overrides.notified ?? false;
  return {
    listTerminals: () => [] as Array<{ state: string }>,
    getConfig: () => ({ mode, intervalMin: 1 }),
    getPermissionNotified: () => notified,
    setPermissionNotified: () => { notified = true; },
    _isNotified: () => notified,
  };
}

describe('dock-badge permission dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('首次启用 realtime 模式时弹出对话框', () => {
    const deps = makeDeps({ mode: 'realtime', notified: false });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        message: '开启通知提醒',
        buttons: ['前往设置', '稍后'],
      }),
    );
    expect(deps._isNotified()).toBe(true);
  });

  test('弹对话框前调用 app.focus()', () => {
    const deps = makeDeps({ mode: 'realtime', notified: false });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    // app.focus() 应在 showMessageBoxSync 之前被调用
    const focusOrder = (app.focus as any).mock.invocationCallOrder[0];
    const dialogOrder = (dialog.showMessageBoxSync as any).mock.invocationCallOrder[0];
    expect(focusOrder).toBeLessThan(dialogOrder);
  });

  test('不传 parent window（无 BrowserWindow 参数）', () => {
    const deps = makeDeps({ mode: 'realtime', notified: false });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    // showMessageBoxSync 只传一个 options 对象，不传 BrowserWindow
    const call = (dialog.showMessageBoxSync as any).mock.calls[0];
    expect(call).toHaveLength(1); // 只有 1 个参数（options），没有 parent window
  });

  test('已通知过则不重复弹', () => {
    const deps = makeDeps({ mode: 'realtime', notified: true });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
  });

  test('mode=off 不弹对话框', () => {
    const deps = makeDeps({ mode: 'off', notified: false });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
    expect(deps._isNotified()).toBe(false);
  });

  test('点击"前往设置"时打开系统通知设置', () => {
    vi.mocked(dialog.showMessageBoxSync).mockReturnValue(0); // "前往设置" is index 0
    const deps = makeDeps({ mode: 'realtime', notified: false });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    expect(shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    );
  });

  test('点击"稍后"不打开系统设置', () => {
    vi.mocked(dialog.showMessageBoxSync).mockReturnValue(1); // "稍后" is index 1
    const deps = makeDeps({ mode: 'realtime', notified: false });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('首次启用 timed 模式也弹对话框', () => {
    const deps = makeDeps({ mode: 'timed', notified: false });
    const svc = createDockBadgeService(deps);
    svc.reconfigure();

    expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
  });
});
