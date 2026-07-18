// @vitest-environment jsdom
//
// M6 批A reorder 拖拽修复三假设的 web 侧断言（H1 岛机制 + H2 canvas 拖影 + H3a 几何兜底）。
// 断言面 = 真实工件 TermGrid（消费 useGridInteractions）在 bridge 模式下的拖拽事件行为：
//   H1：tile 拖拽期挂全窗 DragIsland（岛计数=1），dragend/drop 清（=0）——同一岛机制让 native 把洞区
//       拖拽事件拦回 web（真实 hitTest 往返归 e2e gate 20，此处只守 web 侧岛的挂/卸时机）。
//   H2：dragstart 的 setDragImage 用 1×1 canvas（非空 Image），消 WebKit 空 Image 拖拽会话脆弱点。
//   H3a：drop 落点未经 dragenter（光标只穿洞区）→ dragOverRef 为 null → 用 elementsFromPoint 反查命中
//        tile 再 planReorder（不再静默 no-op）。
// jsdom 无原生 DataTransfer → mock 注入 nativeEvent.dataTransfer（React SyntheticDragEvent 直读）；
// jsdom 无布局 → elementsFromPoint 以 spy 注入命中元素直证兜底路径。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TermGrid } from '../src/grid/TermGrid';
import type { UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'reorder-island',
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
    // 无 content → TermContent 走 .tile-term-hole 洞分支（携 data-term-id，供 H3a 反查命中）
    terminals: [
      { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
    ],
    ...over,
  } as Fixture;
}

// jsdom 无 DataTransfer：mock setData/getData/types + setDragImage（记录拖影参数，H2 断言）。
interface MockDT {
  store: Record<string, string>;
  types: string[];
  effectAllowed: string;
  dropEffect: string;
  dragImage: unknown;
  setData(t: string, v: string): void;
  getData(t: string): string;
  setDragImage(img: unknown, x: number, y: number): void;
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
    dragImage: undefined,
    setData(t: string, v: string): void {
      store[t] = v;
    },
    getData(t: string): string {
      return store[t] ?? '';
    },
    setDragImage(img: unknown): void {
      this.dragImage = img;
    },
  } as MockDT;
}
function dragEvent(type: string, dt: MockDT, xy?: { x: number; y: number }): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'dataTransfer', { value: dt, configurable: true });
  if (xy) {
    Object.defineProperty(evt, 'clientX', { value: xy.x, configurable: true });
    Object.defineProperty(evt, 'clientY', { value: xy.y, configurable: true });
  }
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
  // jsdom 无布局 → 不实现 elementsFromPoint。定义默认空实现，令 H3a 用例可 spyOn 注入命中元素。
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint =
    () => [];
});

async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function mount(onAction: (a: UIAction) => void): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TermGrid, { fx: fixture(), onAction, onTermCommand: () => {} }));
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

