/**
 * VERIFY-dock-badge-permission-once
 *
 * Bug: 每次启动 app 都弹 Dock 角标权限对话框，即使用户已经看过。
 * Root cause: badgePermissionNotified 是内存变量，重启后重置。
 * Fix: 通过 deps.getPermissionNotified/setPermissionNotified 持久化到 config.json。
 *
 * Test strategy: mock Electron APIs，直接测 createDockBadgeService 的决策逻辑。
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock electron modules before importing the service
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    dock: { setBadge: vi.fn() },
  },
  dialog: {
    showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  Notification: Object.assign(
    vi.fn().mockImplementation(() => ({
      show: vi.fn(),
      close: vi.fn(),
    })),
    { isSupported: vi.fn().mockReturnValue(false) },
  ),
}));

import { createDockBadgeService } from '@/main/services/dock-badge';
import { dialog } from 'electron';

function createMockDeps(overrides: {
  mode?: 'off' | 'realtime' | 'timed';
  permissionNotified?: boolean;
}) {
  const notified = { value: overrides.permissionNotified ?? false };
  return {
    listTerminals: () => [] as Array<{ state: string }>,
    getConfig: () => ({
      mode: (overrides.mode ?? 'realtime') as 'off' | 'realtime' | 'timed',
      intervalMin: 1,
    }),
    getPermissionNotified: () => notified.value,
    setPermissionNotified: vi.fn(() => {
      notified.value = true;
    }),
    _notified: notified,
  };
}

describe('VERIFY Dock Badge Permission Once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('first enable (permissionNotified=false) → shows dialog', () => {
    const deps = createMockDeps({ mode: 'realtime', permissionNotified: false });
    const service = createDockBadgeService(deps);
    service.reconfigure();

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(deps.setPermissionNotified).toHaveBeenCalledTimes(1);
  });

  test('already notified (permissionNotified=true) → does NOT show dialog', () => {
    const deps = createMockDeps({ mode: 'realtime', permissionNotified: true });
    const service = createDockBadgeService(deps);
    service.reconfigure();

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(deps.setPermissionNotified).not.toHaveBeenCalled();
  });

  test('reconfigure called twice → dialog shown only once', () => {
    const deps = createMockDeps({ mode: 'realtime', permissionNotified: false });
    const service = createDockBadgeService(deps);
    service.reconfigure();
    service.reconfigure();

    // First call sets notified=true via setPermissionNotified,
    // second call reads notified=true and skips
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  test('mode=off → no dialog regardless of permissionNotified', () => {
    const deps = createMockDeps({ mode: 'off', permissionNotified: false });
    const service = createDockBadgeService(deps);
    service.reconfigure();

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
