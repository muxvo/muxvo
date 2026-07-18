// @vitest-environment jsdom
//
// M5-R1 批1 回修（web）：缺陷3（内容匹配占位卡可点开右栏详情）、W9（双击=聚焦/续聊 + 单/双击防误触去抖）、
// 缺陷5-A（亮色分节头 golden 安全覆盖）。断言面 = 真实工件：ChatHistoryScreen 静态渲染 + 真实 ChatHistoryLive
// 容器（真 useChatData + 去抖 ref）+ actions.ts 纯函数 + chat.css 原文。加性纪律：live 交互走 fx.live，
// 静态/golden 路径 fx.live 缺席 → 6 张 chat golden 零感知。
import { act, createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ChatHistoryScreen } from '../src/screen/chat/ChatHistoryScreen';
import { ChatHistoryLive } from '../src/screen/chat/live/ChatHistoryLive';
import { cwdPrefixMatches, normalizeCwd, pickDoubleClickAction } from '../src/screen/chat/live/actions';
import type { BridgeApi } from '../src/bridge/client';
import type { Fixture } from '../src/fixture/types';
import type { ChatRequest, ChatResponse, DataEvent } from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 无 IntersectionObserver：live 触底/触顶哨兵 effect 会 new 它 → polyfill 成空壳。
class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;

const MS = 1717243200000; // 2024-06-01T12:00:00.000Z（确定性）

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
  await act(async () => {});
  return el;
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
});

// ════════════════════════════════════════════════════════════════════════
// 缺陷3：内容匹配占位卡（selected 命中 contentMatched 而非 c.sessions）→ 右栏渲染详情非空态。
// ════════════════════════════════════════════════════════════════════════

test('缺陷3: 内容匹配占位卡 selected → 右栏详情非空态（sel 退回 contentMatched）', () => {
  const fx = {
    id: 'r1-d3',
    theme: 'dark',
    screen: 'chat-history',
    chat: {
      banner: false,
      selected: 'sX', // 占位卡 sessionId，不在 c.sessions
      search: {
        query: 'foo',
        results: [
          { projectHash: 'ph', sessionId: 'sX', snippet: 'foo 命中片段', timestamp: '2026-06-01T00:00:00.000Z' },
        ],
      },
      projects: [],
      sessions: [], // sX 未加载 → 旧代码 sel=undefined → 右栏永远空态
      messages: [
        {
          uuid: 'm1',
          type: 'assistant',
          sessionId: 'sX',
          cwd: '/Users/rl/x',
          timestamp: '2026-06-01T00:00:00.000Z',
          content: '命中会话的详情消息',
        },
      ],
    },
  };
  const html = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx }));
  // 修复后：右栏渲染消息气泡，不再是「选择一个会话查看详情」空态
  expect(html).not.toContain('选择一个会话查看详情');
  expect(html).toContain('message-bubble--assistant');
  expect(html).toContain('命中会话的详情消息');
});

// ════════════════════════════════════════════════════════════════════════
// W9：pickDoubleClickAction 纯函数（有匹配终端跳转 / 无终端有 cwd 续聊 / 全无跳转保底）。
// ════════════════════════════════════════════════════════════════════════

describe('pickDoubleClickAction（W9：双击决策纯函数）', () => {
  const session = { sessionId: 's1' };

  test('有匹配活体终端（cwd 相等且非 Stopped/Removed）→ chatJumpToTerminal', () => {
    const a = pickDoubleClickAction(session, { cwd: '/w', source: 'claude-code' }, [{ cwd: '/w', state: 'Running' }]);
    expect(a).toEqual({ kind: 'chatJumpToTerminal', sessionId: 's1', cwd: '/w' });
  });

  test('cwd 相等但终端已 Stopped/Removed（非活体）→ 退回 chatResume', () => {
    const a = pickDoubleClickAction(
      session,
      { cwd: '/w', source: 'claude-code' },
      [{ cwd: '/w', state: 'Stopped' }, { cwd: '/w', state: 'Removed' }],
    );
    expect(a.kind).toBe('chatResume');
  });

  test('无匹配终端但 cwd 可解析 → chatResume（source kebab→camel，customTitle 透传）', () => {
    const a = pickDoubleClickAction(session, { cwd: '/w', source: 'codex', customTitle: 'T' }, []);
    expect(a).toEqual({ kind: 'chatResume', sessionId: 's1', cwd: '/w', source: 'codex', customTitle: 'T' });
  });

  test('cwd 不可解析（空/空白）→ chatJumpToTerminal 保底（无 cwd → native closeOnly）', () => {
    const a = pickDoubleClickAction(session, { cwd: '  ', source: undefined }, [{ cwd: '/w', state: 'Running' }]);
    expect(a).toEqual({ kind: 'chatJumpToTerminal', sessionId: 's1', cwd: undefined });
  });

  // m-2：cwd 匹配须与 native cwdPrefixMatches 同口径（前缀 + 去尾斜杠归一），否则 web/native jump 行为分叉。
  test('m-2: 会话在项目根 /repo、终端在 worktree 子目录 /repo/worktree-x → 前缀命中 → jump（不开重复终端）', () => {
    const a = pickDoubleClickAction(session, { cwd: '/repo', source: 'claude-code' }, [
      { cwd: '/repo/worktree-x', state: 'Running' },
    ]);
    expect(a).toEqual({ kind: 'chatJumpToTerminal', sessionId: 's1', cwd: '/repo' });
  });
  test('m-2: 尾斜杠差异（会话 /repo/ vs 终端 /repo）→ 归一后相等 → jump', () => {
    const a = pickDoubleClickAction(session, { cwd: '/repo/', source: 'claude-code' }, [
      { cwd: '/repo', state: 'Running' },
    ]);
    expect(a.kind).toBe('chatJumpToTerminal');
  });
  test('m-2: 路径分量边界不误配（会话 /a/proj vs 终端 /a/proj-x）→ 无命中 → chatResume', () => {
    const a = pickDoubleClickAction(session, { cwd: '/a/proj', source: 'claude-code' }, [
      { cwd: '/a/proj-x', state: 'Running' },
    ]);
    expect(a.kind).toBe('chatResume');
  });
});

