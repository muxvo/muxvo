// @vitest-environment jsdom
//
// 问题3b 历史聊天面板保活：active 门控 Esc（隐藏期终端里按 Esc 不误发 chatClose——唯一真雷）+ 隐藏瞬间清
// 瞬态 overlay（右键菜单）+ 组件不卸载浏览态保持。断言面 = 真实工件 ChatHistoryChrome/ChatHistoryLive/
// useChatData（createRoot + act 真挂载，active prop 由 main.tsx 保活容器透传）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatHistoryChrome } from '../src/screen/chat/live/ChatHistoryChrome';
import type { BridgeApi } from '../src/bridge/client';
import type { Fixture } from '../src/fixture/types';
import type {
  ChatRequest,
  ChatResponse,
  ChatSessionView,
  ConfigRequest,
  ConfigResponse,
  ConfigSnapshot,
  DataEvent,
} from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// track() 经动态 import client 单例取桥：mock currentBridge 供 telemetry 断言，默认 null（其余用例 no-op）。
const { telemetryBridgeMock } = vi.hoisted(() => ({
  telemetryBridgeMock: vi.fn((): unknown => null),
}));
vi.mock('../src/bridge/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/bridge/client')>();
  return { ...orig, currentBridge: () => telemetryBridgeMock() };
});

class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;

let container: HTMLElement | null = null;
let root: Root | null = null;
async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => {
    r.render(element);
  });
  await act(async () => {});
  return el;
}
async function rerender(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root!.render(element);
  });
  await act(async () => {});
}
async function pressEscape(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  const g = globalThis as unknown as {
    ResizeObserver: unknown;
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame: (id: number) => void;
  };
  g.ResizeObserver = RO;
  g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function fullSnapshot(): ConfigSnapshot {
  return {
    startupTerminalCount: 1,
    doubleClickToFocus: false,
    dockBadgeMode: 'off',
    dockBadgeIntervalMin: 5,
    defaultTerminalCwd: '',
    showHiddenFiles: false,
    language: 'zh',
    theme: 'dark',
    terminalThemeName: 'default',
    fontSize: 13,
    gridLayout: { columnRatios: [1], rowRatios: [1] },
    ftvLeftWidth: 200,
    ftvRightWidth: 200,
    archiveEnabled: true,
    tourCompleted: false,
  };
}

function sess(sessionId: string): ChatSessionView {
  return { sessionId, projectHash: 'ph', title: sessionId, startedAtMs: 0, lastModifiedMs: 1000, fileSize: 10 };
}

function makeBridge(sessions: ChatSessionView[] = []) {
  const sendAction = vi.fn();
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: sessions.slice() });
      case 'session':
        return Promise.resolve({ kind: 'messages', messages: [] });
      case 'search':
        return Promise.resolve({ kind: 'search', results: [] });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((_h: (e: DataEvent) => void) => () => {});
  const sendConfigRequest = vi.fn((req: ConfigRequest): Promise<ConfigResponse> =>
    req.kind === 'get' || req.kind === 'set'
      ? Promise.resolve({ kind: 'snapshot', config: fullSnapshot() })
      : Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' }),
  );
  const sendAppRequest = vi.fn(() => Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' }));
  const bridge = { sendAction, sendChatRequest, subscribeDataEvent, sendConfigRequest, sendAppRequest } as unknown as BridgeApi;
  return { bridge, sendAction };
}

function chromeFx(): Fixture {
  return { id: 'keepalive', theme: 'dark', terminals: [] } as unknown as Fixture;
}
const chatCloseCalls = (spy: ReturnType<typeof vi.fn>): unknown[] =>
  spy.mock.calls.filter((c) => (c[0] as { kind?: string })?.kind === 'chatClose');

describe('问题3b Esc 门控（隐藏期不误发 chatClose——唯一真雷）', () => {
  test('active=true → Esc 发 chatClose', async () => {
    const { bridge, sendAction } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    await pressEscape();
    expect(chatCloseCalls(sendAction)).toHaveLength(1);
  });

  test('active=false（隐藏保活）→ Esc 不发 chatClose', async () => {
    const { bridge, sendAction } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: false }));
    await pressEscape();
    expect(chatCloseCalls(sendAction)).toHaveLength(0);
  });

  test('active 翻转重臂：显→隐→显，仅两次可见期各发一次', async () => {
    const { bridge, sendAction } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    await pressEscape(); // 可见：发
    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: false }));
    await pressEscape(); // 隐藏：不发
    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    await pressEscape(); // 复现：再发
    expect(chatCloseCalls(sendAction)).toHaveLength(2);
  });
});

describe('问题3b 保活：组件不卸载 + 浏览态保持 + 隐藏清瞬态', () => {
  test('显→隐→显：overlay 同一 DOM 节点（未卸载）+ 会话卡仍在（state 保持）', async () => {
    const { bridge } = makeBridge([sess('s1'), sess('s2')]);
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    const overlayBefore = container!.querySelector('.chat-history-overlay');
    const cardsBefore = container!.querySelectorAll('.session-card').length;
    expect(overlayBefore).not.toBeNull();
    expect(cardsBefore).toBe(2);

    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: false }));
    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));

    const overlayAfter = container!.querySelector('.chat-history-overlay');
    expect(overlayAfter).toBe(overlayBefore); // 同一节点 → 组件未卸载重挂
    expect(container!.querySelectorAll('.session-card').length).toBe(2); // sessions 态保持（未丢）
  });

  test('隐藏（active→false）清瞬态右键菜单', async () => {
    const { bridge } = makeBridge([sess('s1')]);
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    const card = container!.querySelector('.session-card');
    expect(card).not.toBeNull();
    await act(async () => {
      card!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(container!.querySelector('.session-context-menu'), '右键菜单已弹出').not.toBeNull();

    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: false }));
    expect(container!.querySelector('.session-context-menu'), '隐藏时菜单被清').toBeNull();
  });
});

describe('埋点 chat.searched per-open 语义（analytics.md L4；对抗 M-1 回修——保活面板 active 重开须复位）', () => {
  async function setQuery(value: string): Promise<void> {
    const input = container!.querySelector('.search-input-wrap__input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await vi.dynamicImportSettled();
  }

  test('首搜发一次、同开重搜不重发、隐→显重开后再搜再发', async () => {
    const sendTelemetry = vi.fn();
    telemetryBridgeMock.mockReturnValue({ sendTelemetry });
    const { bridge } = makeBridge();
    const searched = (): number =>
      sendTelemetry.mock.calls.filter((c) => (c[0] as { metric?: string })?.metric === 'chat.searched').length;

    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    await setQuery('foo');
    expect(searched()).toBe(1);
    await setQuery('foobar'); // 同一次打开继续输入 → 不重发
    expect(searched()).toBe(1);

    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: false })); // 隐藏（保活不卸载）
    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true })); // 重开
    await setQuery('baz');
    expect(searched()).toBe(2); // 修前此处 =1（ref 永不复位，M-1）

    telemetryBridgeMock.mockReturnValue(null);
  });
});
