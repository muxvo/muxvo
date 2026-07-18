// @vitest-environment jsdom
//
// FILE 域 spec-ID 翻牌锚（M6 批3 翻牌欠账）：批A 已在 main 落地文件面板 live 功能，本文件补 spec-ID 锚。
// 真实 live 宿主（TerminalScreen）+ caseOf 断言 spec 期望字段 + DOM 断言真渲染路径。
//   FILE_L1_12 滑入动画：mount 初帧无 --open（translateX(100%)）→ 下一帧 rAF 后有 --open（translateX(0)）。
//   FILE_L1_15 打开状态机：filePanel null(Closed)→挂载(Opening,无 --open)→rAF 后(Open,--open)。
//   FILE_L1_16 切目录无动画：同 terminalId 下 tile.cwd A→B（key 不变 → 不 remount → --open 恒在，无滑入重放）。
//   FILE_L1_29 切目录换内容：同上机制，断内容（条目集）随 tile.cwd 换到 B 目录。
//   FILE_L1_18 三路关闭：✕ / Esc / 点外 overlay 各发一次 fileClose（Closing→Closed 由 native 卸载，as-built 无退出动画）。
// 说明（16/29）：as-built LiveFilePanel 由 fx.filePanel.terminalId 作 key；切「另一终端」会换 key→remount+重放滑入，
//   故「无动画切目录」= 面板 root 跟 tile.cwd 走（批A §0.5「终端里 cd → cwd 变 → 树重载」），同 terminalId 原地换目录不 remount。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fileSpec from '../../specs/legacy/l1/file.spec.json';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { FsRequest, FsResponse, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SpecCase = Record<string, any>;
function caseOf(id: string): SpecCase {
  const c = (fileSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'fp-flip',
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
    terminals: [{ id: 't1', state: 'Running', cwd: '/projA' }],
    filePanel: { terminalId: 't1' },
    ...over,
  } as Fixture;
}

