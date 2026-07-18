// @vitest-environment jsdom
//
// M5-R1 批3 W8/W11：会话卡右键菜单（重命名/导出/删除）+ 内联重命名全链 + 删除确认（正确 projectHash /
// removeSession / codex rejected 内联提示）+ 导出请求形状 + exportMd 纯函数。断言面 = 真 ChatHistoryLive
// （含真 useChatData/ChatHistoryScreen/SessionContextMenu），createRoot + act 真挂载；加性纪律：菜单/弹窗均
// live-only（fx.live 缺席不渲染），6 张 chat golden 零感知。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatHistoryLive } from '../src/screen/chat/live/ChatHistoryLive';
import { formatMessagesAsMarkdown, type ExportMessage } from '../src/screen/chat/live/exportMd';
import type { BridgeApi } from '../src/bridge/client';
import type { Fixture } from '../src/fixture/types';
import type {
  ChatMessageView,
  ChatProjectView,
  ChatRequest,
  ChatResponse,
  ChatSessionView,
  DataEvent,
} from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;

const MS = 1717243200000; // 2024-06-01T12:00:00.000Z

// ── 挂载胶水 ──
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
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

// ── 桥工厂：捕获 requests + 可注 responder 覆盖特定 kind 响应 ──
function makeBridge(
  opts: {
    projects?: ChatProjectView[];
    sessions?: ChatSessionView[];
    messages?: ChatMessageView[];
    responder?: (req: ChatRequest) => ChatResponse | Promise<ChatResponse> | undefined;
  } = {},
) {
  const requests: ChatRequest[] = [];
  const sendAction = vi.fn();
  let dataHandler: ((e: DataEvent) => void) | null = null;
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    requests.push(req);
    const custom = opts.responder?.(req);
    if (custom) return Promise.resolve(custom); // Promise.resolve 采纳 promise（可注延迟响应）
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: opts.projects ?? [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: opts.sessions ?? [] });
      case 'session':
        return Promise.resolve({ kind: 'messages', messages: opts.messages ?? [] });
      case 'search':
        return Promise.resolve({ kind: 'search', results: [] });
      case 'setTitle':
        return Promise.resolve({ kind: 'ok' });
      case 'delete':
        return Promise.resolve({ kind: 'deleted', sessionId: req.sessionId });
      case 'export':
        return Promise.resolve({ kind: 'exported', outputPath: '/tmp/export.md' });
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
  return { bridge, sendAction, requests, emit: (e: DataEvent) => dataHandler?.(e) };
}

function liveFx(): Fixture {
  return { id: 'batch3-menu', theme: 'dark', terminals: [] } as unknown as Fixture;
}

function session(over: Partial<ChatSessionView> = {}): ChatSessionView {
  return {
    sessionId: 's1',
    projectHash: 'ph-real',
    title: 'Original Title',
    startedAtMs: MS,
    lastModifiedMs: MS,
    fileSize: 100,
    source: 'claudeCode',
    ...over,
  };
}

