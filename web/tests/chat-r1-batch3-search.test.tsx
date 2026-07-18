// @vitest-environment jsdom
//
// M5-R1 批3 Agent B（W6 搜索命中导航全链 / W7 内容匹配点开定位 / W10 回到顶部）。
// 断言面 = 真实工件：matchNav 纯函数、真 ChatHistoryScreen 的 MatchNavController/BackToTopControl/
// 搜索徽记（fx.live 直挂 dom-assert）、真 ChatHistoryLive+useChatData 的 W7 全量加载链。
// 加性纪律：live 交互走 fx.live，静态/golden 路径 fx.live 缺席 → data-msg-idx/nav 徽记零 DOM，6 golden 无感。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatHistoryScreen } from '../src/screen/chat/ChatHistoryScreen';
import { ChatHistoryLive } from '../src/screen/chat/live/ChatHistoryLive';
import { clampIdx, enumerateMatches, highlightHtml, matchKey } from '../src/screen/chat/live/matchNav';
import { chatReducer, initialChatState, sameSelection } from '../src/screen/chat/live/useChatData';
import type { BridgeApi } from '../src/bridge/client';
import type { Fixture } from '../src/fixture/types';
import type {
  ChatMessageView,
  ChatProjectView,
  ChatRequest,
  ChatResponse,
  ChatSearchHit,
  ChatSessionView,
  DataEvent,
} from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 无 IntersectionObserver / scrollIntoView：哨兵 effect + 命中滚动需要空壳。
class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;

// ── 受控滚动几何（BackToTopControl 可见性阈值 + 命令式滚动断言；jsdom 默认全 0）──
let SH = 0;
let CH = 0;
let top = 0;
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
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {};
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
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  await act(async () => {
    root!.render(el);
  });
  await act(async () => {});
  return host;
}
async function rerender(el: React.ReactElement): Promise<void> {
  await act(async () => {
    root!.render(el);
  });
  await act(async () => {});
}
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════
// Part A — matchNav 纯函数（枚举 / 钳制 / matchKey / highlightHtml）
// ════════════════════════════════════════════════════════════════════════

describe('W6 matchNav.enumerateMatches', () => {
  test('string content：逐次出现单独成命中（大小写不敏感、非重叠）', () => {
    const m = enumerateMatches([{ content: 'Foo foo FOO' }], 'foo');
    expect(m).toEqual([
      { msgIdx: 0, nthInMsg: 0 },
      { msgIdx: 0, nthInMsg: 1 },
      { msgIdx: 0, nthInMsg: 2 },
    ]);
  });

  test('blocks：text 块按序 join(\\n) 后枚举；工具块不计入', () => {
    const m = enumerateMatches(
      [
        {
          content: [
            { type: 'text', text: 'alpha foo' },
            { type: 'tool_use', text: 'foo foo foo' }, // 工具块：不计（即便带 text 字段）
            { type: 'text', text: 'foo bar foo' },
          ],
        },
      ],
      'foo',
    );
    // 'alpha foo' + '\n' + 'foo bar foo' → 3 处（工具块 3 处不计）
    expect(m).toEqual([
      { msgIdx: 0, nthInMsg: 0 },
      { msgIdx: 0, nthInMsg: 1 },
      { msgIdx: 0, nthInMsg: 2 },
    ]);
  });

  test('多条消息：msgIdx 递增、每条内 nth 从 0 重数', () => {
    const m = enumerateMatches([{ content: 'foo' }, { content: 'x' }, { content: 'foo foo' }], 'foo');
    expect(m).toEqual([
      { msgIdx: 0, nthInMsg: 0 },
      { msgIdx: 2, nthInMsg: 0 },
      { msgIdx: 2, nthInMsg: 1 },
    ]);
  });

  test('空 query → 无命中', () => {
    expect(enumerateMatches([{ content: 'foo' }], '')).toEqual([]);
  });
});

describe('W6 matchNav.clampIdx（不循环）', () => {
  test('越上界夹到 total-1、越下界夹到 0、total≤0 归 0', () => {
    expect(clampIdx(5, 3)).toBe(2);
    expect(clampIdx(-1, 3)).toBe(0);
    expect(clampIdx(1, 3)).toBe(1);
    expect(clampIdx(0, 0)).toBe(0);
    expect(clampIdx(2, 0)).toBe(0);
  });
});

