// @vitest-environment jsdom
//
// chat-history live hook 去抖 + 推送消费（chat-history.md §7.2/§7.4；PERF_L2_05）。
// 只有「时序」维度需渲染 hook（fake timers）；四态迁移/分页/dedup 的纯逻辑在 chat-live-reducer.test.ts。
// 断言面 = 真实工件 useChatData.ts（ChatHistoryLive 消费的同一 hook + 常量）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  ChatMessageView,
  ChatRequest,
  ChatResponse,
  ChatSessionView,
  DataEvent,
} from '../src/bridge/gen/protocol';
import {
  CHAT_SEARCH_DEBOUNCE_MS,
  CHAT_UNKNOWN_REFETCH_DEBOUNCE_MS,
  useChatData,
  type ChatDataApi,
  type UseChatDataDeps,
} from '../src/screen/chat/live/useChatData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sess(sessionId: string): ChatSessionView {
  return { sessionId, projectHash: 'ph', title: sessionId, startedAtMs: 0, lastModifiedMs: 1000, fileSize: 0 };
}

function makeDeps(initialSessions: ChatSessionView[] = []) {
  let handler: ((e: DataEvent) => void) | null = null;
  const sessionMessages: ChatMessageView[] = [{ uuid: 'm1', sessionId: 's1', role: 'user', tsMs: 0, text: 'm1' }];
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: initialSessions.slice() });
      case 'session':
        return Promise.resolve({ kind: 'messages', messages: sessionMessages.slice() });
      case 'search':
        return Promise.resolve({ kind: 'search', results: [] });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((h: (e: DataEvent) => void) => {
    handler = h;
    return () => {
      handler = null;
    };
  });
  const deps: UseChatDataDeps = { sendChatRequest, subscribeDataEvent };
  return { deps, sendChatRequest, sessionMessages, emit: (e: DataEvent) => handler?.(e) };
}

const searchCalls = (mock: ReturnType<typeof vi.fn>): ChatRequest[] =>
  mock.mock.calls.map((c) => c[0] as ChatRequest).filter((r) => r.kind === 'search');
const kindCalls = (mock: ReturnType<typeof vi.fn>, kind: ChatRequest['kind']): ChatRequest[] =>
  mock.mock.calls.map((c) => c[0] as ChatRequest).filter((r) => r.kind === kind);

function Harness({ deps, apiRef }: { deps: UseChatDataDeps; apiRef: { current: ChatDataApi | null } }): null {
  apiRef.current = useChatData(deps);
  return null;
}

let container: HTMLElement | null = null;
let root: Root | null = null;

async function mount(deps: UseChatDataDeps): Promise<{ current: ChatDataApi | null }> {
  const apiRef: { current: ChatDataApi | null } = { current: null };
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => {
    r.render(createElement(Harness, { deps, apiRef }));
  });
  await act(async () => {}); // 冲挂载期 projects/sessions 请求的 promise
  return apiRef;
}

beforeEach(() => {
  // 只 fake setTimeout/clearTimeout（去抖用）；不 fake Date/microtask/rAF，避免干扰 React act。
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe('CHAT_SEARCH_DEBOUNCE_MS（PERF_L2_05）', () => {
  test('常量 === 300（独立于终端 150）', () => {
    expect(CHAT_SEARCH_DEBOUNCE_MS).toBe(300);
  });
});

describe('搜索去抖：仅最后一次输入后 300ms 发一次（§7.4）', () => {
  test('连打三次只发一次（末词），中途重排定时器', async () => {
    const { deps, sendChatRequest } = makeDeps();
    const api = await mount(deps);

    await act(async () => api.current!.setQuery('f'));
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => api.current!.setQuery('fo'));
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => api.current!.setQuery('foo'));
    await act(async () => { vi.advanceTimersByTime(200); }); // 距末次输入仅 200ms < 300
    expect(searchCalls(sendChatRequest)).toHaveLength(0);

    await act(async () => { vi.advanceTimersByTime(150); }); // 越过 300ms → 发一次
    const calls = searchCalls(sendChatRequest);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ kind: 'search', query: 'foo' });
  });

  test('300ms 边界：299ms 不发，+1ms 发', async () => {
    const { deps, sendChatRequest } = makeDeps();
    const api = await mount(deps);
    await act(async () => api.current!.setQuery('x'));
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(searchCalls(sendChatRequest)).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(searchCalls(sendChatRequest)).toHaveLength(1);
  });

  test('300ms 内清空 → 取消，不发 search（回 EmptySearch）', async () => {
    const { deps, sendChatRequest } = makeDeps();
    const api = await mount(deps);
    await act(async () => api.current!.setQuery('foo'));
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => api.current!.setQuery('')); // 清空 → 定时器被 cleanup 清掉，新态不排定时器
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(searchCalls(sendChatRequest)).toHaveLength(0);
    expect(api.current!.searchState).toBe('EmptySearch');
  });
});