function holeOf(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.tile-term-hole[data-term-id="${id}"]`);
  expect(el, `找不到 ${id} 的洞`).not.toBeNull();
  return el!;
}
function gridEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.terminal-grid');
  expect(el).not.toBeNull();
  return el!;
}
function islandCount(): number {
  return document.querySelectorAll('.drag-island').length;
}

describe('M6 批A reorder 拖拽修复（H1 岛 / H2 canvas / H3a 兜底）', () => {
  test('H1：tile dragstart → DragIsland 挂载(岛计数=1，带 data-hit-island)；dragend 清=0', async () => {
    await mount(vi.fn());
    expect(islandCount()).toBe(0);

    await act(async () => {
      holeOf('t2').dispatchEvent(dragEvent('dragstart', makeDataTransfer()));
    });
    await flush(1);
    expect(islandCount(), 'reorder 拖拽期挂全窗岛（拖过 Metal 洞区拦事件回 web）').toBe(1);
    const island = document.querySelector<HTMLElement>('.drag-island')!;
    expect(island.hasAttribute('data-hit-island')).toBe(true);

    await act(async () => {
      holeOf('t2').dispatchEvent(dragEvent('dragend', makeDataTransfer()));
    });
    await flush(1);
    expect(islandCount(), 'dragend 卸载 DragIsland').toBe(0);
  });

  test('H1：drop 后 DragIsland 卸载（clearDrag 清 draggingId）', async () => {
    const onAction = vi.fn();
    await mount(onAction);
    await act(async () => {
      holeOf('t2').dispatchEvent(dragEvent('dragstart', makeDataTransfer()));
    });
    await flush(1);
    expect(islandCount()).toBe(1);
    // dragenter t1 → dragOverId=t1，正常路径 drop
    await act(async () => {
      holeOf('t1').dispatchEvent(dragEvent('dragenter', makeDataTransfer()));
    });
    await act(async () => {
      gridEl().dispatchEvent(dragEvent('drop', makeDataTransfer(), { x: 10, y: 10 }));
    });
    await flush(1);
    expect(islandCount(), 'drop 后清岛').toBe(0);
  });

  test('setDragImage 禁用令：dragstart 全程不调（WKWebView 对游离元素快照失败=杀会话，真机 DIAG 实锤）', async () => {
    await mount(vi.fn());
    const dt = makeDataTransfer();
    await act(async () => {
      holeOf('t1').dispatchEvent(dragEvent('dragstart', dt));
    });
    await flush(1);
    // 2026-07-07 真机取证（S:1 O:0 X:1 会话秒死）：detached canvas 与空 Image 同罪——WKWebView 无法
    // 快照无渲染盒元素，整个拖拽会话立即取消。原生拖影是唯一可靠路径，故断言**未设置**任何自定义拖影。
    expect(dt.dragImage, '不设自定义拖影（原生拖影兜底）').toBeUndefined();
  });

  test('H3a：drop 未经 dragenter（dragOverRef=null）→ elementsFromPoint 反查命中 → reorder 生效', async () => {
    const onAction = vi.fn();
    await mount(onAction);
    // 拖 t2（不触发任何 dragenter，模拟光标只穿洞区）
    await act(async () => {
      holeOf('t2').dispatchEvent(dragEvent('dragstart', makeDataTransfer()));
    });
    await flush(1);
    // jsdom 无布局 → elementsFromPoint 恒空；spy 注入 drop 点命中 t1 的洞元素（几何反查目标）
    const t1Hole = holeOf('t1');
    const spy = vi
      .spyOn(document, 'elementsFromPoint')
      .mockReturnValue([t1Hole] as unknown as Element[]);
    await act(async () => {
      gridEl().dispatchEvent(dragEvent('drop', makeDataTransfer(), { x: 123, y: 45 }));
    });
    await flush(1);
    expect(spy, 'H3a 走 elementsFromPoint 反查').toHaveBeenCalledWith(123, 45);
    const reorders = (onAction as unknown as { mock: { calls: UIAction[][] } }).mock.calls
      .map((c) => c[0])
      .filter((a): a is Extract<UIAction, { kind: 'reorder' }> => a.kind === 'reorder');
    expect(reorders.length, '兜底路径仍发 reorder').toBe(1);
    // t2 拖到 t1 之前 → 新序 [t2, t1]
    expect(reorders[0].order).toEqual(['t2', 't1']);
    expect(islandCount()).toBe(0);
  });

  test('H3a：drop 未经 dragenter 且 elementsFromPoint 命中拖拽源自身 → 不发 reorder（排除自身）', async () => {
    const onAction = vi.fn();
    await mount(onAction);
    await act(async () => {
      holeOf('t2').dispatchEvent(dragEvent('dragstart', makeDataTransfer()));
    });
    await flush(1);
    const t2Hole = holeOf('t2'); // 命中源自身 → tileIdAtPoint 排除 → over=null → planReorder=null
    vi.spyOn(document, 'elementsFromPoint').mockReturnValue([t2Hole] as unknown as Element[]);
    await act(async () => {
      gridEl().dispatchEvent(dragEvent('drop', makeDataTransfer(), { x: 5, y: 5 }));
    });
    await flush(1);
    const reorders = (onAction as unknown as { mock: { calls: UIAction[][] } }).mock.calls
      .map((c) => c[0])
      .filter((a) => a.kind === 'reorder');
    expect(reorders.length, '落回自身不发 reorder').toBe(0);
    expect(islandCount()).toBe(0);
  });
});
