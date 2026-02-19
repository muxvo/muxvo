/**
 * CHAT L1 -- 契约层测试（聊天历史）
 * Source: docs/Muxvo_测试_v2/02_modules/test_CHAT.md
 * Total: 27 L1 cases
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, onIpcPush, emitIpcPush, resetIpcMocks } from '../helpers/mock-ipc';
import { chatLayoutFixtures, jsonlFixtures, searchFixtures } from '../helpers/test-fixtures';
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

    test('CHAT_L1_01: chat:get-history IPC 格式 -- 返回 { sessions: Array<SessionSummary> }', async () => {
      // Register a mock handler returning the expected shape
      handleIpc('chat:get-history', async () => ({
        success: true,
        data: {
          sessions: [
            { sessionId: 's1', project: '/proj', projectHash: 'abc123', title: 'Test session', timestamp: 1704067200000, messageCount: 5 },
          ],
        },
      }));

      const result = await invokeIpc('chat:get-history');
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('sessions');

      // RED: verify real handler returns correct shape (will fail)
      const { chatHandlers } = await import('@/main/ipc/chat-handlers');
      const realResult = await chatHandlers.getHistory() as { sessions: unknown[] };
      expect(realResult).toHaveProperty('sessions');
      expect(Array.isArray(realResult.sessions)).toBe(true);
      if (realResult.sessions.length > 0) {
        expect(realResult.sessions[0]).toHaveProperty('sessionId');
        expect(realResult.sessions[0]).toHaveProperty('project');
        expect(realResult.sessions[0]).toHaveProperty('projectHash');
        expect(realResult.sessions[0]).toHaveProperty('title');
        expect(realResult.sessions[0]).toHaveProperty('timestamp');
        expect(realResult.sessions[0]).toHaveProperty('messageCount');
      }
    });

    test('CHAT_L1_02: chat:get-session IPC 格式 -- 传入 sessionId+projectHash 返回 messages 数组', async () => {
      handleIpc('chat:get-session', async () => ({
        success: true,
        data: {
          messages: [
            { type: 'user', uuid: 'u1', sessionId: 'test-session', timestamp: '2024-01-01' },
          ],
        },
      }));

      const result = await invokeIpc('chat:get-session', { sessionId: 'test-session', projectHash: 'test-hash' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('messages');

      // RED: verify real handler (will fail)
      const { chatHandlers } = await import('@/main/ipc/chat-handlers');
      const realResult = await chatHandlers.getSession({ sessionId: 'test-session', projectHash: 'test-hash' });
      expect(realResult).toHaveProperty('messages');
      expect(Array.isArray(realResult.messages)).toBe(true);
    });

    test('CHAT_L1_03: chat:search IPC 格式 -- 传入 query 返回匹配 sessions', async () => {
      handleIpc('chat:search', async () => ({
        success: true,
        data: {
          results: [
            { sessionId: 's1', matches: 3, context: 'test context' },
          ],
        },
      }));

      const result = await invokeIpc('chat:search', { query: 'test' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('results');

      // RED: verify real handler (will fail)
      const { chatHandlers } = await import('@/main/ipc/chat-handlers');
      const realResult = await chatHandlers.search({ query: 'test' });
      expect(realResult).toHaveProperty('results');
      expect(Array.isArray(realResult.results)).toBe(true);
    });

    test('CHAT_L1_04: chat:get-history 错误响应 -- CC 文件不可用时返回统一错误格式', async () => {
      handleIpc('chat:get-history', async () => ({
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'CC files and mirror both unavailable' },
      }));

      const result = await invokeIpc('chat:get-history');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('FILE_NOT_FOUND');
      expect(result.error!.message).toEqual(expect.any(String));

      // RED: verify real handler error shape (will fail)
      const { chatHandlers } = await import('@/main/ipc/chat-handlers');
      // Simulate unavailable files scenario
      const errorResult = await chatHandlers.getHistory({ forceFail: true }) as { error: { code: string } };
      expect(errorResult.error).toBeDefined();
      expect(errorResult.error.code).toBe('FILE_NOT_FOUND');
    });

    test('CHAT_L1_05: chat:export IPC 格式 -- 导出为 Markdown 格式', async () => {
      handleIpc('chat:export', async () => ({
        success: true,
        data: { filePath: '/tmp/export/session.md' },
      }));

      const result = await invokeIpc('chat:export', { sessionId: 's1', format: 'md' });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('filePath');

      // RED: verify real handler (will fail)
      const { chatHandlers } = await import('@/main/ipc/chat-handlers');
      const realResult = await chatHandlers.export({ sessionId: 's1', format: 'markdown', projectHash: 'test-hash' });
      expect(realResult).toHaveProperty('outputPath');
      expect(typeof realResult.outputPath).toBe('string');
    });

    // --- push 类型 IPC ---
    test('CHAT_L1_06: chat:session-update 推送格式 -- 后台同步推送新/更新 session', () => {
      const received: unknown[] = [];
      onIpcPush('chat:session-update', (...args: unknown[]) => {
        received.push(args[0]);
      });

      const mockPayload = {
        sessionId: 'session-123',
        action: 'added',
        data: { display: 'new session', timestamp: Date.now() },
      };
      emitIpcPush('chat:session-update', mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('sessionId');
      expect(payload).toHaveProperty('action');
      expect(['added', 'updated']).toContain(payload.action);
      expect(payload).toHaveProperty('data');
    });

    test('CHAT_L1_07: chat:sync-status 推送格式 -- 同步状态变化通知', () => {
      const received: unknown[] = [];
      onIpcPush('chat:sync-status', (...args: unknown[]) => {
        received.push(args[0]);
      });

      const mockPayload = {
        status: 'syncing',
        lastSync: '2024-01-01T12:00:00Z',
        progress: 0.5,
      };
      emitIpcPush('chat:sync-status', mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('status');
      expect(['syncing', 'done', 'error']).toContain(payload.status);
      expect(payload).toHaveProperty('lastSync');
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
    test('CHAT_L1_08: 默认选中全部项目 -- 左栏"全部项目"默认高亮', async () => {
      // RED: import the real chat panel store (will fail)
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();
      expect(store.selectedProject).toBe('全部项目');
    });

    test('CHAT_L1_09: 三栏默认布局 -- 左栏 220px, 中栏 340px, 右栏 flex', async () => {
      // RED: import the real chat layout config (will fail)
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
      // RED: import the real session card config (will fail)
      const { getSessionCardConfig } = await import('@/renderer/components/chat/session-card-config');
      const config = getSessionCardConfig();
      expect(config.fields).toEqual(
        expect.arrayContaining(['title', 'time', 'preview', 'tags', 'toolCallCount']),
      );
      expect(config.timeFormat).toBeDefined();
      expect(config.previewTruncate).toBe('2 lines');
    });

    test('CHAT_L1_11: 会话详情消息渲染 -- user 右侧气泡, assistant 左侧气泡, 代码块高亮', async () => {
      // RED: import the real message renderer config (will fail)
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
      // RED: import the real tool call renderer config (will fail)
      const { getToolCallRenderConfig } = await import('@/renderer/components/chat/tool-call-renderer');
      const config = getToolCallRenderConfig();
      expect(config.toolCall.borderLeft).toBe('blue');
      expect(config.toolCall.defaultState).toBe('collapsed');
      expect(config.toolResult.borderLeft).toBe('green');
      expect(config.toolResult.defaultState).toBe('collapsed');
    });

    test('CHAT_L1_13: 同步状态 UI -- 面板底部显示"Muxvo 镜像 -- 最后同步 HH:MM"', async () => {
      // RED: import the real sync status config (will fail)
      const { getSyncStatusConfig } = await import('@/renderer/components/chat/sync-status');
      const config = getSyncStatusConfig();
      expect(config.text).toMatch(/Muxvo 镜像/);
      expect(config.syncingIcon).toBe('spinning');
    });

    test('CHAT_L1_14: 空状态(未检测到CC) -- 显示"未检测到 Claude Code 聊天记录..."', async () => {
      // RED: import the real empty state config (will fail)
      const { getEmptyStateConfig } = await import('@/renderer/components/chat/empty-state');
      const config = getEmptyStateConfig('noCC');
      expect(config.message).toContain('未检测到 Claude Code 聊天记录');
      expect(config.icon).toBe('dialog bubble');
      expect(config.button).toBeDefined();
      expect(config.button.text).toContain('了解 Claude Code');
    });

    test('CHAT_L1_15: 空状态(CC已装但无记录) -- 显示"还没有聊天记录..."', async () => {
      // RED: import the real empty state config (will fail)
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
      // RED: import the real chat panel store (will fail)
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Load sessions first so filtering has data
      await store.loadSessions([
        { sessionId: 's1', project: 'my-project', projectHash: 'h1', title: 'Session 1', timestamp: 1704067200000, messageCount: 3 },
        { sessionId: 's2', project: 'other-project', projectHash: 'h2', title: 'Session 2', timestamp: 1704153600000, messageCount: 5 },
      ]);

      // Simulate selecting a project
      store.selectProject('my-project');

      expect(store.selectedProject).toBe('my-project');
      // Middle panel should filter to that project's sessions
      expect(store.filteredSessions.every(
        (s) => s.project === 'my-project',
      )).toBe(true);
      // Right panel should clear
      expect(store.selectedSession).toBeNull();
    });

    test('CHAT_L1_17: 点击会话加载详情 -- 中栏点击卡片, 右栏显示完整对话', async () => {
      // RED: import the real chat panel store (will fail)
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate clicking a session card
      await store.selectSession('session-123');

      expect(store.selectedSession).toBe('session-123');
      expect(store.sessionMessages).toBeDefined();
      expect(Array.isArray(store.sessionMessages)).toBe(true);
    });

    test('CHAT_L1_18: 双击会话跳转终端 -- 关闭面板并跳转到对应终端', async () => {
      // RED: import the real chat panel store (will fail)
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate double-clicking a session card
      await store.jumpToTerminal('session-123');

      expect(store.panelState).toBe('Closed');
      // Should have emitted a terminal focus event
      expect(store.lastJumpTarget).toBe('session-123');
    });

    test('CHAT_L1_19: 从详情返回列表 -- 点击返回保持项目筛选', async () => {
      // RED: import the real chat panel store (will fail)
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
      // RED: import the real chat panel store (will fail)
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Load sessions so search has data to match against
      await store.loadSessions([
        { sessionId: 's1', project: 'proj', projectHash: 'h1', title: 'Test query session', timestamp: 1704067200000, messageCount: 3 },
      ]);

      // Simulate search with results
      await store.search('test query');

      expect(store.searchState).toBe('HasResults');
      expect(store.searchResults.length).toBeGreaterThan(0);
    });

    test('CHAT_L1_11_search: 搜索无结果 -- Searching 状态无匹配进入 NoResults', async () => {
      // RED: import the real chat panel store (will fail)
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // Simulate search with no results
      await store.search('xyznonexistent999');

      expect(store.searchState).toBe('NoResults');
      expect(store.searchResults).toHaveLength(0);
    });

    test('CHAT_L1_12_search: 修改搜索词 -- HasResults/NoResults 重新进入 Searching', async () => {
      // RED: import the real chat panel store (will fail)
      const { useChatPanelStore } = await import('@/renderer/stores/chat-panel');
      const store = useChatPanelStore();

      // First search
      await store.search('test');
      const firstState = store.searchState;

      // Modify search term -- should re-enter Searching
      store.updateSearchQuery('new test');
      expect(store.searchState).toBe('Searching');
    });

    test('CHAT_L1_13_search: 清空搜索框 -- HasResults/NoResults 回到 EmptySearch', async () => {
      // RED: import the real chat panel store (will fail)
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
      // RED: import the real chat panel store (will fail)
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
      // RED: import the real chat panel state machine (will fail)
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
      // RED: import the real chat panel state machine (will fail)
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
      // RED: import the real chat panel state machine (will fail)
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
