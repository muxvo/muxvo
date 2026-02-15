/**
 * DATA L1 -- 契约层测试（数据同步）
 * Source: docs/Muxvo_测试_v2/02_modules/test_DATA.md
 * Total: 7 L1 cases (DATA_L1_01 ~ DATA_L1_07)
 *
 * RED phase: All tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks, onIpcPush, emitIpcPush } from '../helpers/mock-ipc';
import dataSpec from '../specs/l1/data.spec.json';

// ---- Spec-driven case filters ----
const ipcPushCases = dataSpec.cases.filter((c) => c.type === 'ipc-push');
const uiStateCases = dataSpec.cases.filter((c) => c.type === 'ui-state');
const defaultValueCases = dataSpec.cases.filter((c) => c.type === 'default-value');

describe('DATA L1 -- 契约层测试', () => {
  describe('文件监听状态推送', () => {
    beforeEach(() => {
      resetIpcMocks();
    });

    // DATA_L1_01: File watcher activation
    test('DATA_L1_01: 文件监听启动 -- 终端创建后开始监听 cwd 目录, Inactive -> Watching', () => {
      const { createFileWatcherStore } = require('@/main/services/file-watcher/store');
      const store = createFileWatcherStore();
      expect(store.getState()).toBe('Inactive');

      // Simulate terminal creation
      store.dispatch({ type: 'TERMINAL_CREATED', cwd: '/Users/test/project' });
      expect(store.getState()).toBe('Watching');
      expect(store.getWatchedPath()).toBe('/Users/test/project');
    });

    // DATA_L1_02: New file creation notification
    test('DATA_L1_02: 新文件创建通知 -- Watching 状态下 cwd 新增文件, UI 标记 NEW', () => {
      const received: unknown[] = [];
      onIpcPush('fs:change', (...args) => {
        received.push(args);
      });

      // Simulate add event push
      const addPayload = { type: 'add', path: '/Users/test/project/new-file.ts', watchId: 'w1' };
      emitIpcPush('fs:change', addPayload);

      expect(received.length).toBe(1);
      const payload = (received[0] as unknown[])[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('type', 'add');
      expect(payload).toHaveProperty('path');

      // RED phase: assert the UI marks the file with NEW indicator
      const { getFileIndicator } = require('@/renderer/features/file-panel/indicators');
      const indicator = getFileIndicator(addPayload);
      expect(indicator).toBe('NEW');
    });

    // DATA_L1_03: File modification notification
    test('DATA_L1_03: 文件修改通知 -- Watching 状态下文件被修改, UI 刷新', () => {
      const received: unknown[] = [];
      onIpcPush('fs:change', (...args) => {
        received.push(args);
      });

      const changePayload = { type: 'change', path: '/Users/test/project/main.ts', watchId: 'w1' };
      emitIpcPush('fs:change', changePayload);

      expect(received.length).toBe(1);
      const payload = (received[0] as unknown[])[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('type', 'change');

      // RED phase: assert the UI refreshes
      const { shouldRefreshFileList } = require('@/renderer/features/file-panel/handlers');
      expect(shouldRefreshFileList(changePayload)).toBe(true);
    });

    // DATA_L1_04: File deletion notification
    test('DATA_L1_04: 文件删除通知 -- Watching 状态下文件被删除, UI 移除条目', () => {
      const received: unknown[] = [];
      onIpcPush('fs:change', (...args) => {
        received.push(args);
      });

      const unlinkPayload = { type: 'unlink', path: '/Users/test/project/old.ts', watchId: 'w1' };
      emitIpcPush('fs:change', unlinkPayload);

      expect(received.length).toBe(1);
      const payload = (received[0] as unknown[])[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('type', 'unlink');

      // RED phase: assert the UI removes the entry
      const { shouldRemoveFileEntry } = require('@/renderer/features/file-panel/handlers');
      expect(shouldRemoveFileEntry(unlinkPayload)).toBe(true);
    });

    // DATA_L1_05: Stop watching on terminal close
    test('DATA_L1_05: 停止监听 -- 终端关闭后停止监听目录, Watching -> Inactive', () => {
      const { createFileWatcherStore } = require('@/main/services/file-watcher/store');
      const store = createFileWatcherStore();

      // Start watching
      store.dispatch({ type: 'TERMINAL_CREATED', cwd: '/Users/test/project' });
      expect(store.getState()).toBe('Watching');

      // Close terminal
      store.dispatch({ type: 'TERMINAL_CLOSED' });
      expect(store.getState()).toBe('Inactive');
    });
  });

  describe('镜像文件存储格式', () => {
    // DATA_L1_06: Mirror directory structure
    test('DATA_L1_06: 镜像目录结构 -- 同步后检查 chat-history/ 目录结构', () => {
      const spec06 = defaultValueCases.find((c) => c.id === 'DATA_L1_06');
      expect(spec06).toBeDefined();

      const expectedFiles = spec06!.expectedValue as { files: string[] };
      expect(expectedFiles.files).toBeDefined();
      expect(expectedFiles.files.length).toBeGreaterThan(0);

      // RED phase: verify the sync module creates the expected structure
      const { getMirrorStructure } = require('@/main/services/data-sync/mirror');
      const structure = getMirrorStructure();
      for (const file of expectedFiles.files) {
        expect(structure.files).toContain(file);
      }
    });

    // DATA_L1_07: sync-state.json format
    test('DATA_L1_07: sync-state.json 格式 -- 包含每个项目的最后同步时间和文件 mtime', () => {
      const spec07 = defaultValueCases.find((c) => c.id === 'DATA_L1_07');
      expect(spec07).toBeDefined();

      const expected = spec07!.expectedValue as { contains: string };
      expect(expected.contains).toBeDefined();

      // RED phase: verify the sync-state module provides the expected format
      const { getSyncStateSchema } = require('@/main/services/data-sync/sync-state');
      const schema = getSyncStateSchema();
      expect(schema).toHaveProperty('lastSync');
      expect(schema).toHaveProperty('fileMtime');
    });
  });
});