async function waitForCard(): Promise<HTMLElement> {
  for (let i = 0; i < 12; i++) {
    await flush();
    const c = container!.querySelector('.session-card') as HTMLElement | null;
    if (c) return c;
  }
  throw new Error('session-card 未渲染');
}
async function openMenu(clientX = 120, clientY = 240): Promise<void> {
  const card = await waitForCard();
  await act(async () => {
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }));
  });
}
function menuItem(label: string): HTMLButtonElement {
  const items = [...container!.querySelectorAll('.session-context-menu__item')] as HTMLButtonElement[];
  const found = items.find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`菜单无项含「${label}」`);
  return found;
}
function click(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
function cardTitle(): string {
  return container!.querySelector('.session-card__title')?.textContent ?? '';
}
function setInput(input: HTMLInputElement, value: string): Promise<void> {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function pressEnter(input: HTMLInputElement): Promise<void> {
  return act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

// ════════════════════════════════════════════════════════════════════════
// W8 右键菜单（三项 + 关闭语义）
// ════════════════════════════════════════════════════════════════════════

describe('W8 右键菜单', () => {
  test('右键卡片 → 菜单三项（重命名/导出为 Markdown/删除）+ 定位 clientX/Y', async () => {
    const { bridge } = makeBridge({ sessions: [session()] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu(120, 240);
    const menu = container!.querySelector('.session-context-menu') as HTMLElement;
    expect(menu, '菜单渲染').not.toBeNull();
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('240px');
    expect(menuItem('重命名')).toBeTruthy();
    expect(menuItem('导出为 Markdown')).toBeTruthy();
    expect(menuItem('删除聊天记录')).toBeTruthy();
  });

  test('点菜单外 mousedown → 关闭（不执行任何项）', async () => {
    const { bridge, requests } = makeBridge({ sessions: [session()] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    expect(container!.querySelector('.session-context-menu')).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container!.querySelector('.session-context-menu'), '菜单外点击关闭').toBeNull();
    expect(requests.some((r) => r.kind === 'delete' || r.kind === 'setTitle' || r.kind === 'export')).toBe(false);
  });

  test('Esc 关闭菜单且不触发面板 chatClose（capture+stopPropagation）', async () => {
    const { bridge, sendAction } = makeBridge({ sessions: [session()] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    const menu = container!.querySelector('.session-context-menu')!;
    await act(async () => {
      // 在菜单节点上派发（capture 于 document 先于 target 命中 → stopPropagation 阻断容器 bubble Esc）
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(container!.querySelector('.session-context-menu'), 'Esc 关菜单').toBeNull();
    expect(sendAction).not.toHaveBeenCalledWith({ kind: 'chatClose' });
  });
});

// ════════════════════════════════════════════════════════════════════════
// W8 内联重命名全链（提交 / 空串清除 / rejected 回滚）
// ════════════════════════════════════════════════════════════════════════

describe('W8 内联重命名', () => {
  test('菜单→重命名→输入框预填→Enter 提交 setTitle + 乐观 patch', async () => {
    const { bridge, requests } = makeBridge({ sessions: [session({ customTitle: 'Custom' })] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('重命名'));
    const input = container!.querySelector('.session-card__rename-input') as HTMLInputElement;
    expect(input, '重命名输入框出现').not.toBeNull();
    expect(input.value, '预填 customTitle||title').toBe('Custom');
    await setInput(input, 'New Name');
    await pressEnter(input);
    await flush();
    expect(requests).toContainEqual({ kind: 'setTitle', sessionId: 's1', title: 'New Name' });
    expect(cardTitle(), '乐观改本卡标题').toBe('New Name');
    expect(container!.querySelector('.session-card__rename-input'), '提交后退出编辑态').toBeNull();
  });

  test('空串提交 = 清除回默认（setTitle title:"" + 回落 title）', async () => {
    const { bridge, requests } = makeBridge({ sessions: [session({ customTitle: 'Custom' })] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('重命名'));
    const input = container!.querySelector('.session-card__rename-input') as HTMLInputElement;
    await setInput(input, '');
    await pressEnter(input);
    await flush();
    expect(requests).toContainEqual({ kind: 'setTitle', sessionId: 's1', title: '' });
    expect(cardTitle(), '清除后回落原 title').toBe('Original Title');
  });

  test('rejected → 乐观 patch 回滚（延迟响应观测中间态）', async () => {
    let rejectSetTitle!: (r: ChatResponse) => void;
    const deferred = new Promise<ChatResponse>((res) => {
      rejectSetTitle = res;
    });
    const { bridge } = makeBridge({
      sessions: [session({ customTitle: 'Custom' })],
      responder: (req) => (req.kind === 'setTitle' ? deferred : undefined),
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('重命名'));
    const input = container!.querySelector('.session-card__rename-input') as HTMLInputElement;
    await setInput(input, 'New Name');
    await pressEnter(input);
    // setTitle 仍 pending → 乐观阶段显示 New Name
    expect(cardTitle(), '乐观阶段先显示新名').toBe('New Name');
    // 响应 rejected → 回滚到原 customTitle
    await act(async () => {
      rejectSetTitle({ kind: 'rejected', code: 'ERR', message: 'no' });
      await Promise.resolve();
    });
    expect(cardTitle(), 'rejected 回滚到原 customTitle').toBe('Custom');
  });

  test('Esc 取消重命名（不发 setTitle，标题不变）', async () => {
    const { bridge, requests } = makeBridge({ sessions: [session({ customTitle: 'Custom' })] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('重命名'));
    const input = container!.querySelector('.session-card__rename-input') as HTMLInputElement;
    await setInput(input, 'Discarded');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await flush();
    expect(requests.some((r) => r.kind === 'setTitle')).toBe(false);
    expect(cardTitle()).toBe('Custom');
  });
});

// ════════════════════════════════════════════════════════════════════════
// W8 删除（确认弹窗 / 正确 projectHash / removeSession / codex rejected 提示）
// ════════════════════════════════════════════════════════════════════════

describe('W8 删除', () => {
  test('确认删除 → delete 请求带真实 projectHash → removeSession 移卡', async () => {
    const { bridge, requests } = makeBridge({ sessions: [session({ projectHash: 'ph-real' })] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('删除聊天记录'));
    expect(container!.querySelector('.chat-confirm-modal__dialog'), '确认弹窗（非 window.confirm）').not.toBeNull();
    await click(container!.querySelector('.chat-confirm-modal__btn--danger')!);
    await flush();
    expect(requests).toContainEqual({ kind: 'delete', projectHash: 'ph-real', sessionId: 's1' });
    expect(container!.querySelector('.session-card'), '删除后卡片移除').toBeNull();
    expect(container!.querySelector('.chat-confirm-modal__dialog'), '弹窗关闭').toBeNull();
  });

  test('codex 会话 rejected UNSUPPORTED_SOURCE → 内联提示，卡片保留', async () => {
    const { bridge } = makeBridge({
      sessions: [session({ source: 'codex' })],
      responder: (req) =>
        req.kind === 'delete' ? { kind: 'rejected', code: 'UNSUPPORTED_SOURCE', message: 'nope' } : undefined,
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('删除聊天记录'));
    await click(container!.querySelector('.chat-confirm-modal__btn--danger')!);
    await flush();
    expect(container!.querySelector('.chat-confirm-modal__error')?.textContent).toContain(
      'Codex 会话暂不支持删除',
    );
    expect(container!.querySelector('.session-card'), 'rejected 后卡片保留').not.toBeNull();
  });

  test('取消删除 → 不发 delete，卡片保留', async () => {
    const { bridge, requests } = makeBridge({ sessions: [session()] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('删除聊天记录'));
    await click(container!.querySelector('.chat-confirm-modal__btn')!); // 第一个=取消
    expect(container!.querySelector('.chat-confirm-modal__dialog')).toBeNull();
    expect(requests.some((r) => r.kind === 'delete')).toBe(false);
    expect(container!.querySelector('.session-card')).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// W8 导出（请求形状 + 静默关菜单）
// ════════════════════════════════════════════════════════════════════════

describe('W8 导出为 Markdown', () => {
  test('点导出 → export 请求（projectHash/sessionId/format）+ 关菜单', async () => {
    const { bridge, requests } = makeBridge({ sessions: [session({ projectHash: 'ph-real' })] });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await openMenu();
    await click(menuItem('导出为 Markdown'));
    expect(requests).toContainEqual({
      kind: 'export',
      projectHash: 'ph-real',
      sessionId: 's1',
      format: 'markdown',
    });
    expect(container!.querySelector('.session-context-menu'), '导出后关菜单').toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// W11 exportMd 纯函数（跳 system / 标题 / 时间戳 / 角色标签 / 空正文跳过）
// ════════════════════════════════════════════════════════════════════════

describe('W11 formatMessagesAsMarkdown', () => {
  const fmt = (ms: number): string => `T${ms}`;

  test('跳 system + # 标题 + 每条 ## label (时间) + assistant text 块拼接', () => {
    const msgs: ExportMessage[] = [
      { uuid: 'sys1', role: 'system', tsMs: 1, text: 'ignored' },
      { uuid: 'u1', role: 'user', tsMs: 10, text: 'hello' },
      {
        uuid: 'a1',
        role: 'assistant',
        tsMs: 20,
        blocks: [
          { kind: 'text', text: 'hi there' },
          { kind: 'toolUse', name: 'x', inputJson: '{}' },
        ],
      },
      { uuid: 'a2', role: 'assistant', tsMs: 30, blocks: [{ kind: 'toolUse', name: 'y', inputJson: '{}' }] },
    ];
    expect(formatMessagesAsMarkdown('My Title', msgs, fmt)).toBe(
      '# My Title\n\n## You (T10)\n\nhello\n\n## Claude (T20)\n\nhi there',
    );
  });

  test('codex-/gemini- 前缀 → Codex/Gemini 标签；空标题不产 # 行', () => {
    const msgs: ExportMessage[] = [
      { uuid: 'codex-1', role: 'assistant', tsMs: 5, text: 'cx' },
      { uuid: 'gemini-1', role: 'assistant', tsMs: 6, text: 'gm' },
    ];
    expect(formatMessagesAsMarkdown('', msgs, fmt)).toBe('## Codex (T5)\n\ncx\n\n## Gemini (T6)\n\ngm');
  });
});
