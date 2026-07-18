// @vitest-environment jsdom
//
// M6 批A 拖拽路径入终端（真实 live 宿主，file-panel-live 骨架同款）：
//   源行 dragStart → 双 dataTransfer type（application/x-muxvo-path + text/plain）+ effectAllowed=copy
//   + body.dragging-file + DragIsland 挂载（岛计数）；
//   tile onDragOver 对 x-muxvo-path preventDefault + .tile--file-drop 高亮，对 text/plain-only（重排拖）不响应；
//   drop → insertText 载荷含 quotePath 转义（空格路径用例）；dragend 清 class/island。
// jsdom 无原生 DataTransfer → 以 mock 注入 nativeEvent.dataTransfer（React SyntheticDragEvent 直读）。
// 网格重排方向的 draggingRef 守门属 Agent-E（useGridInteractions）领地，本文件只守文件拖侧 type 判别隔离。
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

const FILE_DRAG_TYPE = 'application/x-muxvo-path';

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'fp-drag',
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

const DIRS: Record<string, FsResponse> = {
  '/proj': {
    kind: 'dir',
    entries: [{ name: 'a.txt', isDirectory: false, size: 10 }],
  },
};
function makeFs(): ReturnType<typeof vi.fn> {
  return vi.fn(async (req: FsRequest): Promise<FsResponse> => {
    if (req.kind === 'readDir') return DIRS[req.path] ?? { kind: 'dir', entries: [] };
    return { kind: 'rejected', code: 'internal', message: 'x' };
  });
}
function makeTermReq(): ReturnType<typeof vi.fn> {
  return vi.fn(async (): Promise<TermCommandResponse> => ({ kind: 'inserted', terminalId: 't1' }));
}

// jsdom 无 DataTransfer：mock 一份 setData/getData/types 语义。
interface MockDT {
  store: Record<string, string>;
  types: string[];
  effectAllowed: string;
  dropEffect: string;
  setData(t: string, v: string): void;
  getData(t: string): string;
}
function makeDataTransfer(initial: Record<string, string> = {}): MockDT {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    get types(): string[] {
      return Object.keys(store);
    },
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(t: string, v: string): void {
      store[t] = v;
    },
    getData(t: string): string {
      return store[t] ?? '';
    },
  } as MockDT;
}
function dragEvent(type: string, dt: MockDT): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'dataTransfer', { value: dt, configurable: true });
  return evt;
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
async function mount(fx: Fixture, w: Wires): Promise<void> {
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

function fileRow(name: string): HTMLElement {
  const el = Array.from(document.querySelectorAll<HTMLElement>('.file-item')).find(
    (r) => r.querySelector('.file-item__name')?.textContent === name,
  );
  expect(el, `找不到行 ${name}`).toBeDefined();
  return el!;
}
function tileEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.tile');
  expect(el).not.toBeNull();
  return el!;
}
function islandCount(): number {
  return document.querySelectorAll('.drag-island').length;
}
function fullWires(): Required<Wires> {
  return {
    onAction: vi.fn(),
    onTermCommand: vi.fn(),
    onFsRequest: makeFs() as any,
    onTermRequest: makeTermReq() as any,
  };
}

