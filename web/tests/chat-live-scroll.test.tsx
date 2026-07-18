// @vitest-environment jsdom
//
// 右栏滚动行为（chat-history.md §7.2 auto-scroll / §7.3 prepend 补偿；批5 A5-2）。
// 断言面 = 真实工件 ChatHistoryScreen 的 MessageScrollController（仅 live 路径挂载）。jsdom 无布局引擎 →
// 滚动几何（scrollHeight/clientHeight/scrollTop）经 prototype 注入受控值，断言命令式 scrollTop 结果。
// 非 spec.json 用例（REQ-CHAT_BROWSE-029/§7.3 不在 CHAT_L1 桶）——行为测试，与 chat-live-debounce 同类。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { ChatHistoryScreen } from '../src/screen/chat/ChatHistoryScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 无 IntersectionObserver：触底/触顶哨兵 effect 会 new 它 → 空壳 polyfill（本关不测哨兵几何）。
class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;

// ── 受控滚动几何（prototype 覆盖；jsdom 默认全返 0，注入后可断言命令式滚动） ──
let SH = 0; // scrollHeight
let CH = 0; // clientHeight
let top = 0; // scrollTop（get/set 共享，测试内单一 scroller）
const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  for (const name of ['scrollHeight', 'clientHeight', 'scrollTop'] as const) {
    saved[name] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => SH });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => CH });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
});
afterAll(() => {
  for (const name of ['scrollHeight', 'clientHeight', 'scrollTop'] as const) {
    if (saved[name]) Object.defineProperty(HTMLElement.prototype, name, saved[name]!);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});
beforeEach(() => {
  SH = 0;
  CH = 0;
  top = 0;
});

// ── 挂载胶水 ──
let container: HTMLElement | null = null;
let root: Root | null = null;
async function render(el: React.ReactElement): Promise<void> {
  if (!root) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    container = host;
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(el);
  });
  await act(async () => {});
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function liveBundle(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    onSelectProject: () => {},
    onSelectSession: () => {},
    onDoubleClickSession: () => {},
    onBack: () => {},
    onSearchInput: () => {},
    onLoadMoreSessions: () => {},
    onLoadEarlierMessages: () => {},
    onResume: () => {},
    onClose: () => {},
    onDismissBanner: () => {},
    onLearnMore: () => {},
    searchState: 'EmptySearch',
    canResume: false,
    hasEarlierMessages: false,
    sessionsLoadingMore: false,
    messagesLoadingMore: false,
    projectsLoading: false,
    sessionsLoading: false,
    syncStatus: 'idle',
    lastSyncMs: null,
    noCC: false,
    bannerText: '',
    ...over,
  };
}

const msg = (uuid: string) => ({
  uuid,
  type: 'user' as const,
  sessionId: 's1',
  cwd: '/x',
  timestamp: '2026-06-01T00:00:00.000Z',
  content: uuid,
});

function fxLive(messages: ReturnType<typeof msg>[], liveOver: Record<string, unknown> = {}) {
  return {
    id: 'scroll',
    theme: 'dark',
    screen: 'chat-history',
    chat: {
      banner: false,
      selected: 's1',
      search: null,
      projects: [
        { projectHash: 'h1', displayPath: '/x', displayName: 'x', sessionCount: 1, totalSize: 1, lastActivity: '2026-06-01T00:00:00.000Z' },
      ],
      sessions: [
        { sessionId: 's1', projectHash: 'h1', title: 't', startedAt: '2026-06-01T00:00:00.000Z', lastModified: '2026-06-01T00:00:00.000Z', fileSize: 1, source: 'claude-code', cwd: '/x' },
      ],
      messages,
    },
    live: liveBundle(liveOver),
  };
}

const scroller = (): HTMLElement => {
  const el = container!.querySelector('.session-detail__scroller');
  if (!el) throw new Error('scroller 未渲染');
  return el as HTMLElement;
};

// ── §7.2 auto-scroll（REQ-CHAT_BROWSE-029）：贴底追加自动滚底 / 上翻阅历史不打断 ──

test('§7.2 尾部追加：贴底则自动滚到底，用户上翻阅历史则不拉底', async () => {
  SH = 1000;
  CH = 200;

  // 初次载入：贴底显示最新（首屏最近 50，REQ-CHAT_BROWSE-018）。
  await render(createElement(ChatHistoryScreen, { fx: fxLive([msg('m1'), msg('m2'), msg('m3')]) }));
  expect(top).toBe(1000); // scrollTop = scrollHeight（贴底）

  // 用户仍在底部 → 尾部追加 m4：自动滚到新底。
  SH = 1200;
  await render(createElement(ChatHistoryScreen, { fx: fxLive([msg('m1'), msg('m2'), msg('m3'), msg('m4')]) }));
  expect(top).toBe(1200);

  // 用户上翻阅历史（滚到顶）→ scroll 事件把「贴底」态置 false。
  top = 0;
  await act(async () => {
    scroller().dispatchEvent(new Event('scroll'));
  });

  // 再来一条尾部追加 m5：非贴底 → 追加但不拉底（异常分支），scrollTop 保持用户位置。
  SH = 1400;
  await render(createElement(ChatHistoryScreen, { fx: fxLive([msg('m1'), msg('m2'), msg('m3'), msg('m4'), msg('m5')]) }));
  expect(top).toBe(0);
});

// ── §7.3 prepend 滚动补偿：向上补更早消息，视口锚点不跳 ──

test('§7.3 向上 prepend 更早消息：scrollTop 补偿上方新增高度（锚点不跳）', async () => {
  SH = 1000;
  CH = 200;

  // 初次载入（可继续上翻）。
  await render(createElement(ChatHistoryScreen, { fx: fxLive([msg('m3'), msg('m4'), msg('m5')], { hasEarlierMessages: true }) }));

  // 用户滚到顶部触发向上加载（scrollTop 归 0）。
  top = 0;

  // 向上补 3 条更早消息：内容在锚点之上增高 500（1000 → 1500）。
  SH = 1500;
  await render(
    createElement(ChatHistoryScreen, {
      fx: fxLive([msg('m0'), msg('m1'), msg('m2'), msg('m3'), msg('m4'), msg('m5')], { hasEarlierMessages: true }),
    }),
  );

  // 补偿：scrollTop += (newSH - prevSH) = 0 + (1500 - 1000) = 500 → 原锚点（m3）仍在同一视口位置。
  expect(top).toBe(500);
});

// ── 加性纪律：golden/静态路径（无 fx.live）不挂控制器 → 不做任何命令式滚动 ──

test('无 fx.live（静态/golden 路径）：不触发任何 scrollTop 写入', async () => {
  SH = 1000;
  CH = 200;
  top = 42; // 预置一个「未被改写」的哨兵值

  await render(
    createElement(ChatHistoryScreen, {
      fx: {
        id: 'static',
        theme: 'dark',
        screen: 'chat-history',
        chat: fxLive([msg('m1'), msg('m2'), msg('m3')]).chat, // 有选中会话 + 消息，但无 live
      },
    }),
  );

  expect(top).toBe(42); // 控制器未挂载 → scrollTop 原样
});
