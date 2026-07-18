// @vitest-environment jsdom
//
// 视图切换幽灵钮 web 半（term-list-mode.md §1.1 案例池 TG_LIST_toggle_button）。断言面 = 真实工件
// ViewToggleGhost（经 TermGrid/TermListLayout 挂载）+ TerminalScreen（live provider 才渲——照
// tile-minimize-btn 先例）。live-only 门控是 golden 96 张零 diff 的关键，故截图态（无 provider）单列一案。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TermGrid } from '../src/grid/TermGrid';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type {
  FsResponse,
  TermCommandRequest,
  TermCommandResponse,
  UIAction,
} from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'view-toggle-ghost',
    theme: 'dark',
    homePath: '/Users/rl',
    viewMode: 'Tiling',
    focusedId: null,
    selectedId: 't1',
    activeSidebarId: null,
    maxReached: false,
    dragging: null,
    dragOver: null,
    editing: null,
    waitingNotification: null,
    searchBar: null,
    palette: { background: '#1e1e1e', foreground: '#cccccc' },
    terminals: [
      { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
    ],
    ...over,
  } as Fixture;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
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

async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** live 全接线宿主（TerminalScreen → LiveInteractionLayer provider → 幽灵钮才渲）。 */
async function mountScreen(fx: Fixture, onAction = vi.fn()): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onFsRequest = vi.fn(async (): Promise<FsResponse> => ({ kind: 'rejected', code: 'internal', message: 'x' }));
  const onTermRequest = vi.fn(async (): Promise<TermCommandResponse> => ({ kind: 'created', terminalId: 'n', pid: 1 }));
  await act(async () => {
    root!.render(
      createElement(TerminalScreen, {
        fx,
        onAction,
        onTermCommand: vi.fn() as (r: TermCommandRequest) => void,
        onFsRequest: onFsRequest as never,
        onTermRequest: onTermRequest as never,
      }),
    );
  });
  await flush();
}

/** 截图/纯展示（无 provider）：直渲 TermGrid，useLiveInteractions()=null → 幽灵钮不挂。 */
async function mountGrid(fx: Fixture): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TermGrid, { fx, onAction: vi.fn(), onTermCommand: vi.fn() }));
  });
  await flush();
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.className = '';
});

function actionsOf(onAction: ReturnType<typeof vi.fn>, kind: string): UIAction[] {
  return onAction.mock.calls.map((c) => c[0]).filter((a) => a?.kind === kind);
}
function ghost(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.view-toggle-ghost');
}

describe('TG_LIST_toggle_button 视图切换幽灵钮（web 半，term-list-mode §1.1）', () => {
  test('Tiling：渲 ☰（ListIcon）、挂 data-hit-island、title=切换到列表模式；点击发 toggleListMode', async () => {
    const onAction = vi.fn();
    await mountScreen(fixture({ viewMode: 'Tiling' }), onAction);
    const btn = ghost();
    expect(btn, 'Tiling 渲幽灵钮').not.toBeNull();
    expect(btn!.hasAttribute('data-hit-island'), '挂命中岛（浮层不穿透 Metal）').toBe(true);
    expect(btn!.getAttribute('title')).toBe('切换到列表模式');
    // ☰ = ListIcon（1 rect + 3 line）；区别于 ▦ = GridIcon（4 rect / 0 line）
    expect(btn!.querySelectorAll('svg line').length, 'ListIcon 三行').toBe(3);
    expect(btn!.querySelectorAll('svg rect').length, 'ListIcon 单选中条').toBe(1);
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(actionsOf(onAction, 'toggleListMode').length, '发 toggleListMode').toBe(1);
  });

  test('List：同位置渲 ▦（GridIcon）、title=切换到平铺模式；点击发同一 toggleListMode', async () => {
    const onAction = vi.fn();
    await mountScreen(fixture({ viewMode: 'List' }), onAction);
    const btn = ghost();
    expect(btn, 'List 渲幽灵钮').not.toBeNull();
    expect(btn!.getAttribute('title')).toBe('切换到平铺模式');
    // ▦ = GridIcon（4 rect / 0 line）
    expect(btn!.querySelectorAll('svg rect').length, 'GridIcon 四格').toBe(4);
    expect(btn!.querySelectorAll('svg line').length, 'GridIcon 无线').toBe(0);
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(actionsOf(onAction, 'toggleListMode').length, 'List 亦发 toggleListMode（同一动作）').toBe(1);
  });

  test('Focused：不渲（聚焦自带回平铺钮）', async () => {
    await mountScreen(fixture({ viewMode: 'Focused', focusedId: 't1' }));
    expect(ghost(), 'Focused 无幽灵钮').toBeNull();
  });

  test('live-only：截图/纯展示（无 provider）不渲 → golden 零 diff 的门控证', async () => {
    await mountGrid(fixture({ viewMode: 'Tiling' }));
    expect(document.querySelector('.terminal-grid'), '网格照渲').not.toBeNull();
    expect(ghost(), '截图态无幽灵钮（live 门控）').toBeNull();
    // List 态截图同样不渲（同一门控）
    await act(async () => {
      root!.render(createElement(TermGrid, { fx: fixture({ viewMode: 'List' }), onAction: vi.fn(), onTermCommand: vi.fn() }));
    });
    await flush(1);
    expect(document.querySelector('.term-list'), 'List 布局照渲').not.toBeNull();
    expect(ghost(), 'List 截图态亦无幽灵钮').toBeNull();
  });
});