describe('M6 批A 文件拖拽入终端', () => {
  test('源行 dragStart → 双 type + effectAllowed=copy + body.dragging-file + DragIsland 挂载', async () => {
    await mount(fixture(), fullWires());
    expect(islandCount()).toBe(0);
    expect(document.body.classList.contains('dragging-file')).toBe(false);

    const dt = makeDataTransfer();
    await act(async () => {
      fileRow('a.txt').dispatchEvent(dragEvent('dragstart', dt));
    });
    await flush(1);

    expect(dt.store[FILE_DRAG_TYPE]).toBe('/proj/a.txt');
    expect(dt.store['text/plain']).toBe('/proj/a.txt');
    expect(dt.effectAllowed).toBe('copy');
    expect(document.body.classList.contains('dragging-file'), 'dragStart 挂 body.dragging-file').toBe(
      true,
    );
    expect(islandCount(), 'DragIsland 挂载（拖过 Metal 洞区拦事件回 web）').toBe(1);
    const island = document.querySelector<HTMLElement>('.drag-island')!;
    expect(island.hasAttribute('data-hit-island')).toBe(true);
  });

  test('tile onDragOver 对 x-muxvo-path preventDefault + .tile--file-drop；对 text/plain-only 不响应', async () => {
    await mount(fixture(), fullWires());
    const tile = tileEl();

    // 重排拖（只 text/plain）→ 不响应：不 preventDefault、不高亮
    const reorderDt = makeDataTransfer({ 'text/plain': 't1' });
    let evt = dragEvent('dragover', reorderDt);
    await act(async () => {
      tile.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented, '重排拖不得被 drop 靶拦截').toBe(false);
    expect(tile.classList.contains('tile--file-drop')).toBe(false);

    // 文件拖（x-muxvo-path）→ preventDefault + 高亮
    const fileDt = makeDataTransfer({ [FILE_DRAG_TYPE]: '/proj/a.txt' });
    evt = dragEvent('dragover', fileDt);
    await act(async () => {
      tile.dispatchEvent(evt);
    });
    await flush(1);
    expect(evt.defaultPrevented, '文件拖须 preventDefault 允许 drop').toBe(true);
    expect(tile.classList.contains('tile--file-drop'), '文件拖高亮').toBe(true);

    // dragLeave 清高亮
    await act(async () => {
      tile.dispatchEvent(dragEvent('dragleave', makeDataTransfer()));
    });
    await flush(1);
    expect(tile.classList.contains('tile--file-drop')).toBe(false);
  });

  test('drop → insertText 载荷 = quotePath 转义（空格路径单引号包裹 + 尾随空格）', async () => {
    const w = fullWires();
    await mount(fixture(), w);
    const tile = tileEl();
    const dropDt = makeDataTransfer({ [FILE_DRAG_TYPE]: '/proj/my file.txt' });
    const evt = dragEvent('drop', dropDt);
    await act(async () => {
      tile.dispatchEvent(evt);
    });
    await flush(1);
    expect(evt.defaultPrevented).toBe(true);
    const inserts = (w.onTermRequest as any).mock.calls
      .map((c: any[]) => c[0])
      .filter((r: any) => r?.kind === 'insertText');
    expect(inserts.length).toBe(1);
    expect(inserts[0].terminalId).toBe('t1');
    expect(inserts[0].text).toBe("'/proj/my file.txt' "); // 含空格 → 单引号包裹 + 尾随空格
    // drop 后高亮清
    expect(tile.classList.contains('tile--file-drop')).toBe(false);
  });

  test('drop 纯净路径原样 + 尾随空格（无需转义）', async () => {
    const w = fullWires();
    await mount(fixture(), w);
    const dropDt = makeDataTransfer({ [FILE_DRAG_TYPE]: '/proj/a.txt' });
    await act(async () => {
      tileEl().dispatchEvent(dragEvent('drop', dropDt));
    });
    await flush(1);
    const inserts = (w.onTermRequest as any).mock.calls
      .map((c: any[]) => c[0])
      .filter((r: any) => r?.kind === 'insertText');
    expect(inserts[0].text).toBe('/proj/a.txt '); // 纯净 → 原样 + 尾随空格
  });

  test('dragend → body.dragging-file 清、DragIsland 卸载', async () => {
    await mount(fixture(), fullWires());
    const row = fileRow('a.txt');
    await act(async () => {
      row.dispatchEvent(dragEvent('dragstart', makeDataTransfer()));
    });
    await flush(1);
    expect(islandCount()).toBe(1);
    await act(async () => {
      row.dispatchEvent(dragEvent('dragend', makeDataTransfer()));
    });
    await flush(1);
    expect(document.body.classList.contains('dragging-file')).toBe(false);
    expect(islandCount(), 'dragend 卸载 DragIsland').toBe(0);
  });
});
