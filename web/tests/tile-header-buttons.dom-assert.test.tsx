// @vitest-environment jsdom
//
// M6 批A tile 头两按钮接线（真实 live 宿主，worktree-live 骨架同款）：
//   live worktree 按钮 onClick → 开浮层且不冒泡 tileClick；live 文件按钮 onClick → fileOpen{terminalId}；
//   文件按钮 tooltip 恒 '文件'；isGitRepo=false → 不渲染 worktree 按钮（回归）；
//   文件按钮右键 → showFileMenu(path=该 tile cwd, isDirectory=true, x, y)；
//   截图模式（无 provider）两按钮 inert（点击不开浮层、不发动作）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type {
  FsRequest,
  FsResponse,
  TermCommandRequest,
  TermCommandResponse,
  UIAction,
} from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'th-live',
    theme: 'dark',
    homePath: '/Users/rl',
    viewMode: 'Tiling',
    focusedId: null,
    selectedId: null,
    activeSidebarId: null,
    maxReached: false,
    dragging: null,
    dragOver: null,
    editing: null,
    waitingNotification: null,
    searchBar: null,
    palette: { background: '#1e1e1e', foreground: '#cccccc' },
    terminals: [{ id: 't1', state: 'Running', cwd: '/repo', isGitRepo: true }],
    ...over,
  } as Fixture;
}

function makeFs(): ReturnType<typeof vi.fn> {
  return vi.fn(async (req: FsRequest): Promise<FsResponse> => {
    if (req.kind === 'worktreeStatus')
      return { kind: 'worktreeStatus', isRepo: true, repoPath: '/repo', worktrees: [] };
    if (req.kind === 'showFileMenu') return { kind: 'menuAction', action: 'dismissed' };
    return { kind: 'rejected', code: 'internal', message: 'x' };
  });
}
function makeTermReq(): ReturnType<typeof vi.fn> {
  return vi.fn(async (): Promise<TermCommandResponse> => ({
    kind: 'created',
    terminalId: 'n1',
    pid: 1,
  }));
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

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

interface Wires {
  onAction?: (a: UIAction) => void;
  onTermCommand?: (r: TermCommandRequest) => void;
  onFsRequest?: (r: FsRequest) => Promise<FsResponse>;
  onTermRequest?: (r: TermCommandRequest) => Promise<TermCommandResponse>;
}
async function mount(fx: Fixture, w: Wires = {}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TerminalScreen, { fx, ...w }));
  });
  await flush();
}
/** live 全接线宿主（两按钮 onClick 挂载所需）。 */
function liveWires(onAction = vi.fn(), fs = makeFs()): Required<Wires> & { onAction: typeof onAction } {
  return {
    onAction,
    onTermCommand: vi.fn(),
    onFsRequest: fs as any,
    onTermRequest: makeTermReq() as any,
  };
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = '';
  document.body.className = '';
});

function worktreeBtn(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.tile-worktree-btn');
}
function fileBtn(): HTMLElement {
  const b = document.querySelector<HTMLElement>('.tile-file-btn');
  expect(b).not.toBeNull();
  return b!;
}
function actionsOf(onAction: ReturnType<typeof vi.fn>, kind: string): any[] {
  return onAction.mock.calls.map((c) => c[0]).filter((a) => a?.kind === kind);
}

describe('M6 批A tile 头两按钮', () => {
  test('live worktree 按钮点击 → 开浮层，不冒泡 tileClick', async () => {
    const onAction = vi.fn();
    await mount(fixture(), liveWires(onAction));
    expect(document.querySelector('.worktree-popover')).toBeNull();
    await act(async () => {
      worktreeBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(document.querySelector('.worktree-popover'), '点 worktree 按钮开浮层').not.toBeNull();
    expect(actionsOf(onAction, 'tileClick').length, 'stopPropagation：不选中 tile').toBe(0);
  });

  test('live 文件按钮点击 → fileOpen{terminalId}，不冒泡 tileClick', async () => {
    const onAction = vi.fn();
    await mount(fixture(), liveWires(onAction));
    await act(async () => {
      fileBtn().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const opens = actionsOf(onAction, 'fileOpen');
    expect(opens.length).toBe(1);
    expect(opens[0].terminalId).toBe('t1');
    expect(actionsOf(onAction, 'tileClick').length).toBe(0);
  });

  test('文件按钮 tooltip 恒 "文件"（live 与静态均是）', async () => {
    await mount(fixture(), liveWires());
    expect(fileBtn().getAttribute('title')).toBe('文件');
    await act(async () => {
      root?.unmount();
    });
    // 静态（无 provider）
    await mount(fixture());
    expect(fileBtn().getAttribute('title')).toBe('文件');
  });

  test('isGitRepo=false → 不渲染 worktree 按钮（回归）；true → 渲染', async () => {
    await mount(fixture({ terminals: [{ id: 't1', state: 'Running', cwd: '/repo', isGitRepo: false }] as any }), liveWires());
    expect(worktreeBtn(), 'isGitRepo=false 无 worktree 按钮').toBeNull();
    expect(fileBtn(), '文件按钮不受 isGitRepo 门控').not.toBeNull();
    await act(async () => {
      root?.unmount();
    });
    await mount(fixture(), liveWires());
    expect(worktreeBtn(), 'isGitRepo=true 渲染 worktree 按钮').not.toBeNull();
  });

  test('文件按钮右键 → showFileMenu(path=该 tile cwd, isDirectory=true, x, y)', async () => {
    const fs = makeFs();
    await mount(fixture(), liveWires(vi.fn(), fs));
    await act(async () => {
      fileBtn().dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 34 }),
      );
    });
    await flush(1);
    const menu = fs.mock.calls.map((c) => c[0]).filter((r) => (r as any)?.kind === 'showFileMenu');
    expect(menu.length).toBe(1);
    expect((menu[0] as any).path).toBe('/repo'); // tile cwd
    expect((menu[0] as any).isDirectory).toBe(true);
    expect((menu[0] as any).x).toBe(12);
    expect((menu[0] as any).y).toBe(34);
  });

  test('截图模式（无 provider）两按钮 inert：点击不开浮层、右键不发菜单', async () => {
    await mount(fixture());
    await act(async () => {
      worktreeBtn()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fileBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      fileBtn().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(document.querySelector('.worktree-popover'), '静态 worktree 按钮 inert').toBeNull();
    // 无 onAction/onFsRequest 注入 → 无副作用可断言；此处以「无浮层 + 无抛错」证 inert
  });
});