describe('normalizeCwd / cwdPrefixMatches（m-2：与 native 同口径纯函数）', () => {
  test('normalizeCwd 去尾斜杠（根 / 保留）+ trim', () => {
    expect(normalizeCwd('/repo/')).toBe('/repo');
    expect(normalizeCwd('/repo///')).toBe('/repo');
    expect(normalizeCwd('  /repo  ')).toBe('/repo');
    expect(normalizeCwd('/')).toBe('/');
  });
  test('相等 / worktree 子目录前缀 → 命中', () => {
    expect(cwdPrefixMatches('/repo', '/repo')).toBe(true);
    expect(cwdPrefixMatches('/repo', '/repo/worktree-x')).toBe(true);
    expect(cwdPrefixMatches('/repo/', '/repo')).toBe(true);
  });
  test('路径分量边界不误配 + 空 base 恒不命中', () => {
    expect(cwdPrefixMatches('/a/proj', '/a/proj-x')).toBe(false);
    expect(cwdPrefixMatches('', '/repo')).toBe(false);
    expect(cwdPrefixMatches('   ', '/repo')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// W9：真实 ChatHistoryLive 容器的单/双击防误触去抖（fake timers）。
// ════════════════════════════════════════════════════════════════════════

function liveFx(): Fixture {
  // ChatHistoryLive 仅读 fx.id / fx.theme / fx.terminals（终端空 → 双击走 chatResume）。
  return { id: 'r1-live', theme: 'dark', terminals: [] } as unknown as Fixture;
}

function makeBridge() {
  const sendAction = vi.fn();
  const requests: ChatRequest[] = [];
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    requests.push(req);
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({
          kind: 'sessions',
          sessions: [
            { sessionId: 's1', projectHash: 'ph', title: 'fix bug', startedAtMs: MS, lastModifiedMs: MS, fileSize: 100, source: 'claudeCode', cwd: '/w' },
          ],
        });
      case 'session':
        return Promise.resolve({ kind: 'messages', messages: [] });
      case 'search':
        return Promise.resolve({ kind: 'search', results: [] });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((_h: (e: DataEvent) => void) => () => {});
  const bridge = { sendAction, sendChatRequest, subscribeDataEvent } as unknown as BridgeApi;
  return { bridge, sendAction, requests };
}

async function waitForCard(): Promise<Element> {
  for (let i = 0; i < 12; i++) {
    await flush();
    const card = container!.querySelector('.session-card');
    if (card) return card;
  }
  throw new Error('session-card 未渲染（projects→sessions 加载未完成）');
}

test('W9: 单击选中延迟 ~220ms 落地（防误触；<220ms 不触发选中拉取）', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { bridge, requests } = makeBridge();
  await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
  const card = await waitForCard();
  const sessionReqs = (): ChatRequest[] => requests.filter((r) => r.kind === 'session');
  expect(sessionReqs()).toHaveLength(0);

  await act(async () => {
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(219);
  });
  expect(sessionReqs()).toHaveLength(0); // 219ms < 220 → 未选中

  await act(async () => {
    vi.advanceTimersByTime(1); // 满 220ms → 选中触发 session 首屏拉取
  });
  await flush();
  expect(sessionReqs().length).toBeGreaterThan(0);
  expect(sessionReqs()[0]).toMatchObject({ kind: 'session', sessionId: 's1', projectHash: 'ph' });
});

test('W9: 双击撤销 pending 单击（不选中）并发射续聊动作', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { bridge, sendAction, requests } = makeBridge();
  await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
  const card = await waitForCard();

  await act(async () => {
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  // 双击发射动作：终端列表空 + 会话 cwd '/w' 可解析 → chatResume
  expect(sendAction).toHaveBeenCalledTimes(1);
  expect(sendAction.mock.calls[0][0]).toMatchObject({
    kind: 'chatResume',
    sessionId: 's1',
    cwd: '/w',
    source: 'claudeCode',
  });

  // pending 单击已被撤销：advance 满去抖窗也不触发 session 选中拉取
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  await flush();
  expect(requests.filter((r) => r.kind === 'session')).toHaveLength(0);
});

// ════════════════════════════════════════════════════════════════════════
// M-1：搜索内容匹配占位卡续聊 → resume 载荷 source 从已加载消息 uuid 前缀推断
// （codex- 前缀 → 'codex'，避免 codex 会话错注入 CC harness；无前缀 → 'claudeCode'）。
// ════════════════════════════════════════════════════════════════════════

function makeSearchBridge(messageUuid: string) {
  const sendAction = vi.fn();
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: [] }); // cx1 不在已加载页 → 内容匹配占位卡
      case 'search':
        return Promise.resolve({
          kind: 'search',
          results: [{ projectHash: 'ph', sessionId: 'cx1', snippet: 'foo 命中片段', tsMs: MS }],
        });
      case 'session':
        return Promise.resolve({
          kind: 'messages',
          messages: [{ uuid: messageUuid, sessionId: 'cx1', role: 'user', cwd: '/w', tsMs: MS, text: 'hi' }],
        });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((_h: (e: DataEvent) => void) => () => {});
  const bridge = { sendAction, sendChatRequest, subscribeDataEvent } as unknown as BridgeApi;
  return { bridge, sendAction };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 驱动 search→选中占位卡→继续聊天 全链，返回 chatResume 载荷（fake timers 已在调用侧启用）。 */
async function resumePayloadForPlaceholder(messageUuid: string): Promise<Record<string, unknown>> {
  const { bridge, sendAction } = makeSearchBridge(messageUuid);
  await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
  await flush();
  await flush(); // 初始 projects→sessions（空）落地

  // 搜索框输入 'foo' → onSearchInput → 去抖 300ms → search 请求 → 占位卡渲染
  const input = container!.querySelector('.search-input-wrap__input') as HTMLInputElement;
  await act(async () => setInputValue(input, 'foo'));
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  const card = await waitForCard();

  // 单击占位卡 → 220ms 去抖 → 选中 → session 请求 → 消息加载（uuid 前缀决定推断 source）
  await act(async () => {
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(220);
  });
  await flush();
  await flush();

  // 点「继续聊天」→ chatResume 发射
  const resumeBtn = container!.querySelector('.session-detail__resume-btn');
  if (!resumeBtn) throw new Error('resume 按钮未渲染（canResume 未成立）');
  await act(async () => {
    resumeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const call = sendAction.mock.calls.find((c) => (c[0] as { kind?: string }).kind === 'chatResume');
  if (!call) throw new Error('未发射 chatResume');
  return call[0] as Record<string, unknown>;
}

test('M-1: codex 占位卡续聊 → resume 载荷 source=codex（uuid 前缀 codex- 推断）', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const payload = await resumePayloadForPlaceholder('codex-cx1-user-0');
  expect(payload).toMatchObject({ kind: 'chatResume', sessionId: 'cx1', cwd: '/w', source: 'codex' });
});

test('M-1: cc 占位卡续聊 → resume 载荷 source=claudeCode（无 codex- 前缀，默认 CC）', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const payload = await resumePayloadForPlaceholder('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  expect(payload).toMatchObject({ kind: 'chatResume', sessionId: 'cx1', cwd: '/w', source: 'claudeCode' });
});

// ════════════════════════════════════════════════════════════════════════
// 缺陷5-A：亮色分节头 golden 安全覆盖（该元素仅搜索屏可见 → 任何 light golden 均不含 → 零像素）。
// ════════════════════════════════════════════════════════════════════════

test('缺陷5-A: [data-theme=light] .session-list__section-header 存在且改黑色低透明度底', () => {
  const webRoot = process.cwd().endsWith('/web') ? process.cwd() : resolve(process.cwd(), 'web');
  const chatCss = readFileSync(resolve(webRoot, 'src/screen/chat/chat.css'), 'utf8');
  const re = /\[data-theme='light'\]\s+\.session-list__section-header\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.03\)/;
  expect(re.test(chatCss)).toBe(true);
});