describe('data.event 推送消费（§7.2）', () => {
  test('挂载即拉 projects + sessions 首屏', async () => {
    const { deps, sendChatRequest } = makeDeps();
    await mount(deps);
    const kinds = sendChatRequest.mock.calls.map((c) => (c[0] as ChatRequest).kind);
    expect(kinds).toContain('projects');
    expect(kinds).toContain('sessions');
  });

  test('chatSyncStatus 推送 → 同步条态翻牌', async () => {
    const { deps, emit } = makeDeps();
    const api = await mount(deps);
    await act(async () => {
      emit({ kind: 'chatSyncStatus', status: 'syncing', lastSyncMs: 123 });
    });
    expect(api.current!.state.syncStatus).toBe('syncing');
    expect(api.current!.state.lastSyncMs).toBe(123);
  });

  test('chatSessionUpdate 命中当前会话 → 重取尾部按 uuid dedup 只追加新 uuid', async () => {
    const { deps, sessionMessages, emit } = makeDeps();
    const api = await mount(deps);
    await act(async () => api.current!.selectSession('s1', 'ph'));
    await act(async () => {}); // 冲首屏 messages 请求
    expect(api.current!.state.messages.map((m) => m.uuid)).toEqual(['m1']);

    // 外部续写：投影多出 m2；推送裸信号触发重取。
    sessionMessages.push({ uuid: 'm2', sessionId: 's1', role: 'assistant', tsMs: 1, text: 'm2' });
    await act(async () => {
      emit({ kind: 'chatSessionUpdate', projectHash: 'ph', sessionId: 's1' });
    });
    await act(async () => {}); // 冲重取 promise
    expect(api.current!.state.messages.map((m) => m.uuid)).toEqual(['m1', 'm2']);
  });

  test('chatSessionUpdate 非当前会话 → 不动右栏（不重取 messages）', async () => {
    const { deps, sendChatRequest, emit } = makeDeps();
    const api = await mount(deps);
    await act(async () => api.current!.selectSession('s1', 'ph'));
    await act(async () => {});
    const sessionCallsBefore = sendChatRequest.mock.calls.filter((c) => (c[0] as ChatRequest).kind === 'session').length;
    await act(async () => {
      emit({ kind: 'chatSessionUpdate', projectHash: 'ph', sessionId: 'other' });
    });
    await act(async () => {});
    const sessionCallsAfter = sendChatRequest.mock.calls.filter((c) => (c[0] as ChatRequest).kind === 'session').length;
    expect(sessionCallsAfter).toBe(sessionCallsBefore); // 未触发重取（messages 请求）
    expect(api.current!.state.messages.map((m) => m.uuid)).toEqual(['m1']); // 右栏不变
  });
});

// ── 问题3a：未知会话推送去抖回取 + 同步完成边沿回取（防风暴） ──
describe('问题3a 未知会话推送 → 去抖首页回取（§7.2）', () => {
  test('常量 === 800', () => {
    expect(CHAT_UNKNOWN_REFETCH_DEBOUNCE_MS).toBe(800);
  });

  test('未知 sessionId 推送×3 → 800ms 后恰一次首页回取（去抖合并）', async () => {
    const { deps, sendChatRequest, emit } = makeDeps();
    await mount(deps);
    const before = kindCalls(sendChatRequest, 'sessions').length;
    await act(async () => {
      emit({ kind: 'chatSessionUpdate', projectHash: 'ph', sessionId: 'newX' });
      emit({ kind: 'chatSessionUpdate', projectHash: 'ph', sessionId: 'newX' });
      emit({ kind: 'chatSessionUpdate', projectHash: 'ph', sessionId: 'newX' });
    });
    await act(async () => { vi.advanceTimersByTime(799); });
    expect(kindCalls(sendChatRequest, 'sessions').length).toBe(before); // 未越过去抖窗
    await act(async () => { vi.advanceTimersByTime(1); });
    await act(async () => {}); // 冲回取 promise
    expect(kindCalls(sendChatRequest, 'sessions').length).toBe(before + 1); // 恰一次
  });

  test('已知非当前会话推送 → 只 bump 排序，零首页回取', async () => {
    const { deps, sendChatRequest, emit } = makeDeps([sess('known')]);
    await mount(deps);
    const before = kindCalls(sendChatRequest, 'sessions').length;
    await act(async () => {
      emit({ kind: 'chatSessionUpdate', projectHash: 'ph', sessionId: 'known' });
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => {});
    expect(kindCalls(sendChatRequest, 'sessions').length).toBe(before); // 零新增 sessions 请求
  });
});

describe('问题3a 同步完成边沿回取（syncing→idle）', () => {
  test('边沿（首扫期空列表）→ 恰一对 projects+sessions 回取', async () => {
    const { deps, sendChatRequest, emit } = makeDeps();
    await mount(deps);
    const pBefore = kindCalls(sendChatRequest, 'projects').length;
    const sBefore = kindCalls(sendChatRequest, 'sessions').length;
    await act(async () => { emit({ kind: 'chatSyncStatus', status: 'syncing', lastSyncMs: undefined }); });
    await act(async () => { emit({ kind: 'chatSyncStatus', status: 'idle', lastSyncMs: 1 }); });
    await act(async () => {}); // 冲回取 promise
    expect(kindCalls(sendChatRequest, 'projects').length).toBe(pBefore + 1);
    expect(kindCalls(sendChatRequest, 'sessions').length).toBe(sBefore + 1);
  });

  test('稳态 idle 反复裸帧 → 不回取（无 epoch 循环）', async () => {
    const { deps, sendChatRequest, emit } = makeDeps();
    await mount(deps);
    const pBefore = kindCalls(sendChatRequest, 'projects').length;
    const sBefore = kindCalls(sendChatRequest, 'sessions').length;
    for (let i = 0; i < 3; i++) {
      await act(async () => { emit({ kind: 'chatSyncStatus', status: 'idle', lastSyncMs: i }); });
    }
    await act(async () => {});
    expect(kindCalls(sendChatRequest, 'projects').length).toBe(pBefore);
    expect(kindCalls(sendChatRequest, 'sessions').length).toBe(sBefore);
  });
});
