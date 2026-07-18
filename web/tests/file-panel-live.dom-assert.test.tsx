// @vitest-environment jsdom
//
// M6 批A 文件面板 live 交互（真实 live 宿主）：
//   fx.filePanel 出现→面板挂载、root readDir 一次；展开目录→子 readDir、缩进+1；折叠再展开→不重拉（cache）；
//   子目录 rejected→静默无子项；showHidden=off 滤点头 / toggle 发 setShowHiddenFiles；
//   关闭钮/Esc/点外 → fileClose；⌘E（web 焦点内）→ fileClose；overlay 岛属性。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { FsRequest, FsResponse, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'fp-live',
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
    terminals: [{ id: 't1', state: 'Running', cwd: '/proj' }],
    filePanel: { terminalId: 't1' },
    ...over,
  } as Fixture;
}

// 目录树：/proj 有 src/(dir) + a.txt + .hidden；/proj/src 有 index.ts
const DIRS: Record<string, FsResponse> = {
  '/proj': {
    kind: 'dir',
    entries: [
      { name: 'src', isDirectory: true },
      { name: 'a.txt', isDirectory: false, size: 10 },
      { name: '.hidden', isDirectory: false, size: 5 },
    ],
  },
  '/proj/src': { kind: 'dir', entries: [{ name: 'index.ts', isDirectory: false, size: 20 }] },
};

interface FsOpts {
  dirs?: Record<string, FsResponse>;
  rejectPaths?: string[];
}
function makeFs(opts: FsOpts = {}): ReturnType<typeof vi.fn> {
  const dirs = opts.dirs ?? DIRS;
  return vi.fn(async (req: FsRequest): Promise<FsResponse> => {
    if (req.kind === 'readDir') {
      if (opts.rejectPaths?.includes(req.path))
        return { kind: 'rejected', code: 'permissionDenied', message: 'denied' };
      return dirs[req.path] ?? { kind: 'dir', entries: [] };
    }
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

async function mount(
  fx: Fixture,
  onAction: (a: UIAction) => void,
  fs: (r: FsRequest) => Promise<FsResponse>,
): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(TerminalScreen, {
        fx,
        onAction,
        onTermCommand: vi.fn(),
        onFsRequest: fs as any,
      }),
    );
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

function names(): string[] {
  return Array.from(document.querySelectorAll('.file-item__name')).map((e) => e.textContent ?? '');
}
function rowByName(name: string): HTMLElement {
  const el = Array.from(document.querySelectorAll<HTMLElement>('.file-item')).find(
    (r) => r.querySelector('.file-item__name')?.textContent === name,
  );
  expect(el, `找不到行 ${name}`).toBeDefined();
  return el!;
}
function readDirCalls(fs: ReturnType<typeof vi.fn>): string[] {
  return fs.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'readDir').map((r) => r.path);
}
function actionsOf(onAction: ReturnType<typeof vi.fn>, kind: string): any[] {
  return onAction.mock.calls.map((c) => c[0]).filter((a) => a?.kind === kind);
}

describe('M6 批A 文件面板 live', () => {
  test('挂载 → root readDir 一次；根条目渲染（showHidden=off 滤点头）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as any);
    expect(document.querySelector('.file-panel')).not.toBeNull();
    expect(readDirCalls(fs)).toEqual(['/proj']);
    // 文件夹优先 + localeCompare；.hidden 被滤
    expect(names()).toEqual(['src', 'a.txt']);
  });

  test('展开目录 → 子 readDir、缩进+1；折叠再展开不重拉（cache）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as any);
    await act(async () => {
      rowByName('src').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(readDirCalls(fs)).toEqual(['/proj', '/proj/src']);
    expect(names()).toContain('index.ts');
    // 子项缩进 +1（indent 0 → paddingLeft 8；indent 1 → 28）
    const child = rowByName('index.ts');
    expect(child.style.paddingLeft).toBe('28px');

    // 折叠
    await act(async () => {
      rowByName('src').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush(1);
    expect(names()).not.toContain('index.ts');
    // 再展开 → cache 命中，不再发 readDir(/proj/src)
    await act(async () => {
      rowByName('src').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(names()).toContain('index.ts');
    expect(readDirCalls(fs).filter((p) => p === '/proj/src').length).toBe(1);
  });

  test('子目录 readDir rejected → 静默无子项（不入面板空态）', async () => {
    const onAction = vi.fn();
    const fs = makeFs({ rejectPaths: ['/proj/src'] });
    await mount(fixture(), onAction, fs as any);
    await act(async () => {
      rowByName('src').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(names()).toEqual(['src', 'a.txt']); // 无子项
    expect(document.querySelector('.file-panel__empty'), '子目录失败不入面板空态').toBeNull();
  });

  test('showHidden=on → 点头条目出现；眼睛 toggle 发 setShowHiddenFiles', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture({ showHiddenFiles: true }), onAction, fs as any);
    expect(names()).toContain('.hidden');
    const toggle = document.querySelector<HTMLElement>('.file-panel__toggle-hidden')!;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const acts = actionsOf(onAction, 'setShowHiddenFiles');
    expect(acts.length).toBe(1);
    expect(acts[0].value).toBe(false); // 当前 on → 翻 off
  });

  test('关闭钮 / Esc / 点外 overlay / ⌘E → fileClose；overlay 岛属性', async () => {
    // 关闭钮
    let onAction = vi.fn();
    await mount(fixture(), onAction, makeFs() as any);
    const overlay = document.querySelector<HTMLElement>('.file-panel-overlay')!;
    expect(overlay.hasAttribute('data-hit-island')).toBe(true);
    await act(async () => {
      document.querySelector('.file-panel__close')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(actionsOf(onAction, 'fileClose').length).toBe(1);
    await act(async () => {
      root?.unmount();
    });

    // Esc
    onAction = vi.fn();
    await mount(fixture(), onAction, makeFs() as any);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(actionsOf(onAction, 'fileClose').length).toBe(1);
    await act(async () => {
      root?.unmount();
    });

    // 点外 overlay
    onAction = vi.fn();
    await mount(fixture(), onAction, makeFs() as any);
    await act(async () => {
      document
        .querySelector('.file-panel-overlay')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(actionsOf(onAction, 'fileClose').length).toBe(1);
    await act(async () => {
      root?.unmount();
    });

    // ⌘E（面板开着 → fileClose）
    onAction = vi.fn();
    await mount(fixture(), onAction, makeFs() as any);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', metaKey: true, bubbles: true }));
    });
    expect(actionsOf(onAction, 'fileClose').length).toBe(1);

    // MINOR-1 回归：⌃E（emacs 行尾键）不触发——处理器只认 ⌘E，⌃E 归输入框标准光标操作
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }));
    });
    expect(actionsOf(onAction, 'fileClose').length).toBe(1); // 计数不变
  });

  test('右键条目 → showFileMenu(path,isDirectory,x,y)；pending 期间防重入', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as any);
    const row = rowByName('a.txt');
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }),
      );
      // 立即二次右键（pending 未清）→ 防重入
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    const menu = fs.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'showFileMenu');
    expect(menu.length).toBe(1);
    expect(menu[0].path).toBe('/proj/a.txt');
    expect(menu[0].isDirectory).toBe(false);
    expect(menu[0].x).toBe(30);
    expect(menu[0].y).toBe(40);
  });
});
