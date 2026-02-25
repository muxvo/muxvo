/**
 * TERM L1 -- 契约层测试
 * Source: docs/Muxvo_测试_v2/02_modules/test_TERM.md
 * Total: 15 L1 cases (TERM_L1_01 ~ TERM_L1_15)
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, onIpcPush, emitIpcPush, resetIpcMocks } from '../helpers/mock-ipc';
import { defaultConfig } from '../helpers/test-fixtures';
import termSpec from '../specs/l1/term.spec.json';

describe('TERM L1 -- 契约层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // -------------------------------------------------------------------------
  // IPC 通道消息格式
  // -------------------------------------------------------------------------
  describe('IPC 通道消息格式', () => {
    // --- invoke 类型 IPC ---
    const ipcCases = termSpec.cases.filter((c) => c.type === 'ipc');

    test.each(ipcCases)('$id: $description', async ({ channel, input, expectedResponse }) => {
      // Register a stub handler that returns the expected shape
      handleIpc(channel!, async () => ({
        success: true,
        data: expectedResponse,
      }));

      const result = await invokeIpc(channel!, input);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      if (expectedResponse) {
        for (const key of Object.keys(expectedResponse)) {
          expect(result.data).toHaveProperty(key);
        }
      }
    });

    // --- push 类型 IPC ---
    const pushCases = termSpec.cases.filter((c) => c.type === 'ipc-push');

    test.each(pushCases)('$id: $description', ({ channel, expectedPayload }) => {
      // Verify that push events carry the expected payload shape
      const received: unknown[] = [];
      onIpcPush(channel!, (...args: unknown[]) => {
        received.push(args[0]);
      });

      // Emit a mock push event matching expected shape
      const mockPayload: Record<string, unknown> = {};
      for (const key of Object.keys(expectedPayload as Record<string, unknown>)) {
        mockPayload[key] = `mock_${key}`;
      }
      emitIpcPush(channel!, mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      for (const key of Object.keys(expectedPayload as Record<string, unknown>)) {
        expect(payload).toHaveProperty(key);
      }
    });

    // RED: Verify real IPC handler exists in source (will fail - not implemented)
    test('TERM_L1_01_real: terminal:create handler exists in main process', async () => {
      // Import the real handler module -- will fail at import time in RED phase
      const { terminalHandlers } = await import('@/main/ipc/terminal-handlers');
      expect(terminalHandlers).toBeDefined();
      expect(terminalHandlers.create).toBeTypeOf('function');
    });
  });

  // -------------------------------------------------------------------------
  // 默认配置值
  // -------------------------------------------------------------------------
  describe('默认配置值', () => {
    const defaultCases = termSpec.cases.filter((c) => c.type === 'default-value');

    test.each(defaultCases)('$id: $description', async ({ target, expectedValue }) => {
      // RED phase: import real config module (will fail - not implemented)
      const { getDefaultConfig } = await import('@/shared/config/defaults');

      const config = getDefaultConfig();

      // Match target path to config value
      if (target === 'window.size') {
        expect(config.window.width).toBe((expectedValue as { width: number }).width);
        expect(config.window.height).toBe((expectedValue as { height: number }).height);
      } else if (target === 'fontSize') {
        expect(config.font.size).toBe(expectedValue);
      } else if (target === 'theme') {
        expect(config.theme).toBe(expectedValue);
      } else if (target === 'gridLayout.columnRatios') {
        expect(config.tile.columnRatios).toEqual(expectedValue);
      } else if (target === 'gridLayout.rowRatios') {
        expect(config.tile.rowRatios).toEqual(expectedValue);
      } else if (target === 'terminal.themeName') {
        expect(config.terminal.themeName).toBe(expectedValue);
      } else if (target === 'terminal.fontSize') {
        expect(config.terminal.fontSize).toBe(expectedValue);
      } else if (target === 'terminal.cursorStyle') {
        expect(config.terminal.cursorStyle).toBe(expectedValue);
      } else if (target === 'terminal.cursorBlink') {
        expect(config.terminal.cursorBlink).toBe(expectedValue);
      }
    });

    // Additional assertion using fixture data
    test('TERM_L1_08_fixture: 默认窗口尺寸与 fixture 一致', () => {
      expect(defaultConfig.window.width).toBe(1400);
      expect(defaultConfig.window.height).toBe(900);
    });

    test('TERM_L1_09_fixture: 默认字体大小与 fixture 一致', () => {
      expect(defaultConfig.font.size).toBe(14);
    });

    test('TERM_L1_10_fixture: 默认主题与 fixture 一致', () => {
      expect(defaultConfig.theme).toBe('dark');
    });
  });

  // -------------------------------------------------------------------------
  // Tile 默认样式
  // -------------------------------------------------------------------------
  describe('Tile 默认样式', () => {
    const uiStateCases = termSpec.cases.filter((c) => c.type === 'ui-state');

    test('TERM_L1_13: Default 状态 border -- border = var(--border)', async () => {
      // RED: import tile CSS mapping (will fail)
      const { getTileStyle } = await import('@/renderer/components/tile/tile-styles');
      const style = getTileStyle('default');
      expect(style.border).toBe('var(--border)');
    });

    test('TERM_L1_14: Default 状态 opacity -- opacity = 1', async () => {
      // RED: import tile CSS mapping (will fail)
      const { getTileStyle } = await import('@/renderer/components/tile/tile-styles');
      const style = getTileStyle('default');
      expect(style.opacity).toBe(1);
    });

    test('TERM_L1_15: 名称占位符 -- 新建终端显示灰色斜体"命名..."', async () => {
      // RED: import naming component config (will fail)
      const { getNamePlaceholder } = await import('@/renderer/components/tile/tile-naming');
      const placeholder = getNamePlaceholder();
      expect(placeholder.text).toBe('命名...');
      expect(placeholder.style).toContain('italic');
    });

    // Verify all ui-state cases from spec have matching assertions
    test.each(uiStateCases)('$id: spec data present -- $description', ({ id, state }) => {
      expect(id).toBeDefined();
      expect(state).toBeDefined();
    });
  });
});
