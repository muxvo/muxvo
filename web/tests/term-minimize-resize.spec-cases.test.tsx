// @vitest-environment jsdom
//
// term-grid §10.3/§11.5：收起在场时分隔条交互形状必须按**可见**终端集算（2026-07-17 真机回修）。
// 真机案例：9 终端收起 3（可见 6=2 行），行分隔条按总数 9 播种 3 份 ⅓ 行比 → 两行各拿 flex ⅓、
// flex-grow 总和 0.67<1 → 窗口底部 ⅓ 空黑死区；且 gridResize 载荷 rowRatios 长度 3 持久化脏数据。
//   · TG_MIN_resize_visible_shape —— 有收起时拖行分隔条：按可见行数播种、载荷长度=可见行数、两行满铺。
//   · TG_MIN_shape_change_resets_ratios —— 收起改变可见数（总数不变）→ 本地比例重建均分、把手数随形状。
// 断言面 = 真实工件 TermGrid（消费 useGridInteractions）在 jsdom 的 live 渲染 + onAction 载荷。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TermGrid } from '../src/grid/TermGrid';
import type { UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(minimizedIds: string[]): Fixture {
  return {
    id: 'min-resize',
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
    terminals: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'].map((id) => ({
      id,
      state: 'Running',
      cwd: `/Users/rl/${id}`,
      ...(minimizedIds.includes(id) ? { minimized: true } : {}),
    })),
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

async function mount(fx: Fixture, onAction: (a: UIAction) => void): Promise<void> {
  await act(async () => {
    root!.render(createElement(TermGrid, { fx, onAction }));
  });
  await flush();
  // jsdom 无布局：行拖读容器 getBoundingClientRect().height（<=0 早退），mock 之
  const grid = container!.querySelector('.terminal-grid') as HTMLElement;
  grid.getBoundingClientRect = () =>
    ({ height: 600, width: 900, top: 0, left: 0, right: 900, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

/** 多行分支的行容器 = .terminal-grid 直系 display:grid 子级（把手/FAB/ghost 均非 grid） */
function rowDivs(): HTMLElement[] {
  return Array.from(container!.querySelectorAll('.terminal-grid > div')).filter(
    (el): el is HTMLElement => (el as HTMLElement).style.display === 'grid',
  );
}

function rowHandles(): HTMLElement[] {
  return Array.from(container!.querySelectorAll('.resize-handle--row')) as HTMLElement[];
}

function rowFlexSum(): number {
  return rowDivs().reduce((s, el) => s + parseFloat(el.style.flex || '1'), 0);
}

async function dragRowHandle(handle: HTMLElement, fromY: number, toY: number): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: fromY }));
  });
  await act(async () => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: toY }));
  });
  await act(async () => {
    document.dispatchEvent(new MouseEvent('mouseup', {}));
  });
  await flush();
}

describe('TG_MIN_resize_visible_shape：有收起时行分隔条按可见形状播种（§10.3）', () => {
  test('9 总收 3（可见 6=2 行）：拖行分隔条 → 播种 2 行、载荷 rowRatios 长度 2、两行 flex 总和=1 无死区', async () => {
    const onAction = vi.fn<(a: UIAction) => void>();
    await mount(fixture(['t1', 't2', 't3']), onAction);

    expect(rowDivs(), '可见 6 → 2 行').toHaveLength(2);
    expect(rowHandles(), '2 行 → 1 条行把手').toHaveLength(1);

    // height 600、拖 30px → delta 0.05：均分 [0.5,0.5] → [0.55,0.45]
    await dragRowHandle(rowHandles()[0], 300, 330);

    const resize = onAction.mock.calls.map((c) => c[0]).find((a) => a.kind === 'gridResize');
    expect(resize, '释放必发 gridResize').toBeTruthy();
    if (resize?.kind === 'gridResize') {
      expect(resize.rowRatios, '载荷行比长度=可见行数 2（非总数 3 行）').toHaveLength(2);
      expect(resize.rowRatios.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    }

    const rows = rowDivs();
    expect(rows).toHaveLength(2);
    expect(rowFlexSum(), '行 flex-grow 总和=1（<1 即底部死区）').toBeCloseTo(1, 6);
    expect(parseFloat(rows[0].style.flex)).toBeCloseTo(0.55, 6);
    expect(parseFloat(rows[1].style.flex)).toBeCloseTo(0.45, 6);
  });
});

describe('TG_MIN_shape_change_resets_ratios：收起改变可见数（总数不变）→ 比例重建均分（§10.3）', () => {
  test('9 全可见拖过行比 → 收起 3 个：行比重置均分（flex=1×2）、把手数随形状=1', async () => {
    const onAction = vi.fn<(a: UIAction) => void>();
    await mount(fixture([]), onAction);

    expect(rowDivs(), '9 可见 → 3 行').toHaveLength(3);
    expect(rowHandles(), '3 行 → 2 条行把手').toHaveLength(2);

    await dragRowHandle(rowHandles()[0], 100, 130);
    expect(rowFlexSum(), '3 行拖后总和仍=1').toBeCloseTo(1, 6);
    expect(parseFloat(rowDivs()[0].style.flex), '拖动确已生效').not.toBeCloseTo(1, 6);

    // 收起 t1-t3：总数 9 不变、可见 6 → 形状 3 行→2 行，本地行比必须重建均分
    await act(async () => {
      root!.render(createElement(TermGrid, { fx: fixture(['t1', 't2', 't3']), onAction }));
    });
    await flush();

    const rows = rowDivs();
    expect(rows, '收起后 2 行').toHaveLength(2);
    for (const r of rows) {
      expect(parseFloat(r.style.flex || '1'), '重建均分：每行 flex=1').toBeCloseTo(1, 6);
    }
    expect(rowFlexSum()).toBeCloseTo(2, 6);
    expect(rowHandles(), '把手位置随当前形状（2 行 → 1 条）').toHaveLength(1);
  });
});
