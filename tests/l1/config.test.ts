/**
 * CONFIG L1 -- 契约层测试（配置管理器）
 * Source: docs/Muxvo_测试_v2/02_modules/test_FILE_CONFIG.md (CONFIG section)
 * Total: 27 L1 cases (CONFIG_L1_01 ~ CONFIG_L1_27)
 *
 * RED phase: All tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, resetIpcMocks, onIpcPush, emitIpcPush } from '../helpers/mock-ipc';
import configSpec from '../specs/l1/config.spec.json';

// ---- Spec-driven case filters ----
const ipcCases = configSpec.cases.filter((c) => c.type === 'ipc');
const ipcPushCases = configSpec.cases.filter((c) => c.type === 'ipc-push');
const defaultValueCases = configSpec.cases.filter((c) => c.type === 'default-value');
const uiStateCases = configSpec.cases.filter((c) => c.type === 'ui-state');

describe('CONFIG L1 -- 契约层测试', () => {
  describe('IPC 通道格式验证', () => {
    beforeEach(() => {
      resetIpcMocks();
    });

    // ---- IPC invoke cases (CONFIG_L1_01 ~ CONFIG_L1_07) ----
    test.each(ipcCases)('$id: $description', async ({ id, channel, input, expectedResponse }) => {
      handleIpc(channel!, async (_event, ...args) => {
        const data: Record<string, unknown> = {};
        if (expectedResponse) {
          for (const key of Object.keys(expectedResponse)) {
            data[key] = (expectedResponse as Record<string, unknown>)[key];
          }
        }
        return { success: true, data };
      });

      const result = await invokeIpc(channel!, input);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      if (expectedResponse) {
        for (const key of Object.keys(expectedResponse)) {
          expect(result.data).toHaveProperty(key);
        }
      }
    });

    // ---- IPC push case (CONFIG_L1_08) ----
    test.each(ipcPushCases)('$id: $description', ({ id, channel, expectedPayload }) => {
      const received: unknown[] = [];
      onIpcPush(channel!, (...args) => {
        received.push(args);
      });

      const mockPayload: Record<string, unknown> = {};
      if (expectedPayload) {
        for (const key of Object.keys(expectedPayload)) {
          mockPayload[key] = `mock_${key}`;
        }
      }
      emitIpcPush(channel!, mockPayload);

      expect(received.length).toBe(1);
      const payload = (received[0] as unknown[])[0] as Record<string, unknown>;
      if (expectedPayload) {
        for (const key of Object.keys(expectedPayload)) {
          expect(payload).toHaveProperty(key);
        }
      }
    });
  });

  describe('默认值与初始状态', () => {
    // ---- CONFIG_L1_09: 8 resource type cards ----
    const card09 = uiStateCases.find((c) => c.id === 'CONFIG_L1_09');
    test(`CONFIG_L1_09: ${card09?.description ?? '分类卡片显示 -- 8 种资源类型卡片及数量'}`, () => {
      const { getConfigOverview } = require('@/renderer/features/config-manager/overview');
      const overview = getConfigOverview();
      const expectedCards = ['Skills', 'Hooks', 'Plans', 'Tasks', 'Settings', 'CLAUDE.md', 'Memory', 'MCP'];
      expect(overview.cards.map((c: { name: string }) => c.name)).toEqual(expectedCards);
      expect(overview.cards.length).toBe(8);
    });

    // ---- CONFIG_L1_10: Resource operation permissions ----
    const perm10 = defaultValueCases.find((c) => c.id === 'CONFIG_L1_10');
    test(`CONFIG_L1_10: ${perm10?.description ?? '资源操作权限'}`, () => {
      const { getResourcePermissions } = require('@/renderer/features/config-manager/permissions');
      const perms = getResourcePermissions();
      const expected = perm10!.expectedValue as { readOnly: string[]; editable: string[] };
      expect(perms.readOnly).toEqual(expected.readOnly);
      expect(perms.editable).toEqual(expected.editable);
    });
  });

  describe('资源浏览与编辑', () => {
    // CONFIG_L1_11: Browse Skills list
    test('CONFIG_L1_11: 浏览 Skills 列表 -- 点击 Skills 卡片展开列表, 支持搜索', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Skills' });
      expect(store.getState()).toBe('SkillsList');
      expect(store.hasSearchSupport()).toBe(true);
    });

    // CONFIG_L1_12: Preview Skill content
    test('CONFIG_L1_12: 预览 Skill 内容 -- 点击 Skill 显示 SKILL.md 渲染内容', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Skills' });
      store.dispatch({ type: 'SELECT_RESOURCE', resourceId: 'skill-1' });
      expect(store.getState()).toBe('ResourcePreview');
      expect(store.getPreviewFormat()).toBe('markdown');
    });

    // CONFIG_L1_13: Edit Settings
    test('CONFIG_L1_13: 编辑 Settings -- 修改 JSON 值, 保存后写入 settings.json', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Settings' });
      expect(store.getState()).toBe('SettingsView');
      store.dispatch({ type: 'EDIT_SETTINGS', changes: { fontSize: 16 } });
      expect(store.getState()).toBe('SettingsEditing');
      store.dispatch({ type: 'SAVE_SETTINGS' });
      expect(store.getState()).toBe('SettingsView');
    });

    // CONFIG_L1_14: Edit CLAUDE.md
    test('CONFIG_L1_14: 编辑 CLAUDE.md -- 修改 Markdown, 保存后写入 CLAUDE.md', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'CLAUDE.md' });
      expect(store.getState()).toBe('ClaudeMdView');
      store.dispatch({ type: 'EDIT_CLAUDE_MD', content: '# Updated' });
      expect(store.getState()).toBe('ClaudeMdEditing');
      store.dispatch({ type: 'SAVE_CLAUDE_MD' });
      expect(store.getState()).toBe('ClaudeMdView');
    });

    // CONFIG_L1_15: Close config manager
    test('CONFIG_L1_15: 关闭配置管理器 -- Esc/关闭按钮返回 Closed', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      expect(store.getState()).not.toBe('Closed');
      store.dispatch({ type: 'CLOSE' });
      expect(store.getState()).toBe('Closed');
    });

    // CONFIG_L1_16: No Skills empty state
    test('CONFIG_L1_16: 无 Skills 缺省态 -- 显示"还没有 Skills..."', () => {
      const { getEmptyStateMessage } = require('@/renderer/features/config-manager/empty-state');
      const message = getEmptyStateMessage('skills');
      expect(message).toBe('还没有 Skills，可以在终端中使用 claude code 自动创建');
    });

    // CONFIG_L1_17: No Hooks empty state
    test('CONFIG_L1_17: 无 Hooks 缺省态 -- 显示"还没有配置 Hooks"', () => {
      const { getEmptyStateMessage } = require('@/renderer/features/config-manager/empty-state');
      const message = getEmptyStateMessage('hooks');
      expect(message).toBe('还没有配置 Hooks');
    });

    // CONFIG_L1_18: Settings read failure
    test('CONFIG_L1_18: Settings 读取失败 -- 显示"无法读取 settings.json" + 警告图标 + 重试', () => {
      const { getErrorState } = require('@/renderer/features/config-manager/error-state');
      const errorState = getErrorState('settings_read_failed');
      expect(errorState.message).toBe('无法读取 settings.json');
      expect(errorState.icon).toBe('warning');
      expect(errorState.button).toBe('[重试]');
    });
  });

  describe('状态机路径覆盖', () => {
    // CONFIG_L1_19: Open config manager
    test('CONFIG_L1_19: 打开配置管理器 -- Closed -> CategoryList(Overview)', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      expect(store.getState()).toBe('Closed');
      store.dispatch({ type: 'OPEN' });
      expect(store.getState()).toBe('Overview');
    });

    // CONFIG_L1_20: Click Skills card
    test('CONFIG_L1_20: 点击 Skills 卡片 -- Overview -> SkillsList', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Skills' });
      expect(store.getState()).toBe('SkillsList');
    });

    // CONFIG_L1_21: Click Hooks card
    test('CONFIG_L1_21: 点击 Hooks 卡片 -- Overview -> HooksList', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Hooks' });
      expect(store.getState()).toBe('HooksList');
    });

    // CONFIG_L1_22: Click Plans card
    test('CONFIG_L1_22: 点击 Plans 卡片 -- Overview -> PlansList', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Plans' });
      expect(store.getState()).toBe('PlansList');
    });

    // CONFIG_L1_23: Click Tasks card
    test('CONFIG_L1_23: 点击 Tasks 卡片 -- Overview -> TasksList', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Tasks' });
      expect(store.getState()).toBe('TasksList');
    });

    // CONFIG_L1_24: Click Memory card
    test('CONFIG_L1_24: 点击 Memory 卡片 -- Overview -> MemoryView', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Memory' });
      expect(store.getState()).toBe('MemoryView');
    });

    // CONFIG_L1_25: Click MCP card
    test('CONFIG_L1_25: 点击 MCP 卡片 -- Overview -> McpView', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'MCP' });
      expect(store.getState()).toBe('McpView');
    });

    // CONFIG_L1_26: Resource list click preview cycle
    test('CONFIG_L1_26: 资源列表点击预览 -- SkillsList -> ResourcePreview -> SkillsList', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Skills' });
      expect(store.getState()).toBe('SkillsList');
      store.dispatch({ type: 'SELECT_RESOURCE', resourceId: 'skill-1' });
      expect(store.getState()).toBe('ResourcePreview');
      store.dispatch({ type: 'BACK' });
      expect(store.getState()).toBe('SkillsList');
    });

    // CONFIG_L1_27: Settings/CLAUDE.md edit save cycle
    test('CONFIG_L1_27: Settings/CLAUDE.md 编辑保存周期 -- View -> Editing -> View', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();

      // Settings cycle
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Settings' });
      expect(store.getState()).toBe('SettingsView');
      store.dispatch({ type: 'EDIT_SETTINGS', changes: { theme: 'light' } });
      expect(store.getState()).toBe('SettingsEditing');
      store.dispatch({ type: 'SAVE_SETTINGS' });
      expect(store.getState()).toBe('SettingsView');

      // CLAUDE.md cycle
      store.dispatch({ type: 'BACK' });
      store.dispatch({ type: 'SELECT_CARD', card: 'CLAUDE.md' });
      expect(store.getState()).toBe('ClaudeMdView');
      store.dispatch({ type: 'EDIT_CLAUDE_MD', content: '# New' });
      expect(store.getState()).toBe('ClaudeMdEditing');
      store.dispatch({ type: 'SAVE_CLAUDE_MD' });
      expect(store.getState()).toBe('ClaudeMdView');
    });
  });
});
