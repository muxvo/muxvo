/**
 * DATA L2 -- Rule Layer Tests
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_DATA.md
 * Covers: File watcher state machine, sync rules,
 *         JSONL concurrent read safety, file lock handling
 *
 * Total cases: 12
 *
 * RED phase: All tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks } from '../helpers/mock-ipc';
import { timeConstants, jsonlFixtures } from '../helpers/test-fixtures';

describe('DATA L2 -- 规则层测试', () => {
  // ---------------------------------------------------------------------------
  // 3.1 同步规则 (PRD 8.3.2)
  // ---------------------------------------------------------------------------
  describe('同步规则', () => {
    test('DATA_L2_01_sync_no_delete: 仅同步不删除（CC 侧删除镜像保留）', () => {
      // Pre-condition: CC has sessions A/B/C, mirror has A/B/C
      // Trigger: CC deletes session B
      // Expected: mirror still retains session B
      const { createSyncManager } = require('@/main/services/data-sync/sync-manager');
      const sync = createSyncManager();

      // Setup initial state
      sync.setSourceSessions(['A', 'B', 'C']);
      sync.setMirrorSessions(['A', 'B', 'C']);

      // CC deletes session B
      sync.setSourceSessions(['A', 'C']);
      sync.runSync();

      const mirrorSessions = sync.getMirrorSessions();
      expect(mirrorSessions).toContain('A');
      expect(mirrorSessions).toContain('B'); // Still retained
      expect(mirrorSessions).toContain('C');
    });

    test('DATA_L2_06_sync_startup: 启动时全量扫描', () => {
      const { createSyncManager } = require('@/main/services/data-sync/sync-manager');
      const sync = createSyncManager();

      // Simulate startup with missing sessions in mirror
      sync.setSourceSessions(['A', 'B', 'C', 'D']);
      sync.setMirrorSessions(['A', 'B']);

      sync.runStartupSync();

      const mirrorSessions = sync.getMirrorSessions();
      expect(mirrorSessions).toContain('C');
      expect(mirrorSessions).toContain('D');
      expect(mirrorSessions.length).toBe(4);
    });

    test('DATA_L2_07_sync_incremental: 运行中增量同步', () => {
      const { createSyncManager } = require('@/main/services/data-sync/sync-manager');
      const sync = createSyncManager();

      sync.setSourceSessions(['A', 'B']);
      sync.setMirrorSessions(['A', 'B']);
      sync.runStartupSync();

      // New session detected by chokidar
      sync.onFileChange({ type: 'add', path: '/sessions/C.jsonl' });

      const mirrorSessions = sync.getMirrorSessions();
      expect(mirrorSessions).toContain('C');
    });

    test('DATA_L2_09_sync_background: 同步不阻塞 UI', () => {
      const { createSyncManager } = require('@/main/services/data-sync/sync-manager');
      const sync = createSyncManager();

      const syncPromise = sync.runAsyncSync();
      expect(syncPromise).toBeInstanceOf(Promise);
      expect(sync.isBackgroundSync()).toBe(true);
      expect(sync.blocksUI()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3.2 JSONL 并发读取安全 (PRD 11.2)
  // ---------------------------------------------------------------------------
  describe('JSONL 并发读取安全', () => {
    test('DATA_L2_02_jsonl_read_delay: 文件变化后延迟 200ms 读取', () => {
      const { getJsonlReadConfig } = require('@/main/services/data-sync/jsonl-reader');
      const config = getJsonlReadConfig();
      expect(config.readDelay).toBe(timeConstants.jsonlReadDelay);
      expect(config.readDelay).toBe(200);
    });

    test('DATA_L2_04_concurrent_jsonl_read: 并发读取时忽略不完整行', () => {
      const { parseJsonlContent } = require('@/main/services/data-sync/jsonl-reader');

      // Test with mixed valid/invalid content
      const content = jsonlFixtures.multiLine + jsonlFixtures.invalidLine + jsonlFixtures.incompleteLine;

      const result = parseJsonlContent(content);

      // Valid lines should be parsed
      expect(result.parsed.length).toBe(3); // 3 valid lines from multiLine
      // Invalid line should be skipped silently
      expect(result.errors.length).toBe(0); // silent skip, not thrown
      // Incomplete line (no trailing \n) should be ignored
      expect(result.skipped).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3.3 文件监听重试 (PRD 6.12)
  // ---------------------------------------------------------------------------
  describe('文件监听状态机', () => {
    test('DATA_L2_03_watch_retry_3s_max3: 监听错误 3s 重试最多 3 次', () => {
      const { createFileWatcherStore } = require('@/main/services/file-watcher/store');
      const store = createFileWatcherStore();

      store.dispatch({ type: 'TERMINAL_CREATED', cwd: '/test/dir' });
      expect(store.getState()).toBe('Watching');

      // Simulate watch error
      store.dispatch({ type: 'WATCH_ERROR' });
      expect(store.getState()).toBe('WatchError');
      expect(store.getRetryConfig().interval).toBe(timeConstants.watchRetryInterval);
      expect(store.getRetryConfig().interval).toBe(3000);
      expect(store.getRetryConfig().maxRetries).toBe(timeConstants.watchRetryMax);
      expect(store.getRetryConfig().maxRetries).toBe(3);
    });

    test('DATA_L2_08_retry_exhausted: 重试用尽后停止监听', () => {
      const { createFileWatcherStore } = require('@/main/services/file-watcher/store');
      const store = createFileWatcherStore();

      store.dispatch({ type: 'TERMINAL_CREATED', cwd: '/test/dir' });

      // Simulate 3 failed retries
      store.dispatch({ type: 'WATCH_ERROR' });
      store.dispatch({ type: 'RETRY_FAILED' });
      store.dispatch({ type: 'RETRY_FAILED' });
      store.dispatch({ type: 'RETRY_FAILED' });

      expect(store.getState()).toBe('Inactive');
      expect(store.getRetryCount()).toBe(3);
    });

    test('DATA_L2_10_retry_success: 重试成功恢复监听', () => {
      const { createFileWatcherStore } = require('@/main/services/file-watcher/store');
      const store = createFileWatcherStore();

      store.dispatch({ type: 'TERMINAL_CREATED', cwd: '/test/dir' });
      store.dispatch({ type: 'WATCH_ERROR' });
      expect(store.getState()).toBe('WatchError');

      store.dispatch({ type: 'RETRY_SUCCESS' });
      expect(store.getState()).toBe('Watching');
    });
  });

  // ---------------------------------------------------------------------------
  // 3.4 同步冲突处理 (PRD 11.1)
  // ---------------------------------------------------------------------------
  describe('文件锁与冲突处理', () => {
    test('DATA_L2_05_sync_file_locked: 文件被锁定时跳过', () => {
      const { createSyncManager } = require('@/main/services/data-sync/sync-manager');
      const sync = createSyncManager();

      // Simulate locked file
      sync.setFileLocked('/sessions/locked.jsonl', true);
      const result = sync.syncFile('/sessions/locked.jsonl');

      expect(result.skipped).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.retryOnNextSync).toBe(true);
    });

    test('DATA_L2_11_mirror_permission: 镜像目录权限不足降级', () => {
      const { createSyncManager } = require('@/main/services/data-sync/sync-manager');
      const sync = createSyncManager();

      // Simulate permission denied on mirror directory
      sync.setMirrorWritable(false);
      sync.runSync();

      expect(sync.getMode()).toBe('readonly');
      expect(sync.getWarningMessage()).toBe('无法写入数据目录，历史备份已暂停');
    });
  });

  // ---------------------------------------------------------------------------
  // 3.5 监听范围
  // ---------------------------------------------------------------------------
  describe('监听范围', () => {
    test('DATA_L2_12_watch_scope: 三类监听范围', () => {
      const { getWatchScopes } = require('@/main/services/file-watcher/scopes');
      const scopes = getWatchScopes();

      expect(scopes.length).toBe(3);
      expect(scopes.map((s: { type: string }) => s.type)).toContain('project-files');
      expect(scopes.map((s: { type: string }) => s.type)).toContain('session-jsonl');
      expect(scopes.map((s: { type: string }) => s.type)).toContain('claude-resources');
    });
  });
});
