// @vitest-environment jsdom
//
// 问题3a：live 索引首扫中（syncStatus==='syncing'）的空态渲染——中栏不再误报「暂无会话记录」，
// 改显骨架 + 「正在建立索引…」提示。断言面 = 真实工件 ChatHistoryScreen（live 路径，fx.live 挂 bundle）。
// 静态/golden 路径（无 fx.live）由 chat-history.spec-cases.test.ts 守卫「暂无会话记录」冻结不变。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ChatHistoryScreen } from '../src/screen/chat/ChatHistoryScreen';

/** 最小 live bundle（fx 边界 any）：只填屏渲染读到的数据字段 + no-op 交互函数。 */
function liveBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const noop = (): void => {};
  return {
    onSelectProject: noop,
    onSelectSession: noop,
    onDoubleClickSession: noop,
    onBack: noop,
    onSearchInput: noop,
    onLoadMoreSessions: noop,
    onLoadEarlierMessages: noop,
    onResume: noop,
    onClose: noop,
    onDismissBanner: noop,
    searchState: 'EmptySearch',
    projectsLoading: false,
    sessionsLoading: false,
    canResume: false,
    hasEarlierMessages: false,
    sessionsLoadingMore: false,
    messagesLoadingMore: false,
    syncStatus: 'idle',
    lastSyncMs: null,
    syncProgress: null,
    noCC: false,
    bannerText: '',
    renamingSessionId: null,
    ...overrides,
  };
}

function renderLive(chat: Record<string, unknown>, live: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(ChatHistoryScreen, {
      fx: { id: 'live-empty', theme: 'dark', screen: 'chat-history', chat, live },
    }),
  );
}

const emptyChat = { banner: false, selected: null, search: null, projects: [], sessions: [], messages: [] };

describe('问题3a live 空态：索引首扫中不误报「暂无会话记录」', () => {
  test('syncing + 空列表 → 骨架 + 「正在建立索引…」，不出「暂无会话记录」', () => {
    const html = renderLive(emptyChat, liveBundle({ syncStatus: 'syncing' }));
    expect(html).toContain('session-list__sync-hint');
    expect(html).toContain('正在建立索引');
    expect(html).toContain('panel-skeleton--sessions'); // SessionsSkeleton 骨架卡组
    expect(html).not.toContain('暂无会话记录');
  });

  test('idle + 空列表 → 落「暂无会话记录」（同步已完成仍空）', () => {
    const html = renderLive(emptyChat, liveBundle({ syncStatus: 'idle' }));
    expect(html).toContain('暂无会话记录');
    expect(html).not.toContain('session-list__sync-hint');
  });

  test('搜索无匹配 + syncing → 显建索引提示（同门），不出「无匹配会话」', () => {
    const searchChat = {
      ...emptyChat,
      search: { query: 'zzz', results: [] },
    };
    const html = renderLive(searchChat, liveBundle({ syncStatus: 'syncing', searchState: 'NoResults' }));
    expect(html).toContain('session-list__sync-hint');
    expect(html).not.toContain('无匹配会话');
  });
});
