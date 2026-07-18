// @vitest-environment jsdom
//
// chatTitleUpdate 推送消费（chat-history.md §7.2 title-update，title-sync 批 W8 强绑定）：
// native ChatCustomTitlesStore 真变化推 `{sessionId, title?}` → 定向 patch 中栏该卡 customTitle
// （保活面板不重挂载也跟随）。断言面 = 真实工件 useChatData.ts（ChatHistoryLive 消费的同一 hook）。
// 样板照 chat-live-debounce.test.tsx（推送经 makeDeps.emit 注入 subscribeDataEvent handler）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  ChatRequest,
  ChatResponse,
  ChatSessionView,
  DataEvent,
} from '../src/bridge/gen/protocol';
import { useChatData, type ChatDataApi, type UseChatDataDeps } from '../src/screen/chat/live/useChatData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sess(sessionId: string, customTitle?: string): ChatSessionView {
  return { sessionId, projectHash: 'ph', title: `首条消息-${sessionId}`, startedAtMs: 0, lastModifiedMs: 1000, fileSize: 0, customTitle };
}

function makeDeps(initialSessions: ChatSessionView[] = []) {
  let handler: ((e: DataEvent) => void) | null = null;
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: initialSessions.slice() });
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
  return { deps, sendChatRequest, emit: (e: DataEvent) => handler?.(e) };
}

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

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('chatTitleUpdate 推送 → 定向 patch customTitle（§7.2 title-update）', () => {
  test('已知会话：title 到达 → 本卡 customTitle 更新，其余卡不动', async () => {
    const { deps, emit } = makeDeps([sess('s1'), sess('s2', '旧名')]);
    const api = await mount(deps);
    await act(async () => {
      emit({ kind: 'chatTitleUpdate', sessionId: 's1', title: '终端命名A' });
    });
    const byId = Object.fromEntries(api.current!.state.sessions.map((x) => [x.sessionId, x]));
    expect(byId['s1'].customTitle).toBe('终端命名A');
    expect(byId['s1'].title).toBe('首条消息-s1'); // 裸 title 不动（显示层 customTitle||title）
    expect(byId['s2'].customTitle).toBe('旧名');
  });

  test('改名 A→B：后到推送覆盖（强绑定跟随最新值）', async () => {
    const { deps, emit } = makeDeps([sess('s1')]);
    const api = await mount(deps);
    await act(async () => {
      emit({ kind: 'chatTitleUpdate', sessionId: 's1', title: 'A' });
      emit({ kind: 'chatTitleUpdate', sessionId: 's1', title: 'B' });
    });
    expect(api.current!.state.sessions[0].customTitle).toBe('B');
  });

  test('title 缺席 = 已清除：customTitle 归 undefined（显示回落首条消息 title）', async () => {
    const { deps, emit } = makeDeps([sess('s1', '要清掉的名')]);
    const api = await mount(deps);
    await act(async () => {
      emit({ kind: 'chatTitleUpdate', sessionId: 's1' });
    });
    expect(api.current!.state.sessions[0].customTitle).toBeUndefined();
  });

  test('未知 sessionId：忽略（不改列表、不触发回取——区别于 chatSessionUpdate 未知分支）', async () => {
    const { deps, emit, sendChatRequest } = makeDeps([sess('s1')]);
    const api = await mount(deps);
    const before = api.current!.state.sessions;
    const callsBefore = sendChatRequest.mock.calls.length;
    await act(async () => {
      emit({ kind: 'chatTitleUpdate', sessionId: 'ghost', title: 'x' });
    });
    expect(api.current!.state.sessions).toBe(before); // reducer 未知 sid 原样返回（引用相等）
    expect(sendChatRequest.mock.calls.length).toBe(callsBefore); // 零回取
  });
});
