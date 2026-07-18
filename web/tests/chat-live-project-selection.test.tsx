// @vitest-environment jsdom
//
// dogfood-r5 W-B 左栏项目选中态跟随：左栏 `--selected` 高亮由 payload selectedProjectHash 决定，随点击迁移、
// 跨保活隐藏/重现保持（不回落「全部项目」）。断言面：
//  - live 路径 = 真实工件 ChatHistoryChrome/ChatHistoryLive/useChatData（createRoot + act 真挂载，reducer 驱动）；
//  - 静态守卫 = ChatHistoryScreen 直渲（无 fx.live、缺省 selectedProjectHash）→ 「全部项目」恒选中、项目行不选中
//    （golden DOM 契约恒等）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatHistoryChrome } from '../src/screen/chat/live/ChatHistoryChrome';
import { ChatHistoryScreen } from '../src/screen/chat/ChatHistoryScreen';
import type { BridgeApi } from '../src/bridge/client';
import type { Fixture } from '../src/fixture/types';
import type {
  ChatProjectView,
  ChatRequest,
  ChatResponse,
  ConfigRequest,
  ConfigResponse,
  ConfigSnapshot,
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
async function clickEl(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
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

function proj(projectHash: string, displayName: string): ChatProjectView {
  return {
    projectHash,
    displayPath: `/tmp/${displayName}`,
    displayName,
    sessionCount: 1,
    totalSize: 100,
    lastActivityMs: 1000,
  };
}

function makeBridge(projects: ChatProjectView[]) {
  const sendAction = vi.fn();
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: projects.slice(), ccDetected: true });
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
  const sendConfigRequest = vi.fn((req: ConfigRequest): Promise<ConfigResponse> =>
    req.kind === 'get' || req.kind === 'set'
      ? Promise.resolve({ kind: 'snapshot', config: fullSnapshot() })
      : Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' }),
  );
  const sendAppRequest = vi.fn(() => Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' }));
  const bridge = {
    sendAction,
    sendChatRequest,
    subscribeDataEvent,
    sendConfigRequest,
    sendAppRequest,
  } as unknown as BridgeApi;
  return { bridge };
}

function chromeFx(): Fixture {
  return { id: 'projsel', theme: 'dark', terminals: [] } as unknown as Fixture;
}

/** 左栏项目行（含首行「全部项目」）；index 0 = 全部项目，1+ = 项目（proj 顺序）。 */
function projectRows(): Element[] {
  return Array.from(container!.querySelectorAll('.project-list__item'));
}
const isSel = (el: Element): boolean => el.classList.contains('project-list__item--selected');

const PA = proj('ph-a', 'Alpha');
const PB = proj('ph-b', 'Beta');

describe('W-B live：左栏高亮跟随 selectedProjectHash（点击迁移）', () => {
  test('初始 → 「全部项目」选中、项目行皆不选中', async () => {
    const { bridge } = makeBridge([PA, PB]);
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    const rows = projectRows();
    expect(rows.length).toBe(3); // 全部项目 + Alpha + Beta
    expect(isSel(rows[0])).toBe(true);
    expect(isSel(rows[1])).toBe(false);
    expect(isSel(rows[2])).toBe(false);
  });

  test('点项目行 → 该行选中、「全部项目」失选；再点全部项目 → 高亮迁回', async () => {
    const { bridge } = makeBridge([PA, PB]);
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));

    await clickEl(projectRows()[1]); // 点 Alpha
    let rows = projectRows();
    expect(isSel(rows[0]), '全部项目失选').toBe(false);
    expect(isSel(rows[1]), 'Alpha 选中').toBe(true);
    expect(isSel(rows[2]), 'Beta 不选中').toBe(false);

    await clickEl(projectRows()[0]); // 点回全部项目
    rows = projectRows();
    expect(isSel(rows[0]), '全部项目复选').toBe(true);
    expect(isSel(rows[1])).toBe(false);
    expect(isSel(rows[2])).toBe(false);
  });
});

describe('W-B live 保活：选中项目跨隐藏/重现保持（reducer 持有）', () => {
  test('选中 Alpha → active=false → active=true：Alpha 仍选中，未回落全部项目', async () => {
    const { bridge } = makeBridge([PA, PB]);
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true }));
    await clickEl(projectRows()[1]); // 选 Alpha
    expect(isSel(projectRows()[1])).toBe(true);

    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: false })); // 隐藏
    await rerender(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge, active: true })); // 重现

    const rows = projectRows();
    expect(isSel(rows[0]), '未回落全部项目').toBe(false);
    expect(isSel(rows[1]), 'Alpha 高亮保持').toBe(true);
  });
});

describe('W-B 静态守卫：缺省 selectedProjectHash → 全部项目选中（golden 契约恒等）', () => {
  const staticChat = {
    banner: false,
    selected: null,
    search: null,
    projects: [
      { projectHash: 'ph-a', displayPath: '/tmp/Alpha', displayName: 'Alpha', sessionCount: 1, totalSize: 100, lastActivity: '2026-07-11T00:00:00.000Z' },
    ],
    sessions: [],
    messages: [],
  };
  function renderStatic(chat: Record<string, unknown>): { rows: Element[]; html: string } {
    const html = renderToStaticMarkup(
      createElement(ChatHistoryScreen, { fx: { id: 'static', theme: 'dark', screen: 'chat-history', chat } }),
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return { rows: Array.from(doc.querySelectorAll('.project-list__item')), html };
  }

  test('无 fx.live + 缺省 payload：「全部项目」带 --selected、项目行不带（字节恒等）', () => {
    const { rows, html } = renderStatic(staticChat);
    expect(rows.length).toBe(2); // 全部项目 + Alpha
    expect(isSel(rows[0]), '全部项目选中').toBe(true);
    expect(isSel(rows[1]), 'Alpha 项目行不选中').toBe(false);
    // 与冻结 golden 同字节：首行恰为 `project-list__item project-list__item--selected`（class 顺序不变）。
    expect(html).toContain('class="project-list__item project-list__item--selected"');
    expect(html.match(/project-list__item--selected/g)?.length).toBe(1);
  });

  test('静态显式 selectedProjectHash：绑定为纯函数（非 live 门控），高亮跟随该 hash', () => {
    const { rows } = renderStatic({ ...staticChat, selectedProjectHash: 'ph-a' });
    expect(isSel(rows[0]), '全部项目此时失选').toBe(false);
    expect(isSel(rows[1]), 'Alpha 项目行选中').toBe(true);
  });
});
