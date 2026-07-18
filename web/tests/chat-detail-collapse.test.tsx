// @vitest-environment jsdom
//
// dogfood-r4 问题4：会话详情降噪——system 折叠壳 / thinking 折叠 / unknown 占位 / user 气泡 markdown。
// 断言面 = 真实工件：classifySystemMessage 纯函数 + 真 ChatHistoryScreen（fx.live 直挂 dom-assert）。
// live markdown 真渲染经动态 import chat-md-live（mermaid mock 免真载 11.x）；静态/golden 路径（无 fx.live）
// 走冻结 .message-bubble__text，无折叠壳——加性纪律，6 张 chat golden 无感。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';

const mermaidRun = vi.fn().mockResolvedValue(undefined);
const mermaidInit = vi.fn();
vi.mock('mermaid', () => ({
  default: { initialize: mermaidInit, run: mermaidRun },
}));

import { ChatHistoryScreen } from '../src/screen/chat/ChatHistoryScreen';
import { classifySystemMessage } from '../src/screen/chat/chat-detail-blocks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 无 IntersectionObserver / scrollIntoView：哨兵 effect + 命中滚动需空壳。
class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;
HTMLElement.prototype.scrollIntoView ??= function scrollIntoView(): void {};

// ── 挂载胶水 ──
let container: HTMLElement | null = null;
let root: Root | null = null;
async function mount(fx: unknown): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ChatHistoryScreen, { fx }));
  });
  // 冲刷动态 import('./chat-md-live') + markdown effect 的微任务队列（live 渲染核就绪）。
  for (let i = 0; i < 8; i++) await act(async () => await Promise.resolve());
  return host;
}
async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve());
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

