// @vitest-environment jsdom
//
// M6 批A worktree 浮层 live 交互（真实 live 宿主，照 rename-interaction 骨架）：
//   按钮点击开浮层且不冒泡 tileClick；loading→ready 渲染 fx；error "Not a git repository"；
//   warning 横幅；行点击 → create{cwd}+renameSubmit{branch}（不发 close）；✕ → worktreeRemove
//   + 二次 worktreeStatus 刷新；create → worktreeCreate→create→rename 链（不发 close，裁决回归点）；
//   creating 禁用；Esc/overlay mousedown 关；overlay data-hit-island；截图模式按钮 inert。
// jsdom getBoundingClientRect 恒 0 → 锚定只断渲染存在，不断几何。
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

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'wt-live',
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

const WORKTREES = [
  { path: '/repo', branch: 'main', isMain: true, isMerged: false },
  { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false, isMerged: true },
];

interface FsOpts {
  isRepo?: boolean;
  warning?: { sizeMB: number };
  worktrees?: typeof WORKTREES;
  statusRejected?: string;
  createRejected?: string;
}

function makeFs(opts: FsOpts = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async (req: FsRequest): Promise<FsResponse> => {
    if (req.kind === 'worktreeStatus') {
      if (opts.statusRejected)
        return { kind: 'rejected', code: 'internal', message: opts.statusRejected };
      if (opts.isRepo === false) return { kind: 'worktreeStatus', isRepo: false, worktrees: [] };
      return {
        kind: 'worktreeStatus',
        isRepo: true,
        repoPath: '/repo',
        warning: opts.warning,
        worktrees: opts.worktrees ?? WORKTREES,
      };
    }
    if (req.kind === 'worktreeCreate') {
      if (opts.createRejected)
        return { kind: 'rejected', code: 'timeout', message: opts.createRejected };
      return { kind: 'worktreeCreated', worktreePath: '/repo/.worktrees/wt-1', branch: 'wt-1' };
    }
    if (req.kind === 'worktreeRemove') return { kind: 'worktreeRemoved' };
    return { kind: 'rejected', code: 'internal', message: 'unexpected' };
  });
}

