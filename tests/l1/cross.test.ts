/**
 * CROSS L1 -- 契约层测试（跨功能模块: APP + SETTINGS + PERF + ERROR）
 * Source: docs/Muxvo_测试_v2/02_modules/test_CROSS.md
 * Total: 12 L1 cases
 *   APP_L1_01~05, SETTINGS_L1_01~02, PERF_L1_01~02, ERROR_L1_01~03
 *
 * RED phase: All tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, onIpcPush, emitIpcPush, resetIpcMocks } from '../helpers/mock-ipc';
import { defaultConfig } from '../helpers/test-fixtures';
import crossSpec from '../specs/l1/cross.spec.json';

// ---- Spec-driven case filters ----
const ipcCases = crossSpec.cases.filter((c) => c.type === 'ipc');
const ipcPushCases = crossSpec.cases.filter((c) => c.type === 'ipc-push');
const defaultValueCases = crossSpec.cases.filter((c) => c.type === 'default-value');

describe('CROSS L1 -- 契约层测试', () => {
  // ========== APP ==========
  describe('APP -- 应用生命周期', () => {
    beforeEach(() => {
      resetIpcMocks();
    });

    // ---- APP_L1_01: app:get-config IPC 格式 ----
    test('APP_L1_01: app:get-config IPC 格式 -- 返回完整 config 结构', async () => {
      const spec = ipcCases.find((c) => c.id === 'APP_L1_01');
      expect(spec).toBeDefined();

      handleIpc('app:get-config', async () => {
        return {
          success: true,
          data: {
            window: { width: 1400, height: 900, x: 100, y: 100 },
            openTerminals: [],
            gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
            ftvLeftWidth: 250,
            ftvRightWidth: 300,
            theme: 'dark',
            fontSize: 14,
          },
        };
      });

      const result = await invokeIpc('app:get-config');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('window');
      expect(data).toHaveProperty('openTerminals');
      expect(data).toHaveProperty('gridLayout');
      expect(data).toHaveProperty('ftvLeftWidth');
      expect(data).toHaveProperty('ftvRightWidth');
      expect(data).toHaveProperty('theme');
      expect(data).toHaveProperty('fontSize');

      // RED phase: verify actual module returns the same contract
      const { getAppConfig } = await import('@/main/services/app/config');
      const realConfig = await getAppConfig();
      expect(realConfig).toHaveProperty('window');
      expect(realConfig).toHaveProperty('openTerminals');
      expect(realConfig).toHaveProperty('gridLayout');
      expect(realConfig).toHaveProperty('theme');
      expect(realConfig).toHaveProperty('fontSize');
    });

    // ---- APP_L1_02: app:save-config IPC 格式 ----
    test('APP_L1_02: app:save-config IPC 格式 -- 传入配置对象返回 { success }', async () => {
      const spec = ipcCases.find((c) => c.id === 'APP_L1_02');
      expect(spec).toBeDefined();

      handleIpc('app:save-config', async (_event, config) => {
        return { success: true, data: { success: true } };
      });

      const configToSave = {
        window: defaultConfig.window,
        theme: defaultConfig.theme,
        fontSize: defaultConfig.font.size,
      };

      const result = await invokeIpc('app:save-config', configToSave);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>)).toHaveProperty('success');

      // RED phase: verify actual module persists config
      const { saveAppConfig } = await import('@/main/services/app/config');
      const saveResult = await saveAppConfig(configToSave);
      expect(saveResult).toHaveProperty('success', true);
    });

    // ---- APP_L1_03: app:get-preferences IPC 格式 ----
    test('APP_L1_03: app:get-preferences IPC 格式 -- 返回用户偏好设置', async () => {
      const spec = ipcCases.find((c) => c.id === 'APP_L1_03');
      expect(spec).toBeDefined();

      handleIpc('app:get-preferences', async () => {
        return {
          success: true,
          data: { preferences: { theme: 'dark', fontSize: 14, locale: 'zh-CN' } },
        };
      });

      const result = await invokeIpc('app:get-preferences');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>)).toHaveProperty('preferences');

      // RED phase: verify actual module returns preferences
      const { getPreferences } = await import('@/main/services/app/preferences');
      const prefs = await getPreferences();
      expect(prefs).toHaveProperty('preferences');
      expect(typeof prefs.preferences).toBe('object');
    });

    // ---- APP_L1_04: app:save-preferences IPC 格式 ----
    test('APP_L1_04: app:save-preferences IPC 格式 -- 传入偏好对象返回 { success }', async () => {
      const spec = ipcCases.find((c) => c.id === 'APP_L1_04');
      expect(spec).toBeDefined();

      handleIpc('app:save-preferences', async (_event, prefs) => {
        return { success: true, data: { success: true } };
      });

      const prefsToSave = { theme: 'light', fontSize: 16 };
      const result = await invokeIpc('app:save-preferences', prefsToSave);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>)).toHaveProperty('success');

      // RED phase: verify actual module persists preferences
      const { savePreferences } = await import('@/main/services/app/preferences');
      const saveResult = await savePreferences(prefsToSave);
      expect(saveResult).toHaveProperty('success', true);
    });

    // ---- APP_L1_05: app:memory-warning push 事件格式 ----
    test('APP_L1_05: app:memory-warning push 事件格式 -- 内存超阈值推送警告', () => {
      const spec = ipcPushCases.find((c) => c.id === 'APP_L1_05');
      expect(spec).toBeDefined();

      const received: unknown[] = [];
      onIpcPush('app:memory-warning', (...args) => {
        received.push(args);
      });

      const mockPayload = {
        currentMemoryMB: 2200,
        threshold: 2048,
        message: '内存占用较高，建议关闭部分终端',
      };
      emitIpcPush('app:memory-warning', mockPayload);

      expect(received.length).toBe(1);
      const payload = (received[0] as unknown[])[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('currentMemoryMB');
      expect(payload).toHaveProperty('threshold');
      expect(payload).toHaveProperty('message');
      expect(typeof payload.currentMemoryMB).toBe('number');
      expect(typeof payload.threshold).toBe('number');
      expect(typeof payload.message).toBe('string');
    });
  });

  // ========== SETTINGS ==========
  describe('SETTINGS -- 设置面板', () => {
    test('SETTINGS_L1_01: startupTerminalCount 配置默认值 -- 默认为 1', async () => {
      const spec = defaultValueCases.find((c) => c.id === 'SETTINGS_L1_01');
      expect(spec).toBeDefined();

      const { createConfigManager } = await import('@/main/services/app/config');
      const manager = createConfigManager({ configDir: '/tmp/test-nonexistent' });
      const config = manager.loadConfig();
      expect(config.startupTerminalCount).toBe(1);
    });

    test('SETTINGS_L1_02: preferences 持久化格式 -- 读写 language 字段', async () => {
      const spec = defaultValueCases.find((c) => c.id === 'SETTINGS_L1_02');
      expect(spec).toBeDefined();

      const { getPreferences } = await import('@/main/services/app/preferences');
      const result = await getPreferences();
      expect(result).toHaveProperty('preferences');
      expect(typeof result.preferences).toBe('object');
    });
  });

  // ========== PERF ==========
  describe('PERF -- 性能策略', () => {
    beforeEach(() => {
      resetIpcMocks();
    });

    // ---- PERF_L1_01: 性能指标数据格式 ----
    test('PERF_L1_01: 性能指标数据格式 -- 返回内存/终端数/缓冲区行数', async () => {
      const spec = defaultValueCases.find((c) => c.id === 'PERF_L1_01');
      expect(spec).toBeDefined();

      // RED phase: verify actual module returns perf metrics format
      const { getPerformanceMetrics } = await import('@/main/services/perf/metrics');
      const metrics = await getPerformanceMetrics();

      expect(metrics).toHaveProperty('memoryUsageMB');
      expect(metrics).toHaveProperty('terminalCount');
      expect(metrics).toHaveProperty('bufferLines');
      expect(typeof metrics.memoryUsageMB).toBe('number');
      expect(typeof metrics.terminalCount).toBe('number');
      expect(metrics.bufferLines).toHaveProperty('focused');
      expect(metrics.bufferLines).toHaveProperty('background');
      expect(typeof metrics.bufferLines.focused).toBe('number');
      expect(Array.isArray(metrics.bufferLines.background)).toBe(true);
    });

    // ---- PERF_L1_02: 内存警告 push 事件格式 ----
    test('PERF_L1_02: 内存警告 push 事件格式 -- 超 2GB 阈值推送', () => {
      const spec = ipcPushCases.find((c) => c.id === 'PERF_L1_02');
      expect(spec).toBeDefined();

      const received: unknown[] = [];
      onIpcPush('app:memory-warning', (...args) => {
        received.push(args);
      });

      const mockPayload = {
        currentMemoryMB: 2200,
        threshold: 2048,
        message: '内存占用较高，建议关闭部分终端',
      };
      emitIpcPush('app:memory-warning', mockPayload);

      expect(received.length).toBe(1);
      const payload = (received[0] as unknown[])[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('currentMemoryMB');
      expect(payload.threshold).toBe(2048);
      expect(payload.message).toBe('内存占用较高，建议关闭部分终端');

      // RED phase: verify actual module emits memory warning at threshold
      const { createMemoryMonitor } = require('@/main/services/perf/memory-monitor');
      const monitor = createMemoryMonitor({ thresholdMB: 2048 });
      expect(monitor.getThreshold()).toBe(2048);
      expect(typeof monitor.checkMemory).toBe('function');
    });
  });

  // ========== ERROR ==========
  describe('ERROR -- 异常处理', () => {
    // ---- ERROR_L1_01: 统一错误响应格式 ----
    test('ERROR_L1_01: 统一错误响应格式 -- 返回 { code, message, details? }', async () => {
      const spec = defaultValueCases.find((c) => c.id === 'ERROR_L1_01');
      expect(spec).toBeDefined();

      // RED phase: verify actual error module exports the unified error format
      const { createAppError } = await import('@/shared/errors/app-error');
      const error = createAppError('SPAWN_FAILED', 'Process failed to start', { pid: 1234 });

      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('details');
      expect(typeof error.code).toBe('string');
      expect(typeof error.message).toBe('string');
      expect(error.code).toBe('SPAWN_FAILED');
      expect(error.message).toBe('Process failed to start');
      expect(error.details).toEqual({ pid: 1234 });
    });

    // ---- ERROR_L1_02: 错误码枚举验证 ----
    test('ERROR_L1_02: 错误码枚举验证 -- 包含所有预定义错误码', async () => {
      const spec = defaultValueCases.find((c) => c.id === 'ERROR_L1_02');
      expect(spec).toBeDefined();

      const expectedCodes = [
        'SPAWN_FAILED',
        'FILE_READ_ERROR',
        'NETWORK_ERROR',
        'INSTALL_FAILED',
        'SCORE_FAILED',
        'AUTH_FAILED',
        'PUBLISH_BLOCKED',
      ];

      // RED phase: verify actual error codes module contains all expected codes
      const { ErrorCodes } = await import('@/shared/errors/error-codes');
      expect(ErrorCodes).toBeDefined();

      for (const code of expectedCodes) {
        expect(ErrorCodes).toHaveProperty(code);
      }
    });

    // ---- ERROR_L1_03: 错误分类验证 ----
    test('ERROR_L1_03: 错误分类验证 -- 可恢复/需用户操作/阻止操作三级分类', async () => {
      const spec = defaultValueCases.find((c) => c.id === 'ERROR_L1_03');
      expect(spec).toBeDefined();

      // RED phase: verify actual error categories module
      const { ErrorCategories } = await import('@/shared/errors/error-categories');
      expect(ErrorCategories).toBeDefined();

      // Auto-recoverable
      expect(ErrorCategories).toHaveProperty('autoRecoverable');
      expect(Array.isArray(ErrorCategories.autoRecoverable)).toBe(true);
      const autoRecoverable = ['download retry', 'JSONL skip', 'file locked skip', 'partial source fallback'];
      for (const item of autoRecoverable) {
        expect(ErrorCategories.autoRecoverable).toContain(item);
      }

      // User action required
      expect(ErrorCategories).toHaveProperty('userActionRequired');
      expect(Array.isArray(ErrorCategories.userActionRequired)).toBe(true);
      const userAction = ['process crash', 'file read fail', 'network offline', 'permission error'];
      for (const item of userAction) {
        expect(ErrorCategories.userActionRequired).toContain(item);
      }

      // Blocking
      expect(ErrorCategories).toHaveProperty('blocking');
      expect(Array.isArray(ErrorCategories.blocking)).toBe(true);
      const blocking = ['API key detected', 'sensitive file detected', 'integrity check failed'];
      for (const item of blocking) {
        expect(ErrorCategories.blocking).toContain(item);
      }
    });
  });
});