// ── fx 工厂 ──
function liveBundle(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    onSelectProject: () => {},
    onSelectSession: () => {},
    onDoubleClickSession: () => {},
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
type Content = string | Array<Record<string, unknown>>;
const msg = (uuid: string, content: Content, type: 'user' | 'assistant' | 'system') => ({
  uuid,
  type,
  sessionId: 's1',
  cwd: '/x',
  timestamp: '2026-06-01T00:00:00.000Z',
  content,
});
function fxDetail(
  messages: ReturnType<typeof msg>[],
  opts: { live?: boolean; search?: { query: string; results: unknown[] } | null } = {},
) {
  const { live = true, search = null } = opts;
  const chat = {
    banner: false,
    selected: 's1',
    search,
    projects: [
      { projectHash: 'h1', displayPath: '/x', displayName: 'x', sessionCount: 1, totalSize: 1, lastActivity: '2026-06-01T00:00:00.000Z' },
    ],
    sessions: [
      { sessionId: 's1', projectHash: 'h1', title: 't', startedAt: '2026-06-01T00:00:00.000Z', lastModified: '2026-06-01T00:00:00.000Z', fileSize: 1, source: 'claude-code', cwd: '/x' },
    ],
    messages,
  };
  return live
    ? { id: 'd', theme: 'dark', screen: 'chat-history', chat, live: liveBundle() }
    : { id: 'd', theme: 'dark', screen: 'chat-history', chat };
}

// ════════════════════════════════════════════════════════════════════════
// Part A — classifySystemMessage 逐前缀（纯函数）
// ════════════════════════════════════════════════════════════════════════

describe('classifySystemMessage 逐前缀分类', () => {
  test('system-reminder → 提醒（默认折叠）', () => {
    expect(classifySystemMessage('<system-reminder>x</system-reminder>')).toEqual({ label: '提醒', defaultExpanded: false });
  });
  test('command-name / command-message → 命令（默认折叠）', () => {
    expect(classifySystemMessage('<command-name>foo</command-name>')).toEqual({ label: '命令', defaultExpanded: false });
    expect(classifySystemMessage('<command-message>bar</command-message>')).toEqual({ label: '命令', defaultExpanded: false });
  });
  test('task-notification → 任务通知（默认折叠）', () => {
    expect(classifySystemMessage('<task-notification>done</task-notification>')).toEqual({ label: '任务通知', defaultExpanded: false });
  });
  test('teammate-message → 队友消息（默认展开，人类可读对话）', () => {
    expect(classifySystemMessage('<teammate-message teammate_id="lead">hi</teammate-message>')).toEqual({
      label: '队友消息',
      defaultExpanded: true,
    });
  });
  test('cd / bindkey 起头 → shell（默认折叠）', () => {
    expect(classifySystemMessage('cd /Users/rl/proj')).toEqual({ label: 'shell', defaultExpanded: false });
    expect(classifySystemMessage('bindkey -e')).toEqual({ label: 'shell', defaultExpanded: false });
  });
  test('无前缀命中 → 空标签 + 折叠', () => {
    expect(classifySystemMessage('随便一段普通系统文本')).toEqual({ label: '', defaultExpanded: false });
  });
  test('前导空白不影响分类（trimStart）', () => {
    expect(classifySystemMessage('\n  <system-reminder>x</system-reminder>').label).toBe('提醒');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part B — system 折叠壳 dom-assert
// ════════════════════════════════════════════════════════════════════════

describe('system 折叠壳（live-only）', () => {
  test('默认折叠：有 header（SYSTEM+分类标签+摘要）、无展开体', async () => {
    await mount(fxDetail([msg('s0', '<system-reminder>\n第一行提醒内容\n第二行\n</system-reminder>', 'system')]));
    const fold = container!.querySelector('.system-fold');
    expect(fold, '渲折叠壳').not.toBeNull();
    expect(container!.querySelector('.system-fold__body'), '默认无展开体').toBeNull();
    expect(container!.querySelector('.system-fold__label')!.textContent).toContain('SYSTEM');
    expect(container!.querySelector('.system-fold__label')!.textContent).toContain('提醒');
    // 摘要 = 首个非空行（<system-reminder> 标签本身是首行 → 摘要取该行原文）。
    expect(container!.querySelector('.system-fold__summary')!.textContent).toContain('<system-reminder>');
    // 折叠时不再渲外层 message-bubble__label（避免双 SYSTEM）。
    expect(container!.querySelector('.message-bubble--system .message-bubble__label')).toBeNull();
  });

  test('点击 header 展开 → 出纯文本 body（不渲 markdown）；再点折回', async () => {
    await mount(fxDetail([msg('s0', '<system-reminder>**不该变粗**\n正文</system-reminder>', 'system')]));
    await click(container!.querySelector('.system-fold__header')!);
    const body = container!.querySelector('.system-fold__body');
    expect(body, '展开出 body').not.toBeNull();
    expect(body!.textContent).toContain('**不该变粗**'); // 纯文本：markdown 语法原样，不渲 strong
    expect(body!.querySelector('strong'), 'system body 不渲 markdown').toBeNull();
    // 再点折回。
    await click(container!.querySelector('.system-fold__header')!);
    expect(container!.querySelector('.system-fold__body'), '折回无 body').toBeNull();
  });

  test('teammate-message 默认展开（人类可读对话不折）', async () => {
    await mount(fxDetail([msg('s0', '<teammate-message teammate_id="lead">队友交代的任务</teammate-message>', 'system')]));
    expect(container!.querySelector('.system-fold__body'), 'teammate 默认展开有 body').not.toBeNull();
    expect(container!.querySelector('.system-fold__body')!.textContent).toContain('队友交代的任务');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part C — thinking 折叠块
// ════════════════════════════════════════════════════════════════════════

describe('thinking 折叠块（live-only）', () => {
  test('默认折叠：header「Thinking」、无展开体；展开后走 markdown（**bold**→strong）', async () => {
    await mount(fxDetail([msg('a0', [{ type: 'thinking', text: '**加粗推理**' }], 'assistant')]));
    const blk = container!.querySelector('.thinking-block');
    expect(blk, '渲 thinking 折叠块').not.toBeNull();
    expect(blk!.querySelector('.thinking-block__label')!.textContent).toBe('Thinking');
    expect(container!.querySelector('.thinking-block__content'), '默认折叠无展开体').toBeNull();
    // 展开 → markdown 真渲染（strong）。
    await click(container!.querySelector('.thinking-block__header')!);
    expect(container!.querySelector('.thinking-block__content'), '展开出 body').not.toBeNull();
    expect(container!.querySelector('.thinking-block strong'), '展开体走 markdown').not.toBeNull();
    expect(container!.querySelector('.thinking-block strong')!.textContent).toBe('加粗推理');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part D — unknown 占位块
// ════════════════════════════════════════════════════════════════════════

describe('unknown 占位块（live-only）', () => {
  test('默认折叠：header「不支持的块类型: {name}」；展开后 <pre> 原文 JSON', async () => {
    const raw = '{"type":"redacted_thinking","data":"enc"}';
    await mount(fxDetail([msg('a0', [{ type: 'unknown', name: 'redacted_thinking', content: raw }], 'assistant')]));
    const blk = container!.querySelector('.unknown-block');
    expect(blk, '渲 unknown 占位块').not.toBeNull();
    expect(blk!.querySelector('.unknown-block__label')!.textContent).toContain('不支持的块类型: redacted_thinking');
    expect(container!.querySelector('.unknown-block__content'), '默认折叠无展开体').toBeNull();
    await click(container!.querySelector('.unknown-block__header')!);
    const pre = container!.querySelector('pre.unknown-block__content');
    expect(pre, '展开出 <pre>').not.toBeNull();
    expect(pre!.textContent).toBe(raw); // 原文不丢
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part E — user 气泡 markdown（缺陷4/问题4）
// ════════════════════════════════════════════════════════════════════════

describe('user 气泡 markdown（live-only）', () => {
  test('user 的 text 块 **bold** → strong（走 markdown-preview md 通道）', async () => {
    await mount(fxDetail([msg('u0', [{ type: 'text', text: '**用户加粗**' }], 'user')]));
    const strong = container!.querySelector('.message-bubble--user .markdown-preview strong');
    expect(strong, 'user 气泡 markdown 渲 strong').not.toBeNull();
    expect(strong!.textContent).toBe('用户加粗');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part F — 搜索命中自动展开（W6 不变量：DOM mark 数=枚举命中数）
// ════════════════════════════════════════════════════════════════════════

describe('搜索命中 system 正文自动展开', () => {
  test('搜索命中折叠 system 正文 → 强制展开 + mark 在 DOM（不变量保持）', async () => {
    // 'zzq' 在整条 content 里恰出现一次（标签内不含）→ 枚举命中数=1，展开后 DOM mark 数须恒等。
    const content = '<system-reminder>包含 zzq 关键词</system-reminder>';
    await mount(
      fxDetail([msg('s0', content, 'system')], {
        search: { query: 'zzq', results: [{ projectHash: 'h1', sessionId: 's1', snippet: 'x', timestamp: '2026-06-01T00:00:00.000Z' }] },
      }),
    );
    // 命中该条正文 → 自动展开（无需点击）。
    expect(container!.querySelector('.system-fold__body'), '命中自动展开').not.toBeNull();
    // body 内高亮 mark 数 = 枚举命中数（1）——W6 不变量保持。
    const marks = container!.querySelectorAll('.system-fold__body mark.search-highlight');
    expect(marks.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Part G — 静态路径回归（无 fx.live → 冻结行为不变）
// ════════════════════════════════════════════════════════════════════════

describe('静态/golden 路径回归（无 fx.live）', () => {
  test('system/user 字符串仍 .message-bubble__text，无折叠壳/thinking-block', async () => {
    await mount(
      fxDetail([msg('s0', '<system-reminder>x</system-reminder>', 'system'), msg('u0', '普通用户消息', 'user')], { live: false }),
    );
    expect(container!.querySelector('.system-fold'), '静态无 system 折叠壳').toBeNull();
    expect(container!.querySelector('.thinking-block'), '静态无 thinking 块').toBeNull();
    // system 仍逐字节渲 .message-bubble__text（冻结）。
    const texts = [...container!.querySelectorAll('.message-bubble__text')].map((e) => e.textContent);
    expect(texts).toContain('<system-reminder>x</system-reminder>');
    expect(texts).toContain('普通用户消息');
    // 静态路径外层 label 照旧渲染。
    expect(container!.querySelector('.message-bubble--system .message-bubble__label')!.textContent).toBe('SYSTEM');
  });
});