function makeTermReq(): ReturnType<typeof vi.fn> {
  let n = 0;
  return vi.fn(async (req: TermCommandRequest): Promise<TermCommandResponse> => {
    if (req.kind === 'create') return { kind: 'created', terminalId: `new${++n}`, pid: 1000 + n };
    return { kind: 'rejected', code: 'internal', message: 'unexpected' };
  });
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

function worktreeBtn(): HTMLElement {
  const b = document.querySelector<HTMLElement>('.tile-worktree-btn');
  expect(b).not.toBeNull();
  return b!;
}
function popover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.worktree-popover');
}
async function openPopover(): Promise<void> {
  await act(async () => {
    worktreeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
}
function actionsOf(onAction: ReturnType<typeof vi.fn>, kind: string): any[] {
  return onAction.mock.calls.map((c) => c[0]).filter((a) => a?.kind === kind);
}
function fsCalls(fs: ReturnType<typeof vi.fn>, kind: string): any[] {
  return fs.mock.calls.map((c) => c[0]).filter((r) => r?.kind === kind);
}
function termCalls(t: ReturnType<typeof vi.fn>, kind: string): any[] {
  return t.mock.calls.map((c) => c[0]).filter((r) => r?.kind === kind);
}

describe('M6 批A worktree 浮层 live', () => {
  test('按钮点击开浮层且不冒泡 tileClick；loading→ready 渲染 worktree 列表', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(baseFixture(), {
      onAction,
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    expect(popover()).toBeNull();
    await openPopover();
    expect(popover(), '点击 worktree 按钮应开浮层').not.toBeNull();
    expect(actionsOf(onAction, 'tileClick').length, '按钮点击不得选中 tile').toBe(0);
    // worktreeStatus 一发
    expect(fsCalls(fs, 'worktreeStatus').length).toBe(1);
    // ready：列表含 main + feat 两行
    const branches = Array.from(document.querySelectorAll('.worktree-popover__branch')).map(
      (e) => e.textContent,
    );
    expect(branches).toContain('main');
    expect(branches).toContain('feat');
    // merged 行有删除 ✕
    expect(document.querySelector('.worktree-popover__delete')).not.toBeNull();
  });

  test('isRepo:false → error "Not a git repository"', async () => {
    const fs = makeFs({ isRepo: false });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    const err = document.querySelector('.worktree-popover__error');
    expect(err?.textContent).toBe('Not a git repository');
    expect(document.querySelector('.worktree-popover__list')).toBeNull();
  });

  test('rejected → error 显示 message', async () => {
    const fs = makeFs({ statusRejected: '权限不足' });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    expect(document.querySelector('.worktree-popover__error')?.textContent).toBe('权限不足');
  });

  test('warning 横幅（大仓）', async () => {
    const fs = makeFs({ warning: { sizeMB: 512 } });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    const w = document.querySelector('.worktree-popover__warning');
    expect(w?.textContent).toContain('512 MB');
  });

  test('行点击 → create{cwd} + renameSubmit{branch}，全链不发 close', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    const term = makeTermReq();
    const termCmd = vi.fn();
    await mount(baseFixture(), {
      onAction,
      onTermCommand: termCmd,
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    // 点 feat 行（非主）
    const items = Array.from(document.querySelectorAll<HTMLElement>('.worktree-popover__item'));
    const featItem = items.find((el) => el.textContent?.includes('feat'))!;
    await act(async () => {
      featItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    const creates = termCalls(term, 'create');
    expect(creates.length).toBe(1);
    expect(creates[0].cwd).toBe('/repo/.worktrees/feat');
    const renames = actionsOf(onAction, 'renameSubmit');
    expect(renames.length).toBe(1);
    expect(renames[0].name).toBe('feat');
    expect(renames[0].terminalId).toBe('new1');
    // 回归断言点：全链不发 close（onTermRequest 与 onTermCommand 均无 close）
    expect(termCalls(term, 'close').length).toBe(0);
    expect(termCmd.mock.calls.filter((c) => (c[0] as any)?.kind === 'close').length).toBe(0);
    // 成功后关浮层
    expect(popover()).toBeNull();
  });

  test('✕ 删除 merged → worktreeRemove + 二次 worktreeStatus 刷新（不关浮层）', async () => {
    const fs = makeFs();
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    expect(fsCalls(fs, 'worktreeStatus').length).toBe(1);
    const del = document.querySelector<HTMLElement>('.worktree-popover__delete')!;
    await act(async () => {
      del.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(fsCalls(fs, 'worktreeRemove').length).toBe(1);
    expect(fsCalls(fs, 'worktreeRemove')[0].worktreePath).toBe('/repo/.worktrees/feat');
    // 重发 worktreeStatus 刷列表
    expect(fsCalls(fs, 'worktreeStatus').length).toBe(2);
    // 不关浮层
    expect(popover()).not.toBeNull();
  });

  test('创建 → worktreeCreate→create→rename 链 + creating 禁用；全链不发 close', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    const term = makeTermReq();
    await mount(baseFixture(), {
      onAction,
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const createBtn = document.querySelector<HTMLButtonElement>('.worktree-popover__create')!;
    expect(createBtn.disabled).toBe(false);
    await act(async () => {
      createBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(fsCalls(fs, 'worktreeCreate').length).toBe(1);
    expect(fsCalls(fs, 'worktreeCreate')[0].repoPath).toBe('/repo');
    const creates = termCalls(term, 'create');
    expect(creates.length).toBe(1);
    expect(creates[0].cwd).toBe('/repo/.worktrees/wt-1');
    const renames = actionsOf(onAction, 'renameSubmit');
    expect(renames.length).toBe(1);
    expect(renames[0].name).toBe('wt-1');
    expect(termCalls(term, 'close').length).toBe(0);
  });

  test('creating 失败 → 恢复可点 + error 显示 message', async () => {
    const fs = makeFs({ createRejected: '.git 仓库过大，创建超时' });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    const createBtn = document.querySelector<HTMLButtonElement>('.worktree-popover__create')!;
    await act(async () => {
      createBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(document.querySelector('.worktree-popover__error')?.textContent).toBe(
      '.git 仓库过大，创建超时',
    );
  });

  test('MINOR-2 回归：worktreeCreate 成功但开终端 rejected → creating 解禁 + error 显示', async () => {
    const fs = makeFs();
    const term = vi.fn(async (req: TermCommandRequest): Promise<TermCommandResponse> => {
      if (req.kind === 'create') return { kind: 'rejected', code: 'internal', message: 'spawn 失败' };
      return { kind: 'rejected', code: 'internal', message: 'unexpected' };
    });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const createBtn = document.querySelector<HTMLButtonElement>('.worktree-popover__create')!;
    await act(async () => {
      createBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    // 修复前：worktreeCreate 成功路径未清 creating → 按钮永久 disabled（只能重开 popover）
    expect(createBtn.disabled).toBe(false);
    expect(document.querySelector('.worktree-popover__error')?.textContent).toBe('spawn 失败');
  });

  // F-D：三条残余静默口改可见错误态（此前 makeTermReq 从不 reject/抛，行点击失败链全无覆盖）。
  test('F-D 行点击 onTermRequest 抛异常 → .catch → 可见「创建终端失败（桥接异常）」', async () => {
    const fs = makeFs();
    const term = vi.fn(async (_req: TermCommandRequest): Promise<TermCommandResponse> => {
      throw new Error('bridge transport down');
    });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const featItem = Array.from(
      document.querySelectorAll<HTMLElement>('.worktree-popover__item'),
    ).find((el) => el.textContent?.includes('feat'))!;
    await act(async () => {
      featItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(document.querySelector('.worktree-popover__error')?.textContent).toBe(
      '创建终端失败（桥接异常）',
    );
  });

  test('F-D 行点击得未知应答态（非 created/rejected）→ else 兜底 → 可见「创建终端失败（未知响应）」', async () => {
    const fs = makeFs();
    const term = vi.fn(async (_req: TermCommandRequest): Promise<TermCommandResponse> => {
      return { kind: 'closed', terminalId: 'stray' }; // create 请求不应回 closed → 未知态
    });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const featItem = Array.from(
      document.querySelectorAll<HTMLElement>('.worktree-popover__item'),
    ).find((el) => el.textContent?.includes('feat'))!;
    await act(async () => {
      featItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(document.querySelector('.worktree-popover__error')?.textContent).toBe(
      '创建终端失败（未知响应）',
    );
  });

  test('F-D 行点击得 rejected(invalidCwd) → 可见 rejected message（补 makeTermReq 从不 reject 的洞）', async () => {
    const fs = makeFs();
    const term = vi.fn(async (_req: TermCommandRequest): Promise<TermCommandResponse> => {
      return { kind: 'rejected', code: 'invalidCwd', message: 'worktree 目录不存在或不可用' };
    });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const featItem = Array.from(
      document.querySelectorAll<HTMLElement>('.worktree-popover__item'),
    ).find((el) => el.textContent?.includes('feat'))!;
    await act(async () => {
      featItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(document.querySelector('.worktree-popover__error')?.textContent).toBe(
      'worktree 目录不存在或不可用',
    );
  });

  test('F-D2 stale 行：missing worktree 渲染 --missing 灰化 + 「（目录已删除）」后缀，仍可点', async () => {
    const fs = vi.fn(async (req: FsRequest): Promise<FsResponse> => {
      if (req.kind === 'worktreeStatus') {
        return {
          kind: 'worktreeStatus',
          isRepo: true,
          repoPath: '/repo',
          worktrees: [
            { path: '/repo', branch: 'main', isMain: true, isMerged: false },
            {
              path: '/repo/.worktrees/gone',
              branch: 'gone',
              isMain: false,
              isMerged: true,
              missing: true,
            },
          ],
        };
      }
      return { kind: 'rejected', code: 'internal', message: 'unexpected' };
    });
    const term = makeTermReq();
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.worktree-popover__item'));
    const goneItem = items.find((el) => el.textContent?.includes('gone'))!;
    const mainItem = items.find((el) => el.textContent?.includes('main'))!;
    // stale 行灰化类 + 目录已删除后缀；非 stale 行（main）无灰化类。
    expect(goneItem.classList.contains('worktree-popover__item--missing')).toBe(true);
    expect(goneItem.textContent).toContain('（目录已删除）');
    expect(mainItem.classList.contains('worktree-popover__item--missing')).toBe(false);
    // 仍可点：点 stale 行 → openTerminalAt 走 create（未被禁用），cwd 即该 wt 路径。
    await act(async () => {
      goneItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(termCalls(term, 'create').length).toBe(1);
    expect(termCalls(term, 'create')[0].cwd).toBe('/repo/.worktrees/gone');
  });

  test('dogfood-r2#4 真机序列：行 mousedown 冒泡不得关浮层，三连后 create{cwd} 发出', async () => {
    // 根因 A 回归网：真机 WebKit 是 mousedown→mouseup→click 三连。修复前 mousedown 冒泡到
    // overlay（浮层父元素）即 onClose 卸载浮层，click 落在已卸载节点 → 行点击真机必死，
    // 而裸 click 派发测不出（F-D 轮全绿假信心）。
    const onAction = vi.fn();
    const fs = makeFs();
    const term = makeTermReq();
    await mount(baseFixture(), {
      onAction,
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.worktree-popover__item'));
    const featItem = items.find((el) => el.textContent?.includes('feat'))!;
    await act(async () => {
      featItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(popover(), '行 mousedown 冒泡不得关浮层（overlay 仅背景直落才关）').not.toBeNull();
    await act(async () => {
      featItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      featItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
    const creates = termCalls(term, 'create');
    expect(creates.length, '三连后行点击须发 create').toBe(1);
    expect(creates[0].cwd).toBe('/repo/.worktrees/feat');
    expect(actionsOf(onAction, 'renameSubmit').length).toBe(1);
  });

  test('dogfood-r2#4 真机序列：+ New Worktree 三连 → worktreeCreate 发出', async () => {
    const fs = makeFs();
    const term = makeTermReq();
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const createBtn = document.querySelector<HTMLButtonElement>('.worktree-popover__create')!;
    await act(async () => {
      createBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(popover(), '按钮 mousedown 冒泡不得关浮层').not.toBeNull();
    await act(async () => {
      createBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      createBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(fsCalls(fs, 'worktreeCreate').length, '三连后须发 worktreeCreate').toBe(1);
  });

  test('overlay 带 data-hit-island；点 overlay / Esc 关浮层', async () => {
    const fs = makeFs();
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    const overlay = document.querySelector<HTMLElement>('.worktree-popover-overlay')!;
    expect(overlay.hasAttribute('data-hit-island')).toBe(true);
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flush(1);
    expect(popover(), '点 overlay 应关').toBeNull();

    // 重开后 Esc 关
    await openPopover();
    expect(popover()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush(1);
    expect(popover(), 'Esc 应关').toBeNull();
  });

  test('截图模式（无 provider）worktree 按钮 inert，点击不开浮层', async () => {
    await mount(baseFixture());
    await act(async () => {
      const b = document.querySelector<HTMLElement>('.tile-worktree-btn');
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush(1);
    expect(popover()).toBeNull();
  });
});

// 收起终端（批A）不进 `.tile` DOM 集合 → 「fx.terminals 全量下标」≠「可见 tile 下标」。
// 旧实现 querySelectorAll('.tile')[tileIndex] 越界 → 弹窗永不渲染（点了没反应）；
// 错位命中别的 tile → 弹窗贴到别处（飘远）。修复 = data-terminal-id 按 ID 锚定。
describe('worktree 弹窗锚定：收起终端下标错位回归（fix/worktree-popover-anchor）', () => {
  function stubRect(el: Element, r: { left: number; bottom: number }): void {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        x: r.left,
        y: r.bottom - 16,
        top: r.bottom - 16,
        left: r.left,
        bottom: r.bottom,
        right: r.left + 20,
        width: 20,
        height: 16,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }

  const wires = (): Wires => ({
    onAction: vi.fn(),
    onTermCommand: vi.fn(),
    onFsRequest: makeFs() as any,
    onTermRequest: makeTermReq() as any,
  });

  test('收起终端排在前（下标越界）：点唯一可见 tile 的按钮，弹窗仍须渲染', async () => {
    await mount(
      baseFixture({
        terminals: [
          { id: 't0', state: 'Running', cwd: '/other', isGitRepo: true, minimized: true },
          { id: 't1', state: 'Running', cwd: '/repo', isGitRepo: true },
        ],
      } as Partial<Fixture>),
      wires(),
    );
    // 前提自证：收起项走 .min-card，DOM 只有 1 个 .tile
    expect(document.querySelectorAll('.tile').length).toBe(1);
    await openPopover();
    expect(popover(), '有收起终端在前时弹窗仍须渲染（旧实现下标越界永不渲染）').not.toBeNull();
  });

  test('收起终端在前 + 两可见 tile（下标错位）：弹窗锚在被点按钮的 rect 而非邻 tile', async () => {
    await mount(
      baseFixture({
        terminals: [
          { id: 't0', state: 'Running', cwd: '/other', isGitRepo: true, minimized: true },
          { id: 't1', state: 'Running', cwd: '/repo', isGitRepo: true },
          { id: 't2', state: 'Running', cwd: '/repo2', isGitRepo: true },
        ],
      } as Partial<Fixture>),
      wires(),
    );
    const tiles = document.querySelectorAll<HTMLElement>('.tile');
    expect(tiles.length).toBe(2);
    const btn1 = tiles[0].querySelector<HTMLElement>('.tile-worktree-btn')!;
    const btn2 = tiles[1].querySelector<HTMLElement>('.tile-worktree-btn')!;
    stubRect(btn1, { left: 100, bottom: 50 });
    stubRect(btn2, { left: 700, bottom: 50 });
    await act(async () => {
      btn1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
    const p = popover();
    expect(p).not.toBeNull();
    // 旧实现 tileIndex=1（全量下标）→ 量到 t2 按钮 rect（left 700）
    expect(p!.style.left, '弹窗须贴被点按钮（t1）的 left').toBe('100px');
    expect(p!.style.top).toBe('54px'); // bottom 50 + 4
  });
});

describe('worktree 自定义名显示（worktree-popover §5）', () => {
  const NAMED_WORKTREES = [
    { path: '/repo', branch: 'main', isMain: true, isMerged: false },
    { path: '/repo/.worktrees/wt-19', branch: 'wt-19', isMain: false, isMerged: false, customName: 'liukun降权限' },
    { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false, isMerged: true },
  ];

  test('WT_NAME_popover_shows_custom_name：行主显自定义名 + __branch-code 小字 = 分支名', async () => {
    const fs = makeFs({ worktrees: NAMED_WORKTREES });
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.worktree-popover__item'));
    const named = items.find((el) => el.textContent?.includes('liukun降权限'))!;
    expect(named).not.toBeUndefined();
    const branchSpan = named.querySelector('.worktree-popover__branch')!;
    expect(branchSpan.textContent).toBe('liukun降权限wt-19'); // 主显名 + 弱化小字拼接
    expect(named.querySelector('.worktree-popover__branch-code')?.textContent).toBe('wt-19');
    // 无 customName 行不受影响。
    const feat = items.find((el) => el.textContent?.includes('feat'))!;
    expect(feat.querySelector('.worktree-popover__branch-code')).toBeNull();
  });

  test('WT_NAME_popover_absent_dom_unchanged：全行无 customName → 零 __branch-code 节点，__branch 文本 = 分支名（golden 恒等面）', async () => {
    const fs = makeFs(); // 默认 WORKTREES 不含 customName
    await mount(baseFixture(), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: makeTermReq() as any,
    });
    await openPopover();
    expect(document.querySelectorAll('.worktree-popover__branch-code').length).toBe(0);
    const texts = Array.from(document.querySelectorAll('.worktree-popover__branch')).map(
      (el) => el.textContent,
    );
    expect(texts).toEqual(['main', 'feat']);
  });

  test('WT_NAME_item_click_names_custom：点击带 customName 的行 → renameSubmit.name = customName（非 branch）', async () => {
    const onAction = vi.fn();
    const fs = makeFs({ worktrees: NAMED_WORKTREES });
    const term = makeTermReq();
    await mount(baseFixture(), {
      onAction,
      onTermCommand: vi.fn(),
      onFsRequest: fs as any,
      onTermRequest: term as any,
    });
    await openPopover();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.worktree-popover__item'));
    const named = items.find((el) => el.textContent?.includes('liukun降权限'))!;
    await act(async () => {
      named.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    const creates = termCalls(term, 'create');
    expect(creates.length).toBe(1);
    expect(creates[0].cwd).toBe('/repo/.worktrees/wt-19');
    const renames = actionsOf(onAction, 'renameSubmit');
    expect(renames.length).toBe(1);
    expect(renames[0].name).toBe('liukun降权限');
  });
});
