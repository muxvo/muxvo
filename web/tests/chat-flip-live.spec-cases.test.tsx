// @vitest-environment jsdom
//
// M5 批4 spec 翻牌（web，A4-3）：工具块折叠/点击展开（CHAT_L1_12）、同步条（CHAT_L1_13）、noCC 空态
// （CHAT_L1_14）、搜索去抖 300ms（PERF_L2_05）。
// l1/chat 为混里程碑 spec → 逐条 test('ID: ...')，**严禁 test.each 注入**（spec-runner 1:1）。
//
// 断言面 = 真实工件：A4-2 的 ChatHistoryScreen 真实渲染（renderToStaticMarkup 静态态 + createRoot 交互）
// + chat.css 实工件 + A4-1 的 useChatData（真去抖 hook）。加性纪律：live 渲染走 fx.live（截图/静态路径
// fx.live 缺席 → §0~§6 golden 零感知）。断言以 spec/behavior 为准，实现偏差记 status.json note。
import { act, createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import chatSpec from '../../specs/legacy/l1/chat.spec.json';
import perfSpec from '../../specs/legacy/l2/perf-thresholds.spec.json';
import { ChatHistoryScreen } from '../src/screen/chat/ChatHistoryScreen';
import {
  CHAT_SEARCH_DEBOUNCE_MS,
  useChatData,
  type ChatDataApi,
  type UseChatDataDeps,
} from '../src/screen/chat/live/useChatData';
import type { ChatRequest, ChatResponse, DataEvent } from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 无 IntersectionObserver：live 触底/触顶哨兵 effect 会 new 它 → polyfill 成空壳（本关不测哨兵几何）。
class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;

type SpecCase = Record<string, any>;
const chatCase = (id: string): SpecCase => {
  const c = (chatSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`chat spec case 不存在: ${id}`);
  return c;
};
const perfCase = (id: string): SpecCase => {
  const c = (perfSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`perf spec case 不存在: ${id}`);
  return c;
};

// jsdom 环境下 import.meta.url 非 file: 方案 → 从 cwd 锚定（preflight `cd web`；兼容 repo 根调用）。
const webRoot = process.cwd().endsWith('/web') ? process.cwd() : resolve(process.cwd(), 'web');
const chatCss = readFileSync(resolve(webRoot, 'src/screen/chat/chat.css'), 'utf8');
function cssBlock(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return re.exec(chatCss)?.[1] ?? '';
}

// ── 挂载胶水（createRoot + act；afterEach 卸载） ──
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
  await act(async () => {}); // 冲挂载期 effect/promise（live 动态 import markdown 等）
  return el;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

// live bundle 全字段（fx 是 any，运行时屏读这些字段；给足默认避免 undefined 访问）。
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

const emptyChat = () => ({
  banner: false,
  selected: null,
  search: null,
  projects: [],
  sessions: [],
  messages: [],
});

// 满载详情 fixture：选中会话 s1，含一条带 tool_use 块的 assistant 消息（工具块折叠/展开断言）。
const toolChat = (over: Record<string, unknown> = {}) => ({
  banner: false,
  selected: 's1',
  expandToolCall: false,
  search: null,
  projects: [
    { projectHash: 'h1', displayPath: '/Users/rl/x', displayName: 'x', sessionCount: 1, totalSize: 100, lastActivity: '2026-06-01T00:00:00.000Z' },
  ],
  sessions: [
    { sessionId: 's1', projectHash: 'h1', title: 'fix bug', startedAt: '2026-06-01T00:00:00.000Z', lastModified: '2026-06-01T00:00:00.000Z', fileSize: 100, source: 'claude-code', cwd: '/Users/rl/x' },
  ],
  messages: [
    {
      uuid: 'a1',
      type: 'assistant',
      sessionId: 's1',
      cwd: '/Users/rl/x',
      timestamp: '2026-06-01T00:00:00.000Z',
      content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }],
    },
  ],
  ...over,
});

// ── CHAT_L1_12：工具调用默认折叠 + 蓝左边框 + 点击展开 ──

