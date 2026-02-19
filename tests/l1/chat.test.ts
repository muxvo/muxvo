/**
 * CHAT L1 -- 契约层测试（聊天历史）
 * Source: docs/Muxvo_测试_v2/02_modules/test_CHAT.md
 * Total: 27 L1 cases
 *
 * 基于文件系统扫描 ~/.claude/projects/ 的新架构
 * IPC: chat:get-projects, chat:get-sessions, chat:get-session, chat:search, chat:export
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, onIpcPush, emitIpcPush, resetIpcMocks } from '../helpers/mock-ipc';
import { chatLayoutFixtures } from '../helpers/test-fixtures';
import chatSpec from '../specs/l1/chat.spec.json';

describe('CHAT L1 -- 契约层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // -------------------------------------------------------------------------
  // IPC 通道格式验证
  // -------------------------------------------------------------------------
  describe('IPC 通道格式验证', () => {
    const ipcCases = chatSpec.cases.filter((c) => c.type === 'ipc');

    test('CHAT_L1_01: chat:get-projects IPC 格式 -- 返回 { projects: ProjectInfo[] }', async () => {
      handleIpc('chat:get-projects', async () => ({
        success: true,
        data: {
          projects: [
            { projectHash: 'hash1', displayPath: '/Users/test/proj', displayName: 'proj', sessionCount: 3, lastActivity: 1700000000000 },
          ],
        },
      }));

      const result = await invokeIpc('chat:get-projects');
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('projects');

      const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
      const handlers = createChatHandlers();
      const realResult = await handlers.getProjects();
      expect(realResult).toHaveProperty('projects');
      expect(Array.isArray(realResult.projects)).toBe(true);
      if (realResult.projects.length > 0) {
        const p = realResult.projects[0];
        expect(p).toHaveProperty('projectHash');
        expect(p).toHaveProperty('displayPath');
        expect(p).toHaveProperty('displayName');
        expect(p).toHaveProperty('sessionCount');
        expect(p).toHaveProperty('lastActivity');
      }
    });

    test('CHAT_L1_02: chat:get-sessions IPC 格式 -- 传入 projectHash 返回 sessions 数组', async () => {
      handleIpc('chat:get-sessions', async () => ({
        success: true,
        data: {
          sessions: [
            { sessionId: 's1', projectHash: 'hash1', title: 'Hello', startedAt: '2024-01-01T00:00:00Z', lastModified: 1700000000000, messageCount: 5 },
          ],
        },
      }));

      const result = await invokeIpc('chat:get-sessions', { projectHash: 'hash1' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('sessions');

      const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
      const handlers = createChatHandlers();
      const realResult = await handlers.getSessions({ projectHash: 'hash1' });
      expect(realResult).toHaveProperty('sessions');
      expect(Array.isArray(realResult.sessions)).toBe(true);
      if (realResult.sessions.length > 0) {
        const s = realResult.sessions[0];
        expect(s).toHaveProperty('sessionId');
        expect(s).toHaveProperty('projectHash');
        expect(s).toHaveProperty('title');
        expect(s).toHaveProperty('startedAt');
        expect(s).toHaveProperty('lastModified');
        expect(s).toHaveProperty('messageCount');
      }
    });

    test('CHAT_L1_03: chat:get-sessions __all__ 模式 -- 传入 __all__ 返回所有项目的最近 sessions', async () => {
      const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
      const handlers = createChatHandlers();
      const realResult = await handlers.getSessions({ projectHash: '__all__' });
      expect(realResult).toHaveProperty('sessions');
      expect(Array.isArray(realResult.sessions)).toBe(true);
    });

    test('CHAT_L1_04: chat:get-session IPC 格式 -- 传入 projectHash+sessionId 返回 messages 数组', async () => {
      handleIpc('chat:get-session', async () => ({
        success: true,
        data: {
          messages: [
            { uuid: 'u1', type: 'user', sessionId: 's1', cwd: '/proj', timestamp: '2024-01-01T00:00:00Z', content: 'hello' },
          ],
        },
      }));

      const result = await invokeIpc('chat:get-session', { projectHash: 'hash1', sessionId: 's1' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('messages');

      const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
      const handlers = createChatHandlers();
      const realResult = await handlers.getSession({ projectHash: 'hash1', sessionId: 's1' });
      expect(realResult).toHaveProperty('messages');
      expect(Array.isArray(realResult.messages)).toBe(true);
      if (realResult.messages.length > 0) {
        const m = realResult.messages[0];
        expect(m).toHaveProperty('uuid');
        expect(m).toHaveProperty('type');
        expect(m).toHaveProperty('sessionId');
        expect(m).toHaveProperty('cwd');
        expect(m).toHaveProperty('timestamp');
        expect(m).toHaveProperty('content');
      }
    });

    test('CHAT_L1_05: chat:search IPC 格式 -- 传入 query 返回 SearchResult[]', async () => {
      handleIpc('chat:search', async () => ({
        success: true,
        data: {
          results: [
            { projectHash: 'hash1', sessionId: 's1', snippet: 'test context', timestamp: '2024-01-01T00:00:00Z' },
          ],
        },
      }));

      const result = await invokeIpc('chat:search', { query: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('results');

      const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
      const handlers = createChatHandlers();
      const realResult = await handlers.search({ query: 'test' });
      expect(realResult).toHaveProperty('results');
      expect(Array.isArray(realResult.results)).toBe(true);
      if (realResult.results.length > 0) {
        const r = realResult.results[0];
        expect(r).toHaveProperty('projectHash');
        expect(r).toHaveProperty('sessionId');
        expect(r).toHaveProperty('snippet');
        expect(r).toHaveProperty('timestamp');
      }
    });

    test('CHAT_L1_06: chat:export IPC 格式 -- 导出为 Markdown/JSON 格式', async () => {
      handleIpc('chat:export', async () => ({
        success: true,
        data: { outputPath: '/tmp/export/session.md' },
      }));

      const result = await invokeIpc('chat:export', { projectHash: 'hash1', sessionId: 's1', format: 'markdown' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('outputPath');

      const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
      const handlers = createChatHandlers();
      const realResult = await handlers.export({ projectHash: 'hash1', sessionId: 's1', format: 'markdown' });
      expect(realResult).toHaveProperty('outputPath');
      expect(typeof realResult.outputPath).toBe('string');
    });

    // --- push 类型 IPC ---
    test('CHAT_L1_07: chat:session-update 推送格式 -- 推送 projectHash+sessionId', () => {
      const received: unknown[] = [];
      onIpcPush('chat:session-update', (...args: unknown[]) => {
        received.push(args[0]);
      });

      const mockPayload = {
        projectHash: 'hash1',
        sessionId: 'session-123',
      };
      emitIpcPush('chat:session-update', mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('projectHash');
      expect(payload).toHaveProperty('sessionId');
    });

    test('CHAT_L1_08: chat:sync-status 推送格式 -- 同步状态变化通知', () => {
      const received: unknown[] = [];
      onIpcPush('chat:sync-status', (...args: unknown[]) => {
        received.push(args[0]);
      });

      const mockPayload = {
        status: 'syncing',
      };
      emitIpcPush('chat:sync-status', mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('status');
      expect(['syncing', 'idle', 'error']).toContain(payload.status);
    });

    // Verify all IPC spec cases have channels defined
    test.each(ipcCases)('$id: IPC channel "$channel" is valid -- $description', ({ channel }) => {
      expect(channel).toBeDefined();
      expect(channel).toMatch(/^chat:/);
    });
  });

  // -------------------------------------------------------------------------
  // 默认值与初始状态
  // -------------------------------------------------------------------------
  describe('默认值与初始状态', () => {
    test('CHAT_L1_09: 三栏默认布局 -- 左栏 220px, 中栏 340px, 右栏 flex', async () => {
      const { getChatLayoutDefaults } = await import('@/renderer/components/chat/chat-layout-config');
      const layout = getChatLayoutDefaults();
      expect(layout.left).toBe('220px');
      expect(layout.middle).toBe('340px');
      expect(layout.right).toBe('flex');

      // Verify fixture min widths
      expect(chatLayoutFixtures.leftMin).toBe(180);
      expect(chatLayoutFixtures.centerMin).toBe(280);
      expect(chatLayoutFixtures.rightMin).toBe(400);
    });

    test('CHAT_L1_10: 会话卡片默认字段 -- 标题/时间/预览/标签/tool calls 数', async () => {
      const { getSessionCardConfig } = await import('@/renderer/components/chat/session-card-config');
      const config = getSessionCardConfig();
      expect(config.fields).toEqual(
        expect.arrayContaining(['title', 'time', 'preview', 'tags', 'toolCallCount']),
      );
      expect(config.timeFormat).toBeDefined();
      expect(config.previewTruncate).toBe('2 lines');
    });

    test('CHAT_L1_11: 会话详情消息渲染 -- user 右侧气泡, assistant 左侧气泡, 代码块高亮', async () => {
      const { getMessageRenderConfig } = await import('@/renderer/components/chat/message-renderer');
      const config = getMessageRenderConfig();
      expect(config.userMessage.alignment).toBe('right');
      expect(config.userMessage.background).toContain('accent');
      expect(config.assistantMessage.alignment).toBe('left');
      expect(config.assistantMessage.background).toContain('elevated');
      expect(config.codeBlock.syntaxHighlight).toBe(true);
      expect(config.codeBlock.copyButton).toBe(true);
    });

    test('CHAT_L1_12: 工具调用默认折叠 -- 蓝色左边框, 默认折叠, 点击展开', async () => {
      const { getToolCallRenderConfig } = await import('@/renderer/components/chat/tool-call-renderer');
      const config = getToolCallRenderConfig();
      expect(config.toolCall.borderLeft).toBe('blue');
      expect(config.toolCall.defaultState).toBe('collapsed');
      expect(config.toolResult.borderLeft).toBe('green');
      expect(config.toolResult.defaultState).toBe('collapsed');
    });

    test('CHAT_L1_13: 同步状态 UI -- 面板底部显示"Muxvo 镜像 -- 最后同步 HH:MM"', async () => {
      const { getSyncStatusConfig } = await import('@/renderer/components/chat/sync-status');
      const config = getSyncStatusConfig();
      expect(config.text).toMatch(/Muxvo 镜像/);
      expect(config.syncingIcon).toBe('spinning');
    });

    test('CHAT_L1_14: 空状态(未检测到CC) -- 显示"未检测到 Claude Code 聊天记录..."', async () => {
      const { getEmptyStateConfig } = await import('@/renderer/components/chat/empty-state');
      const config = getEmptyStateConfig('noCC');
      expect(config.message).toContain('未检测到 Claude Code 聊天记录');
      expect(config.icon).toBe('dialog bubble');
      expect(config.button).toBeDefined();
      expect(config.button.text).toContain('了解 Claude Code');
    });

    test('CHAT_L1_15: 空状态(无 projects) -- 显示"还没有聊天记录..."', async () => {
      const { getEmptyStateConfig } = await import('@/renderer/components/chat/empty-state');
      const config = getEmptyStateConfig('noHistory');
      expect(config.message).toContain('还没有聊天记录');
    });
  });

  // -------------------------------------------------------------------------
  // 三栏联动交互
  // -------------------------------------------------------------------------
  describe('三栏联动交互', () => {
    test('CHAT_L1_16: 选择项目过滤会话 -- 左栏点击项目, 中栏仅显示该项目会话', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate selecting a project
      store.selectProject('my-project');

      expect(store.selectedProject).toBe('my-project');
      // Middle panel should filter to that project's sessions
      expect(store.filteredSessions.every(
        (s: { project: string }) => s.project === 'my-project',
      )).toBe(true);
      // Right panel should clear
      expect(store.selectedSession).toBeNull();
    });

    test('CHAT_L1_17: 点击会话加载详情 -- 中栏点击卡片, 右栏显示完整对话', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate clicking a session card
      await store.selectSession('session-123');

      expect(store.selectedSession).toBe('session-123');
      expect(store.sessionMessages).toBeDefined();
      expect(Array.isArray(store.sessionMessages)).toBe(true);
    });

    test('CHAT_L1_18: 双击会话跳转终端 -- 关闭面板并跳转到对应终端', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate double-clicking a session card
      await store.jumpToTerminal('session-123');

      expect(store.panelState).toBe('Closed');
      // Should have emitted a terminal focus event
      expect(store.lastJumpTarget).toBe('session-123');
    });

    test('CHAT_L1_19: 从详情返回列表 -- 点击返回保持项目筛选', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Set up a state with project filter and session detail
      store.selectProject('my-project');
      await store.selectSession('session-123');

      // Go back
      store.goBack();

      expect(store.panelState).toBe('Ready');
      // Should maintain the project filter
      expect(store.selectedProject).toBe('my-project');
      expect(store.selectedSession).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 搜索交互
  // -------------------------------------------------------------------------
  describe('搜索交互', () => {
    test('CHAT_L1_10_search: 搜索有结果 -- Searching 状态找到匹配会话进入 HasResults', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate search with results
      await store.search('test query');

      expect(store.searchState).toBe('HasResults');
      expect(store.searchResults.length).toBeGreaterThan(0);
    });

    test('CHAT_L1_11_search: 搜索无结果 -- Searching 状态无匹配进入 NoResults', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate search with no results
      await store.search('xyznonexistent999');

      expect(store.searchState).toBe('NoResults');
      expect(store.searchResults).toHaveLength(0);
    });

    test('CHAT_L1_12_search: 修改搜索词 -- HasResults/NoResults 重新进入 Searching', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // First search
      await store.search('test');

      // Modify search term -- should re-enter Searching
      store.updateSearchQuery('new test');
      expect(store.searchState).toBe('Searching');
    });

    test('CHAT_L1_13_search: 清空搜索框 -- HasResults/NoResults 回到 EmptySearch', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Search first
      await store.search('test');

      // Clear search
      store.clearSearch();

      expect(store.searchState).toBe('EmptySearch');
      // Should show all sessions again
      expect(store.searchQuery).toBe('');
    });

    test('CHAT_L1_14_close: 关闭面板 -- Ready 状态 Esc/关闭按钮回到 Closed', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Open the panel first
      await store.open();
      expect(store.panelState).toBe('Ready');

      // Close via Esc
      store.close();
      expect(store.panelState).toBe('Closed');
    });
  });

  // -------------------------------------------------------------------------
  // 状态机路径覆盖
  // -------------------------------------------------------------------------
  describe('状态机路径覆盖', () => {
    test('CHAT_L1_T07: 点击会话进入详情 -- Ready -> SessionDetail', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Start in Ready state
      await store.open();
      expect(store.panelState).toBe('Ready');

      // Click session -> SessionDetail
      await store.selectSession('session-123');
      expect(store.panelState).toBe('SessionDetail');
    });

    test('CHAT_L1_T08: 详情返回列表 -- SessionDetail -> Ready', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Navigate to SessionDetail
      await store.open();
      await store.selectSession('session-123');
      expect(store.panelState).toBe('SessionDetail');

      // Go back -> Ready
      store.goBack();
      expect(store.panelState).toBe('Ready');
    });

    test('CHAT_L1_T09: 双击会话跳转终端关闭面板 -- SessionDetail -> Closed', async () => {
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Navigate to SessionDetail
      await store.open();
      await store.selectSession('session-123');
      expect(store.panelState).toBe('SessionDetail');

      // Double-click jump -> Closed
      await store.jumpToTerminal('session-123');
      expect(store.panelState).toBe('Closed');
    });
  });
});