describe('W6 matchNav.matchKey', () => {
  test('会话或 query 变即变，同参稳定', () => {
    expect(matchKey('s1', 'foo')).toBe(matchKey('s1', 'foo'));
    expect(matchKey('s1', 'foo')).not.toBe(matchKey('s1', 'bar'));
    expect(matchKey('s1', 'foo')).not.toBe(matchKey('s2', 'foo'));
    expect(matchKey(null, 'foo')).toBe(matchKey(null, 'foo'));
  });
});

describe('W6 matchNav.highlightHtml（只改文本节点 / 无注入）', () => {
  test('文本节点命中包 <mark class="search-highlight">', () => {
    expect(highlightHtml('<p>foo bar</p>', 'foo')).toBe('<p><mark class="search-highlight">foo</mark> bar</p>');
  });

  test('不动标签属性：title="foo" 不被标记，仅正文 foo 标记（恰一 mark）', () => {
    const out = highlightHtml('<a title="foo">foo</a>', 'foo');
    expect(out).toContain('title="foo"'); // 属性原样
    expect(out).toContain('<mark class="search-highlight">foo</mark>');
    expect(out.match(/<mark/g)?.length).toBe(1); // 属性内的 foo 未被标
  });

  test('<code> 内命中同样标记', () => {
    expect(highlightHtml('<code>foo</code>', 'foo')).toBe('<code><mark class="search-highlight">foo</mark></code>');
  });

  test('无注入面：query 含 HTML/正则特殊字符时只作字面匹配，不破结构', () => {
    expect(highlightHtml('<p>x</p>', '<img src=x onerror=alert(1)>')).toBe('<p>x</p>');
    expect(highlightHtml('<p>a.b</p>', '.')).toBe('<p>a<mark class="search-highlight">.</mark>b</p>'); // 正则转义
    expect(highlightHtml('<p>foo</p>', '')).toBe('<p>foo</p>'); // 空 query 原样
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part B — 命中导航 dom-assert（真 ChatHistoryScreen + fx.live 直挂）
// ════════════════════════════════════════════════════════════════════════

function liveBundle(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    onSelectProject: () => {},
    onSelectSession: () => {},
    onDoubleClickSession: () => {},
    onBack: () => {},
    onSearchInput: () => {},
    onLoadMoreSessions: () => {},
    onLoadEarlierMessages: () => {},
    onLoadAllMessages: () => {},
    onResume: () => {},
    onClose: () => {},
    onDismissBanner: () => {},
    onLearnMore: () => {},
    searchState: 'HasResults',
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

const smsg = (uuid: string, content: string, type: 'user' | 'assistant' | 'system' = 'user') => ({
  uuid,
  type,
  sessionId: 's1',
  cwd: '/x',
  timestamp: '2026-06-01T00:00:00.000Z',
  content,
});

function fxSearch(
  messages: ReturnType<typeof smsg>[],
  query: string,
  opts: { live?: boolean; over?: Record<string, unknown> } = {},
) {
  const withLive = opts.live ?? true;
  const chat = {
    banner: false,
    selected: 's1',
    search: {
      query,
      results: [{ projectHash: 'h1', sessionId: 's1', snippet: 'hit', timestamp: '2026-06-01T00:00:00.000Z' }],
    },
    projects: [
      { projectHash: 'h1', displayPath: '/x', displayName: 'x', sessionCount: 1, totalSize: 1, lastActivity: '2026-06-01T00:00:00.000Z' },
    ],
    sessions: [
      { sessionId: 's1', projectHash: 'h1', title: 'session title', startedAt: '2026-06-01T00:00:00.000Z', lastModified: '2026-06-01T00:00:00.000Z', fileSize: 1, source: 'claude-code', cwd: '/x' },
    ],
    messages,
  };
  return withLive
    ? { id: 'search', theme: 'dark', screen: 'chat-history', chat, live: liveBundle(opts.over) }
    : { id: 'search', theme: 'dark', screen: 'chat-history', chat };
}

const navBadge = (): string => container!.querySelector('.search-input-wrap__nav-count')?.textContent ?? '';
const navBtns = (): HTMLButtonElement[] => [...container!.querySelectorAll('.search-input-wrap__nav-btn')] as HTMLButtonElement[];
const activeMark = (): HTMLElement | null => container!.querySelector('mark.search-highlight--active');
const activeBubbleIdx = (): string | null => activeMark()?.closest('[data-msg-idx]')?.getAttribute('data-msg-idx') ?? null;
async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('W6 命中导航徽记 + 高亮切换（dom-assert）', () => {
  const three = () => fxSearch([smsg('m0', 'alpha foo beta'), smsg('m1', 'foo foo')], 'foo');

  test('徽记 {cur}/{total} + ▲▼ 禁用态 + 首命中 active', async () => {
    await mount(createElement(ChatHistoryScreen, { fx: three() }));
    // 3 处命中：m0 一处 + m1 两处；DOM mark 数=枚举数。
    expect(container!.querySelectorAll('mark.search-highlight').length).toBe(3);
    expect(navBadge()).toBe('1/3');
    const [prev, next] = navBtns();
    expect(prev.disabled, '首命中 ▲ 禁用').toBe(true);
    expect(next.disabled, '非末命中 ▼ 可用').toBe(false);
    // idx0 → active 落 m0 的第 0 个 mark
    expect(container!.querySelectorAll('mark.search-highlight--active').length).toBe(1);
    expect(activeBubbleIdx()).toBe('0');
    expect(activeMark()!.textContent).toBe('foo');
  });

  test('▼ 前进：徽记 + active 随之切换（只保留一个 active，末命中 ▼ 禁用）', async () => {
    await mount(createElement(ChatHistoryScreen, { fx: three() }));
    await click(navBtns()[1]); // ▼ → 2/3（m1 第 0 个）
    expect(navBadge()).toBe('2/3');
    expect(activeBubbleIdx()).toBe('1');
    expect(container!.querySelectorAll('mark.search-highlight--active').length).toBe(1);

    await click(navBtns()[1]); // ▼ → 3/3（m1 第 1 个）
    expect(navBadge()).toBe('3/3');
    expect(activeBubbleIdx()).toBe('1');
    expect(navBtns()[1].disabled, '末命中 ▼ 禁用').toBe(true);
    expect(navBtns()[0].disabled, '非首命中 ▲ 可用').toBe(false);

    await click(navBtns()[0]); // ▲ → 2/3
    expect(navBadge()).toBe('2/3');
  });

  test('输入框 Enter=下一处 / Shift+Enter=上一处', async () => {
    await mount(createElement(ChatHistoryScreen, { fx: three() }));
    const input = container!.querySelector('.search-input-wrap__input')!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(navBadge()).toBe('2/3');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    });
    expect(navBadge()).toBe('1/3');
  });

  test('改词重置 idx=0（matchKey 变，R1.19）', async () => {
    await mount(createElement(ChatHistoryScreen, { fx: three() }));
    await click(navBtns()[1]);
    await click(navBtns()[1]); // 到 3/3
    expect(navBadge()).toBe('3/3');
    // 改词 'beta'（m0 一处）→ 徽记回 1/1
    await rerender(createElement(ChatHistoryScreen, { fx: fxSearch([smsg('m0', 'alpha foo beta'), smsg('m1', 'foo foo')], 'beta') }));
    expect(navBadge()).toBe('1/1');
    expect(activeBubbleIdx()).toBe('0');
  });

  test('total=0（详情打开但会话无内容命中）→ 徽记 0/0，▲▼ 均禁用', async () => {
    await mount(createElement(ChatHistoryScreen, { fx: fxSearch([smsg('m0', 'nothing here')], 'zzz') }));
    expect(navBadge()).toBe('0/0');
    expect(navBtns()[0].disabled).toBe(true);
    expect(navBtns()[1].disabled).toBe(true);
  });

  test('静态/golden 路径（无 fx.live）：无 data-msg-idx、无 nav 徽记、正文无 mark', async () => {
    await mount(createElement(ChatHistoryScreen, { fx: fxSearch([smsg('m0', 'alpha foo')], 'foo', { live: false }) }));
    expect(container!.querySelector('[data-msg-idx]'), '静态不产 data-msg-idx').toBeNull();
    expect(container!.querySelector('.search-input-wrap__nav'), '静态不产 nav 徽记').toBeNull();
    expect(container!.querySelector('mark.search-highlight'), '静态正文不高亮').toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part C — W7 搜索态全量加载 + 内容匹配点开定位全链（真 ChatHistoryLive + useChatData）
// ════════════════════════════════════════════════════════════════════════

const MS = 1717243200000;

function makeBridge(opts: {
  projects?: ChatProjectView[];
  sessions?: ChatSessionView[];
  firstPage?: ChatMessageView[];
  firstPrevCursor?: string;
  allMessages?: ChatMessageView[];
  searchResults?: ChatSearchHit[];
  allRejected?: boolean; // V-1：all:true 一律 rejected（模拟持续失败）
}) {
  const calls: ChatRequest[] = [];
  const sendAction = vi.fn();
  let dataHandler: ((e: DataEvent) => void) | null = null;
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    calls.push(req);
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: opts.projects ?? [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: opts.sessions ?? [] });
      case 'session':
        // all:true → 全量（无 prevCursor → hasEarlier=false）；否则首屏带 prevCursor（hasEarlier=true）。
        // allRejected 走 setTimeout 延时落地：让 loadingMore=true 真实提交一帧（同 tick 微任务会被 React
        // 批处理吞掉 true 态 → effect 不重跑 → 风暴复现不出来，测试失去判别力）。
        return req.all
          ? opts.allRejected
            ? new Promise<ChatResponse>((res) => {
                setTimeout(() => res({ kind: 'rejected', code: 'x', message: 'x' }), 10);
              })
            : Promise.resolve({ kind: 'messages', messages: opts.allMessages ?? opts.firstPage ?? [] })
          : Promise.resolve({ kind: 'messages', messages: opts.firstPage ?? [], prevCursor: opts.firstPrevCursor });
      case 'search':
        return Promise.resolve({ kind: 'search', results: opts.searchResults ?? [] });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((h: (e: DataEvent) => void) => {
    dataHandler = h;
    return () => {
      dataHandler = null;
    };
  });
  const bridge = { sendAction, sendChatRequest, subscribeDataEvent } as unknown as BridgeApi;
  return { bridge, calls, sendChatRequest, emit: (e: DataEvent) => dataHandler?.(e) };
}

function liveFx(): Fixture {
  return { id: 'w7', theme: 'dark', terminals: [] } as unknown as Fixture;
}

function setQuery(value: string): Promise<void> {
  const input = container!.querySelector('.search-input-wrap__input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  return act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await flush();
}

describe('W7 搜索态全量加载（R1.7）+ 自止', () => {
  test('已选会话 + hasEarlier + 转搜索态 → 发 session all:true 全量；hasEarlier 落 false 后不再发', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge, calls } = makeBridge({
      sessions: [{ sessionId: 's1', projectHash: 'ph', title: 't', startedAtMs: MS, lastModifiedMs: MS, fileSize: 1, source: 'claudeCode', cwd: '/w' }],
      firstPage: [{ uuid: 'm5', sessionId: 's1', role: 'user', cwd: '/w', tsMs: MS, text: 'recent' }],
      firstPrevCursor: 'p1', // 首屏 hasEarlier=true
      allMessages: [
        { uuid: 'm0', sessionId: 's1', role: 'user', cwd: '/w', tsMs: MS - 2, text: 'old' },
        { uuid: 'm5', sessionId: 's1', role: 'user', cwd: '/w', tsMs: MS, text: 'recent' },
      ],
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    // 选中会话（plain 列表）→ 首屏加载（hasEarlier=true）。
    for (let i = 0; i < 12; i++) {
      await flush();
      if (container!.querySelector('.session-card')) break;
    }
    await act(async () => {
      container!.querySelector('.session-card')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(220));
    await settle();
    const allBefore = calls.filter((c) => c.kind === 'session' && (c as { all?: boolean }).all).length;
    expect(allBefore, '搜索前不发 all:true').toBe(0);

    // 转搜索态（W7 effect 触发全量）。
    await setQuery('old');
    await settle();
    const allAfter = calls.filter((c) => c.kind === 'session' && (c as { all?: boolean }).all).length;
    expect(allAfter, '搜索态发一次 all:true 全量').toBe(1);

    // 自止：hasEarlier 落 false（all 全量无 prevCursor）后，再冲刷不重复发。
    await settle();
    const allFinal = calls.filter((c) => c.kind === 'session' && (c as { all?: boolean }).all).length;
    expect(allFinal, 'hasEarlier 落 false 后自止').toBe(1);
  });

  test('W7 全链：搜索态内容匹配占位卡点开 → session 请求 → all:true 全量（缺陷3 占位卡可开 + W7 全量）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // 占位卡：s2 不在 sessions（未加载），仅由 search 命中合成 → 缺陷3 可点开。
    const { bridge, calls } = makeBridge({
      sessions: [],
      searchResults: [{ projectHash: 'ph2', sessionId: 's2', snippet: 'placeholder hit old', tsMs: MS }],
      firstPage: [{ uuid: 'n9', sessionId: 's2', role: 'user', cwd: '/w2', tsMs: MS, text: 'recent' }],
      firstPrevCursor: 'p9',
      allMessages: [{ uuid: 'n0', sessionId: 's2', role: 'user', cwd: '/w2', tsMs: MS - 1, text: 'old' }],
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await settle();
    // 转搜索态 → 内容匹配占位卡出现。
    await setQuery('old');
    await act(async () => vi.advanceTimersByTime(300)); // 搜索去抖
    await settle();
    const card = container!.querySelector('.session-card');
    expect(card, '内容匹配占位卡渲染').not.toBeNull();
    // 点开占位卡 → 选中（缺陷3）→ session 首屏请求。
    await act(async () => card!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(220));
    await settle();
    expect(calls.some((c) => c.kind === 'session' && c.sessionId === 's2' && !(c as { all?: boolean }).all), '占位卡开 → session 首屏请求').toBe(true);
    // W7：hasEarlier=true + 搜索态 → all:true 全量定位。
    expect(calls.some((c) => c.kind === 'session' && c.sessionId === 's2' && (c as { all?: boolean }).all), '搜索态占位卡 → all:true 全量').toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part D — W10 回到顶部浮钮（R4.1）dom-assert
// ════════════════════════════════════════════════════════════════════════

const backBtn = (): HTMLButtonElement | null => container!.querySelector('.session-detail__back-to-top');

function fxDetail(over: Record<string, unknown> = {}) {
  return {
    id: 'bt',
    theme: 'dark',
    screen: 'chat-history',
    chat: {
      banner: false,
      selected: 's1',
      search: null,
      projects: [{ projectHash: 'h1', displayPath: '/x', displayName: 'x', sessionCount: 1, totalSize: 1, lastActivity: '2026-06-01T00:00:00.000Z' }],
      sessions: [{ sessionId: 's1', projectHash: 'h1', title: 't', startedAt: '2026-06-01T00:00:00.000Z', lastModified: '2026-06-01T00:00:00.000Z', fileSize: 1, source: 'claude-code', cwd: '/x' }],
      messages: [smsg('m0', 'a'), smsg('m1', 'b'), smsg('m2', 'c')],
    },
    live: liveBundle(over),
  };
}

describe('W10 回到顶部浮钮（R4.1）', () => {
  test('scrollTop ≤ 2×clientHeight → 不显；越阈 → 淡入', async () => {
    // 短会话：MessageScrollController 贴底后 scrollTop=scrollHeight=150 ≤ 200 → 不显。
    CH = 100;
    SH = 150;
    top = 0;
    await mount(createElement(ChatHistoryScreen, { fx: fxDetail() }));
    expect(backBtn(), '未越阈不显').toBeNull();

    // 长会话 + 用户离底上滚：250 > 200 → 显。
    SH = 1000;
    top = 250;
    await act(async () => {
      container!.querySelector('.session-detail__scroller')!.dispatchEvent(new Event('scroll'));
    });
    expect(backBtn(), '越阈淡入').not.toBeNull();
  });

  test('hasEarlier=false → 点击直接置顶（scrollTop=0）', async () => {
    CH = 100;
    SH = 1000;
    top = 300;
    await mount(createElement(ChatHistoryScreen, { fx: fxDetail({ hasEarlierMessages: false }) }));
    expect(backBtn()).not.toBeNull();
    await click(backBtn()!);
    expect(top, '直接置顶').toBe(0);
  });

  test('hasEarlier=true → 点击触发全量加载 + spinner 态；全量落地（hasEarlier→false）后置顶', async () => {
    const onLoadAll = vi.fn();
    // 长会话：控制器贴底 → top=scrollHeight=1000（越阈，浮钮显）。
    CH = 100;
    SH = 1000;
    top = 0;
    await mount(createElement(ChatHistoryScreen, { fx: fxDetail({ hasEarlierMessages: true, onLoadAllMessages: onLoadAll }) }));
    await click(backBtn()!);
    expect(onLoadAll, 'hasEarlier=true → 触发全量').toHaveBeenCalledTimes(1);
    expect(backBtn()!.classList.contains('session-detail__back-to-top--busy'), '等待期 spinner/busy 态').toBe(true);
    expect(top, '等待期未置顶（仍在控制器贴底值）').toBe(1000);

    // 模拟全量落地：hasEarlier→false + 消息增多。
    await rerender(
      createElement(ChatHistoryScreen, {
        fx: {
          ...fxDetail({ hasEarlierMessages: false }),
          chat: { ...fxDetail().chat, messages: [smsg('mA', 'x'), smsg('mB', 'y'), smsg('m0', 'a'), smsg('m1', 'b'), smsg('m2', 'c')] },
        },
      }),
    );
    expect(top, '全量落地后置顶').toBe(0);
    expect(backBtn(), '置顶后浮钮隐去').toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part E — 对抗回修（M-3 陈旧守卫 / M-4 非导航不重滚 / 幽灵卡）
// ════════════════════════════════════════════════════════════════════════

describe('对抗回修 M-3：loadAllMessages 陈旧响应守卫', () => {
  test('sameSelection：sessionId+projectHash 皆同才算同', () => {
    expect(sameSelection({ sessionId: 's', projectHash: 'p' }, { sessionId: 's', projectHash: 'p' })).toBe(true);
    expect(sameSelection({ sessionId: 's', projectHash: 'p2' }, { sessionId: 's', projectHash: 'p' })).toBe(false);
    expect(sameSelection(null, { sessionId: 's', projectHash: 'p' })).toBe(false);
  });

  test('全量在飞行中换卡 → A 会话 all:true 迟到响应不灌进 B 详情', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let resolveAllA: ((r: ChatResponse) => void) | null = null;
    const calls: ChatRequest[] = [];
    const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
      calls.push(req);
      switch (req.kind) {
        case 'projects':
          return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
        case 'sessions':
          return Promise.resolve({
            kind: 'sessions',
            sessions: [
              { sessionId: 's1', projectHash: 'p1', title: 'alpha zzz', startedAtMs: MS, lastModifiedMs: MS, fileSize: 1, source: 'claudeCode', cwd: '/w1' },
              { sessionId: 's2', projectHash: 'p2', title: 'beta zzz', startedAtMs: MS, lastModifiedMs: MS - 1, fileSize: 1, source: 'claudeCode', cwd: '/w2' },
            ],
          });
        case 'search':
          return Promise.resolve({ kind: 'search', results: [] });
        case 'session':
          if (req.sessionId === 's1' && req.all) return new Promise<ChatResponse>((res) => { resolveAllA = res; });
          if (req.sessionId === 's1')
            return Promise.resolve({ kind: 'messages', messages: [{ uuid: 'a-recent', sessionId: 's1', role: 'user', cwd: '/w1', tsMs: MS, text: 'AAA recent' }], prevCursor: 'pA' });
          if (req.sessionId === 's2')
            return Promise.resolve({ kind: 'messages', messages: [{ uuid: 'b-only', sessionId: 's2', role: 'user', cwd: '/w2', tsMs: MS, text: 'BBB only' }] });
          return Promise.resolve({ kind: 'messages', messages: [] });
        default:
          return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
      }
    });
    const bridge = { sendAction: vi.fn(), sendChatRequest, subscribeDataEvent: vi.fn(() => () => {}) } as unknown as BridgeApi;
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await settle();

    const cardByText = (t: string): Element =>
      [...container!.querySelectorAll('.session-card')].find((c) => c.textContent?.includes(t))!;
    const scrollerText = (): string => container!.querySelector('.session-detail__scroller')?.textContent ?? '';

    // 选 s1（plain 列表，无 query）→ 首屏加载（hasEarlier=true via pA）。
    await act(async () => cardByText('alpha').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(220));
    await settle();
    expect(scrollerText()).toContain('AAA recent');

    // 转搜索态 → W7 触发 s1 all:true（deferred，挂起）。
    await setQuery('zzz');
    await act(async () => vi.advanceTimersByTime(300));
    await settle();
    expect(calls.some((c) => c.kind === 'session' && c.sessionId === 's1' && (c as { all?: boolean }).all), 'W7 触发 s1 all:true').toBe(true);
    expect(resolveAllA, 's1 all:true 仍挂起').not.toBeNull();

    // 换卡到 s2（搜索态标题匹配卡可点）→ B 首屏落地。
    await act(async () => cardByText('beta').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(220));
    await settle();
    expect(scrollerText(), 'B 详情已落地').toContain('BBB only');

    // A 的 all:true 迟到响应 → 陈旧守卫丢弃，右栏仍是 B（不被 A 全量污染）。
    await act(async () => {
      resolveAllA!({
        kind: 'messages',
        messages: [
          { uuid: 'a-old', sessionId: 's1', role: 'user', cwd: '/w1', tsMs: MS - 5, text: 'AAA old leaked' },
          { uuid: 'a-recent', sessionId: 's1', role: 'user', cwd: '/w1', tsMs: MS, text: 'AAA recent' },
        ],
      });
    });
    await settle();
    expect(scrollerText(), '陈旧 A 全量不得灌进 B').not.toContain('AAA');
    expect(scrollerText(), 'B 详情保持').toContain('BBB only');
  });
});

describe('对抗回修 M-4：非导航重渲染不重滚', () => {
  test('同 idx 重渲染（新 messages 身份 + 无关字段变）不再 scrollIntoView；导航才滚', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    // 初次定位首命中 → 1 次滚动。
    await mount(createElement(ChatHistoryScreen, { fx: fxSearch([smsg('m0', 'alpha foo beta'), smsg('m1', 'foo foo')], 'foo') }));
    expect(spy, '初次定位首命中滚动一次').toHaveBeenCalledTimes(1);

    // 无关重渲染：新 messages 数组身份（同内容）+ 改无关字段 syncStatus → 命中坐标未变 → 不重滚。
    await rerender(
      createElement(ChatHistoryScreen, {
        fx: fxSearch([smsg('m0', 'alpha foo beta'), smsg('m1', 'foo foo')], 'foo', { over: { syncStatus: 'syncing' } }),
      }),
    );
    expect(spy, '非导航重渲染不再滚动（M-4 根治）').toHaveBeenCalledTimes(1);

    // 导航 ▼ → 目标坐标变 → 才滚动。
    await click(navBtns()[1]);
    expect(spy, '导航才滚动').toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('对抗回修：搜索态删除清幽灵卡（sessionRemoved 剔除 searchResults）', () => {
  test('removeSession 同步剔除该 sid 的 search hit（占位卡不留），保留其他命中', () => {
    const base = {
      ...initialChatState,
      query: 'foo',
      searchState: 'HasResults' as const,
      searchResults: [
        { projectHash: 'p', sessionId: 's-ghost', snippet: 'x', tsMs: 1 },
        { projectHash: 'p', sessionId: 's-keep', snippet: 'y', tsMs: 2 },
      ],
    };
    const next = chatReducer(base, { t: 'sessionRemoved', sessionId: 's-ghost' });
    expect(next.searchResults.map((h) => h.sessionId)).toEqual(['s-keep']);
  });

  test('删除的是当前右栏占位卡会话 → 清右栏 + 剔命中', () => {
    const base = {
      ...initialChatState,
      selection: { sessionId: 's-ghost', projectHash: 'p' },
      messagesHasEarlier: true,
      searchResults: [{ projectHash: 'p', sessionId: 's-ghost', snippet: 'x', tsMs: 1 }],
    };
    const next = chatReducer(base, { t: 'sessionRemoved', sessionId: 's-ghost' });
    expect(next.selection).toBeNull();
    expect(next.messages).toEqual([]);
    expect(next.messagesHasEarlier).toBe(false);
    expect(next.searchResults).toEqual([]);
  });

  test('sid 与卡片/命中/选中都无关 → 引用不变（原样返回）', () => {
    const base = { ...initialChatState, searchResults: [{ projectHash: 'p', sessionId: 's-other', snippet: 'x', tsMs: 1 }] };
    expect(chatReducer(base, { t: 'sessionRemoved', sessionId: 's-none' })).toBe(base);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part F — 批3 裁决顺修（V-1 W7 重试风暴 / V-2 回到顶部 pending 永转）
// ════════════════════════════════════════════════════════════════════════

describe('批3 裁决 V-1：W7 全量对持续 rejected 不重试（一次性尝试闩）', () => {
  test('all:true 持续被拒 → 只发一次不风暴；改词键变重臂恰好再试一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge, calls } = makeBridge({
      sessions: [{ sessionId: 's1', projectHash: 'ph', title: 'zzz t', startedAtMs: MS, lastModifiedMs: MS, fileSize: 1, source: 'claudeCode', cwd: '/w' }],
      firstPage: [{ uuid: 'm5', sessionId: 's1', role: 'user', cwd: '/w', tsMs: MS, text: 'recent' }],
      firstPrevCursor: 'p1', // 首屏 hasEarlier=true
      allRejected: true,
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    for (let i = 0; i < 12; i++) {
      await flush();
      if (container!.querySelector('.session-card')) break;
    }
    await act(async () => {
      container!.querySelector('.session-card')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(220));
    await settle();

    const allCount = (): number => calls.filter((c) => c.kind === 'session' && (c as { all?: boolean }).all).length;
    const rejectRound = async (): Promise<void> => {
      await act(async () => vi.advanceTimersByTime(20)); // 延时 rejected 落地 → loadMoreDone 复位 loadingMore
      await settle(); // 修前：effect 条件复真 → 再发（风暴）；修后：闩住不再发
    };
    // 转搜索态 → W7 发 all:true（挂起 10ms）→ rejected → 修前无界重发。
    await setQuery('zzz');
    await settle();
    await rejectRound();
    await rejectRound();
    await rejectRound();
    expect(allCount(), '持续 rejected 只尝试一次（无重试风暴）').toBe(1);

    // 改词 → 闩键变 → 重臂恰好再试一次（换卡/清词自愈通道保留）。
    await setQuery('zzz2');
    await settle();
    await rejectRound();
    expect(allCount(), '改词重臂一次，仍不风暴').toBe(2);
  });
});

describe('批3 裁决 V-2：回到顶部 pending 在 rejected 后复位（不永转）', () => {
  test('loadingMore true→false 边沿而 hasEarlier 未变 → spinner 复位可重试；不误触置顶', async () => {
    const onLoadAll = vi.fn();
    CH = 100;
    SH = 1000;
    top = 0; // MessageScrollController 贴底 → top=1000（越阈，浮钮显）
    const fxAt = (over: Record<string, unknown> = {}) =>
      createElement(ChatHistoryScreen, { fx: fxDetail({ hasEarlierMessages: true, onLoadAllMessages: onLoadAll, ...over }) });
    await mount(fxAt());
    await click(backBtn()!);
    expect(onLoadAll, '点击触发全量').toHaveBeenCalledTimes(1);
    expect(backBtn()!.disabled, '等待期 disabled').toBe(true);

    // 请求在飞（live.messagesLoadingMore=true）→ 仍 spinner（不误复位）。
    await rerender(fxAt({ messagesLoadingMore: true }));
    expect(backBtn()!.classList.contains('session-detail__back-to-top--busy'), '在飞仍 busy').toBe(true);

    // rejected：loadingMore 落 false 而 hasEarlier 仍 true → pending 复位（修前永转）。
    await rerender(fxAt({ messagesLoadingMore: false }));
    const btn = backBtn();
    expect(btn, '按钮仍在').not.toBeNull();
    expect(btn!.disabled, 'pending 已复位').toBe(false);
    expect(btn!.classList.contains('session-detail__back-to-top--busy'), 'spinner 已复位').toBe(false);
    expect(top, '被拒不误触置顶').not.toBe(0);

    // 侧效应根治：复位后换到 hasEarlier=false 的卡不再误触一次置顶。
    await rerender(fxAt({ hasEarlierMessages: false }));
    expect(top, '换已全量卡不误置顶').not.toBe(0);

    // 复位后可重试：回 hasEarlier=true 再点 → 再次触发全量。
    await rerender(fxAt());
    await click(backBtn()!);
    expect(onLoadAll, '复位后可重试').toHaveBeenCalledTimes(2);
  });
});