test('CHAT_L1_12: 工具调用默认折叠 -- 蓝色左边框 + 默认折叠 + 点击展开', async () => {
  const c = chatCase('CHAT_L1_12');
  // spec 锚定
  expect(c.expectedUI.toolCall.borderLeft).toBe('blue');
  expect(c.expectedUI.toolCall.defaultState).toBe('collapsed');
  expect(c.expectedUI.toolCall.action).toBe('click to expand');

  // 1) 蓝左边框 = chat.css 实工件 .tool-call-block { border-left: 3px solid #60a5fa }（legacy var(--info)）
  expect(cssBlock('.tool-call-block')).toMatch(/border-left:\s*3px solid #60a5fa;/);

  // 2) 默认折叠（golden 路径 expandToolCall=false，无 live）：工具块只渲 header（▶），无 content
  const collapsed = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: { id: 'c12a', theme: 'dark', screen: 'chat-history', chat: toolChat() } }));
  expect(collapsed).toContain('tool-call-block__header');
  expect(collapsed).toContain('▶');
  expect(collapsed).not.toContain('tool-call-block__content');
  // 展开目标存在（golden 路径 expandToolCall=true → 首个 tool_use 展开出 content + ▼）
  const golden = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: { id: 'c12b', theme: 'dark', screen: 'chat-history', chat: toolChat({ expandToolCall: true }) } }));
  expect(golden).toContain('tool-call-block__content');
  expect(golden).toContain('▼');

  // 3) live 路径「点击展开」：默认全折叠，点 header → 展开出 content（真交互）
  await mount(createElement(ChatHistoryScreen, { fx: { id: 'c12c', theme: 'dark', screen: 'chat-history', chat: toolChat(), live: liveBundle() } }));
  const header = container!.querySelector('.tool-call-block__header');
  expect(header).toBeTruthy();
  expect(container!.querySelector('.tool-call-block__content')).toBeNull(); // 默认折叠
  await act(async () => {
    header!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(container!.querySelector('.tool-call-block__content')).toBeTruthy(); // 点击后展开
});

// ── CHAT_L1_13：同步条（stub-only 改派 M5 真实现，§7.5） ──

test('CHAT_L1_13: 同步状态 UI -- 底部同步条「Muxvo 镜像 · 最后同步 HH:MM」+ syncing 图标', () => {
  const c = chatCase('CHAT_L1_13');
  expect(c.expectedUI.text).toBe('Muxvo 镜像 · 最后同步 HH:MM');
  expect(c.expectedUI.syncingIcon).toBe('spinning');

  const fxBase = { id: 'c13', theme: 'dark', screen: 'chat-history', chat: emptyChat() };

  // idle：底栏「Muxvo 镜像 · 最后同步 HH:MM」（HH:MM 本地时区补零，构造本地 Date → TZ 无关）
  const localTs = new Date(2026, 5, 1, 14, 30, 0).getTime();
  const idle = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: { ...fxBase, live: liveBundle({ syncStatus: 'idle', lastSyncMs: localTs }) } }));
  expect(idle).toContain('chat-history__sync-bar');
  // 复用 spec 的中点字符（避免手打不一致）：整条文案 HH:MM→14:30 应逐字出现于渲染
  expect(idle).toContain(c.expectedUI.text.replace('HH:MM', '14:30'));
  expect(idle).not.toContain('chat-history__sync-spinner');

  // syncing：旋转图标（syncingIcon:spinning）+「同步中…」
  const syncing = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: { ...fxBase, live: liveBundle({ syncStatus: 'syncing' }) } }));
  expect(syncing).toContain('chat-history__sync-spinner');
  expect(syncing).toContain('同步中');
  expect(syncing).toContain('chat-history__sync-bar--syncing');

  // error：同步暂停（chat-data §6.4 readonly 降级，不弹红框）
  const error = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: { ...fxBase, live: liveBundle({ syncStatus: 'error' }) } }));
  expect(error).toContain('同步暂停');

  // 加性纪律：无 fx.live（golden/截图路径）→ 不渲染底栏（既有 64 golden 零感知）
  const golden = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: fxBase }));
  expect(golden).not.toContain('chat-history__sync-bar');
});

