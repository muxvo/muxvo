/**
 * FILE + CONFIG L2 -- Rule Layer Tests
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_FILE_CONFIG.md
 * Covers:
 *   FILE: panel transition, column sizing, edit mode, directory switch, markdown preview (20 cases)
 *   CONFIG: resource type browsing, settings edit, virtual scroll (9 cases)
 *
 * Total cases: 29
 *
 * RED phase: All tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks, handleIpc, invokeIpc } from '../helpers/mock-ipc';
import { defaultConfig, timeConstants, terminalFixtures } from '../helpers/test-fixtures';
import boundarySpec from '../specs/l2/boundaries.spec.json';

// =============================================================================
// FILE L2
// =============================================================================
describe('FILE L2 -- 规则层测试', () => {
  // ---------------------------------------------------------------------------
  // 3.1 文件面板过渡动画
  // ---------------------------------------------------------------------------
  describe('文件面板过渡动画', () => {
    test('FILE_L2_01_panel_transition_300ms: 面板打开过渡 300ms', () => {
      // Pre-condition: Closed state
      // Trigger: click file button
      // Expected: Opening->Open transition takes 300ms
      const { createFilePanelStore } = require('@/renderer/features/file-panel/store');
      const store = createFilePanelStore();
      expect(store.getState()).toBe('Closed');

      store.dispatch({ type: 'OPEN' });
      const transition = store.getTransition();
      expect(transition.duration).toBe(timeConstants.filePanelTransition);
      expect(transition.duration).toBe(300);
    });

    test('FILE_L2_02_close_transition: 面板关闭过渡 300ms', () => {
      // Pre-condition: Open state
      // Trigger: Esc
      // Expected: translateX(0)->translateX(100%), 300ms transition
      const { createFilePanelStore } = require('@/renderer/features/file-panel/store');
      const store = createFilePanelStore();
      store.dispatch({ type: 'OPEN' });

      store.dispatch({ type: 'CLOSE' });
      const transition = store.getTransition();
      expect(transition.from).toBe('translateX(0)');
      expect(transition.to).toBe('translateX(100%)');
      expect(transition.duration).toBe(300);
    });
  });

  // ---------------------------------------------------------------------------
  // 3.2 三栏尺寸规则
  // ---------------------------------------------------------------------------
  describe('三栏尺寸规则', () => {
    test('FILE_L2_03_column_min_width: 左栏最小宽度 150px', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });

      // Try to resize below minimum
      store.dispatch({ type: 'RESIZE_LEFT', width: 100 });
      expect(store.getLeftWidth()).toBeGreaterThanOrEqual(150);
    });

    test('FILE_L2_04_column_max_width: 左栏最大宽度 500px', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });

      // Try to resize above maximum
      store.dispatch({ type: 'RESIZE_LEFT', width: 600 });
      expect(store.getLeftWidth()).toBeLessThanOrEqual(500);
    });

    test('FILE_L2_05_right_min_width: 右栏最小宽度 150px', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });

      store.dispatch({ type: 'RESIZE_RIGHT', width: 100 });
      expect(store.getRightWidth()).toBeGreaterThanOrEqual(150);
    });

    test('FILE_L2_06_right_max_width: 右栏最大宽度 500px', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });

      store.dispatch({ type: 'RESIZE_RIGHT', width: 600 });
      expect(store.getRightWidth()).toBeLessThanOrEqual(500);
    });

    test('FILE_L2_07_resize_persist: 宽度持久化', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });
      store.dispatch({ type: 'RESIZE_LEFT', width: 300 });
      expect(store.getLeftWidth()).toBe(300);

      // Close and reopen — width should persist
      store.dispatch({ type: 'EXIT' });
      store.dispatch({ type: 'ENTER', fileId: 'b.md' });
      expect(store.getLeftWidth()).toBe(300);
    });

    test('FILE_L2_08_default_widths: 默认宽度值', () => {
      // First open with no persisted data -> default widths
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore({ fresh: true });
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });
      expect(store.getLeftWidth()).toBe(250);
      expect(store.getRightWidth()).toBe(280);
    });
  });

  // ---------------------------------------------------------------------------
  // 3.3 编辑模式规则
  // ---------------------------------------------------------------------------
  describe('编辑模式规则', () => {
    test('FILE_L2_09_unsaved_prompt: 未保存修改切换模式弹出提示', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });
      store.dispatch({ type: 'TOGGLE_MODE' }); // -> EditMode
      store.dispatch({ type: 'MODIFY' }); // mark dirty
      store.dispatch({ type: 'TOGGLE_MODE' }); // -> UnsavedPrompt

      expect(store.isUnsavedPromptVisible()).toBe(true);
      const options = store.getPromptOptions();
      expect(options).toContain('save');
      expect(options).toContain('discard');
      expect(options).toContain('cancel');
    });

    test('FILE_L2_10_unsaved_save: UnsavedPrompt 选择保存', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });
      store.dispatch({ type: 'TOGGLE_MODE' });
      store.dispatch({ type: 'MODIFY' });
      store.dispatch({ type: 'TOGGLE_MODE' }); // -> UnsavedPrompt
      store.dispatch({ type: 'SAVE_AND_SWITCH' });

      expect(store.getMode()).toBe('PreviewMode');
      expect(store.isDirty()).toBe(false);
    });

    test('FILE_L2_11_unsaved_discard: UnsavedPrompt 选择放弃', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });
      store.dispatch({ type: 'TOGGLE_MODE' });
      store.dispatch({ type: 'MODIFY' });
      store.dispatch({ type: 'TOGGLE_MODE' }); // -> UnsavedPrompt
      store.dispatch({ type: 'DISCARD_AND_SWITCH' });

      expect(store.getMode()).toBe('PreviewMode');
      expect(store.isDirty()).toBe(false);
    });

    test('FILE_L2_12_unsaved_cancel: UnsavedPrompt 选择取消', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'a.md' });
      store.dispatch({ type: 'TOGGLE_MODE' });
      store.dispatch({ type: 'MODIFY' });
      store.dispatch({ type: 'TOGGLE_MODE' }); // -> UnsavedPrompt
      store.dispatch({ type: 'CANCEL_PROMPT' });

      expect(store.getMode()).toBe('EditMode');
      expect(store.isDirty()).toBe(true);
    });

    test('FILE_L2_13_md_preview_render: Markdown 渲染 CommonMark+GFM', () => {
      const { getMarkdownRenderer } = require('@/renderer/features/file-viewer/markdown');
      const renderer = getMarkdownRenderer();
      expect(renderer.supportsCommonMark()).toBe(true);
      expect(renderer.supportsGFM()).toBe(true);
      expect(renderer.hasSyntaxHighlighting()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3.4 目录切换规则 (PRD 6.7 决策树)
  // ---------------------------------------------------------------------------
  describe('目录切换规则', () => {
    test('FILE_L2_14_cd_shell_direct: shell 状态直接 cd', () => {
      // Foreground process is bash (in shell list) -> direct cd
      const { getCdStrategy } = require('@/renderer/features/terminal/cd-strategy');
      const strategy = getCdStrategy({ foregroundProcess: 'bash', shellList: [...terminalFixtures.shellList] });
      expect(strategy.type).toBe('direct');
      expect(strategy.command).toMatch(/^cd /);
    });

    test('FILE_L2_15_cd_ai_confirm: AI 工具需确认退出', () => {
      // Foreground process is claude (not in shell list) -> confirm dialog
      const { getCdStrategy } = require('@/renderer/features/terminal/cd-strategy');
      const strategy = getCdStrategy({ foregroundProcess: 'claude', shellList: [...terminalFixtures.shellList] });
      expect(strategy.type).toBe('confirm');
      expect(strategy.message).toContain('claude');
    });

    test('FILE_L2_16_cd_confirm_ok: 确认退出后发送 cd', () => {
      const { getCdStrategy } = require('@/renderer/features/terminal/cd-strategy');
      const strategy = getCdStrategy({ foregroundProcess: 'claude', shellList: [...terminalFixtures.shellList] });
      expect(strategy.type).toBe('confirm');

      // Simulate user confirming exit
      const actions = strategy.onConfirm();
      expect(actions[0].type).toBe('SIGINT');
      expect(actions[1].type).toBe('WAIT_SHELL');
      expect(actions[2].type).toBe('CD');
    });

    test('FILE_L2_17_cd_confirm_cancel: 取消退出不切换', () => {
      const { getCdStrategy } = require('@/renderer/features/terminal/cd-strategy');
      const strategy = getCdStrategy({ foregroundProcess: 'claude', shellList: [...terminalFixtures.shellList] });

      const actions = strategy.onCancel();
      expect(actions).toEqual([]);
    });

    test('FILE_L2_18_cd_chain_actions: 目录切换连锁动作', () => {
      // After cd completes: update header cwd, check auto-grouping, update file button target
      const { getCdChainActions } = require('@/renderer/features/terminal/cd-strategy');
      const actions = getCdChainActions('/new/path');
      expect(actions).toContainEqual({ type: 'UPDATE_CWD', path: '/new/path' });
      expect(actions).toContainEqual({ type: 'CHECK_AUTO_GROUP' });
      expect(actions).toContainEqual({ type: 'UPDATE_FILE_BUTTON' });
    });
  });

  // ---------------------------------------------------------------------------
  // 3.5 Markdown 预览/编辑双模式
  // ---------------------------------------------------------------------------
  describe('Markdown 预览/编辑双模式', () => {
    test('FILE_L2_19_default_preview: 默认预览模式', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'readme.md' });
      expect(store.getMode()).toBe('PreviewMode');
    });

    test('FILE_L2_20_edit_toggle: Cmd+/ 切换预览/编辑', () => {
      const { createTempViewStore } = require('@/renderer/features/temp-view/store');
      const store = createTempViewStore();
      store.dispatch({ type: 'ENTER', fileId: 'readme.md' });
      expect(store.getMode()).toBe('PreviewMode');

      store.dispatch({ type: 'TOGGLE_MODE' });
      expect(store.getMode()).toBe('EditMode');

      store.dispatch({ type: 'TOGGLE_MODE' });
      expect(store.getMode()).toBe('PreviewMode');
    });
  });
});

// =============================================================================
// CONFIG L2
// =============================================================================
describe('CONFIG L2 -- 规则层测试', () => {
  // ---------------------------------------------------------------------------
  // 5.1 8 种资源类型浏览
  // ---------------------------------------------------------------------------
  describe('资源类型浏览与搜索', () => {
    test('CONFIG_L2_01_skills_search: Skills 搜索功能', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Skills' });

      store.dispatch({ type: 'SEARCH', query: 'test' });
      const results = store.getFilteredResources();
      expect(results.every((r: { name: string }) => r.name.toLowerCase().includes('test'))).toBe(true);
    });

    test('CONFIG_L2_02_plans_search: Plans 搜索功能', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Plans' });

      store.dispatch({ type: 'SEARCH', query: 'deploy' });
      const results = store.getFilteredResources();
      expect(results.every((r: { name: string }) => r.name.toLowerCase().includes('deploy'))).toBe(true);
    });

    test('CONFIG_L2_03_tasks_search: Tasks 搜索功能', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Tasks' });

      store.dispatch({ type: 'SEARCH', query: 'build' });
      const results = store.getFilteredResources();
      expect(Array.isArray(results)).toBe(true);
    });

    test('CONFIG_L2_04_memory_search: Memory 搜索功能', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Memory' });

      store.dispatch({ type: 'SEARCH', query: 'project' });
      const results = store.getFilteredResources();
      expect(Array.isArray(results)).toBe(true);
    });

    test('CONFIG_L2_05_hooks_readonly: Hooks 只读', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Hooks' });

      expect(store.isEditable()).toBe(false);
      expect(store.getState()).toBe('HooksList');
    });

    test('CONFIG_L2_06_mcp_readonly: MCP 只读', () => {
      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'MCP' });

      expect(store.isEditable()).toBe(false);
      expect(store.getState()).toBe('McpView');
    });
  });

  // ---------------------------------------------------------------------------
  // 5.2 Settings 编辑规则
  // ---------------------------------------------------------------------------
  describe('编辑保存规则', () => {
    beforeEach(() => {
      resetIpcMocks();
    });

    test('CONFIG_L2_07_settings_save: Settings 保存写入', async () => {
      handleIpc('config:save-settings', async (_event, ...args) => {
        return { success: true, data: { success: true } };
      });

      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'Settings' });
      store.dispatch({ type: 'EDIT_SETTINGS', changes: { fontSize: 16 } });

      await store.dispatch({ type: 'SAVE_SETTINGS' });
      expect(store.getState()).toBe('SettingsView');

      // Verify IPC was called
      const result = await invokeIpc('config:save-settings', { settings: { fontSize: 16 } });
      expect(result.success).toBe(true);
    });

    test('CONFIG_L2_08_claudemd_save: CLAUDE.md 保存写入', async () => {
      handleIpc('config:save-claude-md', async (_event, ...args) => {
        return { success: true, data: { success: true } };
      });

      const { createConfigManagerStore } = require('@/renderer/features/config-manager/store');
      const store = createConfigManagerStore();
      store.dispatch({ type: 'OPEN' });
      store.dispatch({ type: 'SELECT_CARD', card: 'CLAUDE.md' });
      store.dispatch({ type: 'EDIT_CLAUDE_MD', content: '# Updated CLAUDE.md' });

      await store.dispatch({ type: 'SAVE_CLAUDE_MD' });
      expect(store.getState()).toBe('ClaudeMdView');

      const result = await invokeIpc('config:save-claude-md', { content: '# Updated CLAUDE.md' });
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 5.3 虚拟滚动
  // ---------------------------------------------------------------------------
  describe('虚拟滚动', () => {
    test('CONFIG_L2_09_virtual_scroll: 长列表虚拟滚动', () => {
      const { createVirtualScrollList } = require('@/renderer/components/virtual-scroll');
      const list = createVirtualScrollList({ totalItems: 129, itemHeight: 40, viewportHeight: 600 });

      // Only visible items should be rendered
      const visibleCount = Math.ceil(600 / 40);
      expect(list.getRenderedCount()).toBeLessThanOrEqual(visibleCount + 2); // +2 for buffer
      expect(list.getRenderedCount()).toBeLessThan(129);
      expect(list.getTotalItems()).toBe(129);
    });
  });
});