// /projA 有 alpha.txt；/projB 有 beta.txt（切目录内容判别用）。
const DIRS: Record<string, FsResponse> = {
  '/projA': { kind: 'dir', entries: [{ name: 'alpha.txt', isDirectory: false, size: 3 }] },
  '/projB': { kind: 'dir', entries: [{ name: 'beta.txt', isDirectory: false, size: 4 }] },
};
function makeFs(dirs: Record<string, FsResponse> = DIRS): ReturnType<typeof vi.fn> {
  return vi.fn(async (req: FsRequest): Promise<FsResponse> => {
    if (req.kind === 'readDir') return dirs[req.path] ?? { kind: 'dir', entries: [] };
    if (req.kind === 'showFileMenu') return { kind: 'menuAction', action: 'dismissed' };
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

/** 只 render 不 flush rAF（保留 mount 初帧，供动画类断言）。 */
async function render(
  fx: Fixture,
  onAction: (a: UIAction) => void,
  fs: (r: FsRequest) => Promise<FsResponse>,
): Promise<void> {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(
      createElement(TerminalScreen, { fx, onAction, onTermCommand: vi.fn(), onFsRequest: fs as any }),
    );
  });
}

async function mount(
  fx: Fixture,
  onAction: (a: UIAction) => void,
  fs: (r: FsRequest) => Promise<FsResponse>,
): Promise<void> {
  await render(fx, onAction, fs);
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

/** 把 requestAnimationFrame 换成手动触发版：render 后 rAF 回调不自动跑（beforeEach 的 setTimeout 版会在 act
 *  的 await 间隙触发，观察不到滑入初帧）。返回 fire()：在 act 内一次性放行所有已捕获回调。 */
function captureRaf(): () => Promise<void> {
  const cbs: FrameRequestCallback[] = [];
  (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
    (cb) => cbs.push(cb);
  return async () => {
    await act(async () => {
      cbs.splice(0).forEach((cb) => cb(0));
    });
  };
}

const panel = (): HTMLElement | null => document.querySelector<HTMLElement>('.file-panel');
function names(): string[] {
  return Array.from(document.querySelectorAll('.file-item__name')).map((e) => e.textContent ?? '');
}
function actionsOf(onAction: ReturnType<typeof vi.fn>, kind: string): any[] {
  return onAction.mock.calls.map((c) => c[0]).filter((a) => a?.kind === kind);
}

test('FILE_L1_12: 文件面板滑入动画 —— 初帧无 --open（translateX(100%)）→ 下一帧 --open（translateX(0)），自右侧滑入', async () => {
  const c = caseOf('FILE_L1_12');
  expect(c.expectedCSS.from).toBe('translateX(100%)');
  expect(c.expectedCSS.to).toBe('translateX(0)');
  expect(c.expectedCSS.direction).toBe('from right');

  // 初帧（rAF 未触发）：面板已挂载但无 --open → translateX(100%)。
  const fireRaf = captureRaf();
  await render(fixture(), vi.fn(), makeFs() as any);
  expect(panel(), '面板初帧即挂载').not.toBeNull();
  expect(panel()!.classList.contains('file-panel--open'), '初帧无 --open → translateX(100%)').toBe(false);

  // 下一帧 rAF 后：加 --open → translateX(0)。
  await fireRaf();
  expect(panel()!.classList.contains('file-panel--open'), 'rAF 后 --open → translateX(0)').toBe(true);
});

test('FILE_L1_15: 打开文件面板 —— Closed(无面板)→Opening(挂载无 --open)→Open(--open)', async () => {
  const c = caseOf('FILE_L1_15');
  expect(c.state).toBe('Closed -> Opening -> Open');

  const fs = makeFs();
  // Closed：filePanel 缺席 → 无面板。
  await mount(fixture({ filePanel: undefined }), vi.fn(), fs as any);
  expect(panel(), 'Closed 态无面板').toBeNull();

  // Opening：filePanel 置位 → 面板挂载，初帧无 --open。
  const fireRaf = captureRaf();
  await render(fixture({ filePanel: { terminalId: 't1' } }), vi.fn(), fs as any);
  expect(panel(), 'Opening 已挂载').not.toBeNull();
  expect(panel()!.classList.contains('file-panel--open'), 'Opening 尚无 --open').toBe(false);

  // Open：rAF 后 --open。
  await fireRaf();
  expect(panel()!.classList.contains('file-panel--open'), 'Open 态 --open').toBe(true);
});

test('FILE_L1_16: 切换终端文件面板 —— 面板 root 跟 tile.cwd 换（同 terminalId 不 remount → --open 恒在，无滑入重放）', async () => {
  const c = caseOf('FILE_L1_16');
  expect(c.state).toBe('Open(A) -> Open(B)');
  expect(c.expectedBehavior).toContain('no animation');

  const fs = makeFs();
  await mount(fixture({ terminals: [{ id: 't1', state: 'Running', cwd: '/projA' }] }), vi.fn(), fs as any);
  const before = panel();
  expect(before!.classList.contains('file-panel--open')).toBe(true);

  // 同 terminalId（key 不变），tile.cwd A→B → 原地换目录。
  await render(fixture({ terminals: [{ id: 't1', state: 'Running', cwd: '/projB' }] }), vi.fn(), fs as any);
  await flush();
  const after = panel();
  expect(after, '同 key 不 remount：面板 DOM 节点同一个（无滑入重放）').toBe(before);
  expect(after!.classList.contains('file-panel--open'), '--open 全程未掉 → 无动画').toBe(true);
});

test('FILE_L1_29: 切换另一终端文件面板 —— 面板内容切换为新目录（root 跟 tile.cwd 换）', async () => {
  const c = caseOf('FILE_L1_29');
  expect(c.state).toBe('Open(A) -> Open(B)');
  expect(c.expectedBehavior).toContain('content switches');

  const fs = makeFs();
  await mount(fixture({ terminals: [{ id: 't1', state: 'Running', cwd: '/projA' }] }), vi.fn(), fs as any);
  expect(names(), 'A 目录内容').toEqual(['alpha.txt']);

  await render(fixture({ terminals: [{ id: 't1', state: 'Running', cwd: '/projB' }] }), vi.fn(), fs as any);
  await flush();
  expect(names(), '内容换为 B 目录').toEqual(['beta.txt']);
  const paths = fs.mock.calls.map((c2) => c2[0]).filter((r) => r?.kind === 'readDir').map((r) => r.path);
  expect(paths, '换目录发新 readDir(/projB)').toContain('/projB');
});

test('FILE_L1_18: 关闭文件面板 —— ✕ / Esc / 点外 overlay 各发一次 fileClose', async () => {
  const c = caseOf('FILE_L1_18');
  expect(c.state).toBe('Open -> Closing -> Closed');

  // ✕
  let onAction = vi.fn();
  await mount(fixture(), onAction, makeFs() as any);
  await act(async () => {
    document.querySelector('.file-panel__close')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(actionsOf(onAction, 'fileClose').length, '✕ → fileClose').toBe(1);
  await act(async () => {
    root?.unmount();
  });
  root = null;

  // Esc
  onAction = vi.fn();
  await mount(fixture(), onAction, makeFs() as any);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(actionsOf(onAction, 'fileClose').length, 'Esc → fileClose').toBe(1);
  await act(async () => {
    root?.unmount();
  });
  root = null;

  // 点外 overlay
  onAction = vi.fn();
  await mount(fixture(), onAction, makeFs() as any);
  await act(async () => {
    document
      .querySelector('.file-panel-overlay')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  expect(actionsOf(onAction, 'fileClose').length, '点外 overlay → fileClose').toBe(1);
});