// ── CHAT_L1_14：noCC 空态（stub-only 改派 M5 真实现，§7.6） ──

test('CHAT_L1_14: 空状态(未检测到CC) -- noCC 文案 + 对话气泡图标 + 「了解 Claude Code」钮', () => {
  const c = chatCase('CHAT_L1_14');
  expect(c.expectedUI.message).toContain('未检测到 Claude Code'); // spec 文案（as-built 前缀一致）
  expect(c.expectedUI.button).toContain('了解 Claude Code');

  const fxBase = { id: 'c14', theme: 'dark', screen: 'chat-history', chat: emptyChat() };

  // noCC=true（CC + Codex 双缺）：中栏渲染 noCC 空态
  const noCC = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: { ...fxBase, live: liveBundle({ noCC: true }) } }));
  expect(noCC).toContain('chat-nocc');
  expect(noCC).toContain('chat-nocc__icon'); // 对话气泡图标（dialog bubble）
  expect(noCC).toContain('未检测到 Claude Code 聊天记录'); // 文案以 spec 前缀为准
  expect(noCC).toContain('chat-nocc__btn');
  expect(noCC).toContain('了解 Claude Code'); // [了解 Claude Code] 按钮
  // 与 CHAT_L1_15 noProjects「暂无会话记录」区分（noCC 优先，不渲染 noProjects 文案）
  expect(noCC).not.toContain('暂无会话记录');

  // noCC=false 且无项目 → noProjects 空态「暂无会话记录」，不渲染 noCC（判定优先级 noCC > noProjects）
  const noProjects = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: { ...fxBase, live: liveBundle({ noCC: false }) } }));
  expect(noProjects).toContain('暂无会话记录');
  expect(noProjects).not.toContain('chat-nocc');
});

// ── PERF_L2_05：搜索去抖 300ms（真 hook + fake timers） ──

function makeDebounceDeps() {
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: [] });
      case 'session':
        return Promise.resolve({ kind: 'messages', messages: [] });
      case 'search':
        return Promise.resolve({ kind: 'search', results: [] });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((_h: (e: DataEvent) => void) => () => {});
  return { deps: { sendChatRequest, subscribeDataEvent } as UseChatDataDeps, sendChatRequest };
}
const searchCalls = (mock: ReturnType<typeof vi.fn>): ChatRequest[] =>
  mock.mock.calls.map((call) => call[0] as ChatRequest).filter((r) => r.kind === 'search');

function DebounceHarness({ deps, apiRef }: { deps: UseChatDataDeps; apiRef: { current: ChatDataApi | null } }): null {
  apiRef.current = useChatData(deps);
  return null;
}

test('PERF_L2_05: 搜索去抖 300ms -- CHAT_SEARCH_DEBOUNCE_MS===300 + 仅最后输入后 300ms 发一次', async () => {
  const c = perfCase('PERF_L2_05');
  expect(c.parameter).toBe('searchDebounceTime');
  expect(c.expectedValue).toBe(300);
  // 常量断言（独立于终端 searchBarLogic.SEARCH_DEBOUNCE_MS=150）
  expect(CHAT_SEARCH_DEBOUNCE_MS).toBe(300);

  // 行为断言（真 useChatData hook + fake timers）：连打三次只在末次输入后 300ms 发一次 search（取末词）
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { deps, sendChatRequest } = makeDebounceDeps();
  const apiRef: { current: ChatDataApi | null } = { current: null };
  await mount(createElement(DebounceHarness, { deps, apiRef }));

  await act(async () => apiRef.current!.setQuery('f'));
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  await act(async () => apiRef.current!.setQuery('fo'));
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  await act(async () => apiRef.current!.setQuery('foo'));
  await act(async () => {
    vi.advanceTimersByTime(CHAT_SEARCH_DEBOUNCE_MS - 1); // 距末次输入 299ms < 300 → 未发
  });
  expect(searchCalls(sendChatRequest)).toHaveLength(0);

  await act(async () => {
    vi.advanceTimersByTime(1); // 满 300ms → 只发一次，取末词
  });
  const calls = searchCalls(sendChatRequest);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ kind: 'search', query: 'foo' });
});
