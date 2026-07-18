// @vitest-environment jsdom
//
// 列表模式 web 半（term-list-mode.md 案例池 TG_LIST_* web 半）。断言面 = 真实工件 TermGrid 的 List
// 早返分支（TermListLayout：左终端列表 240px + 右选中终端真详情）。jsdom 无布局：详情终端的洞
// （.tile-term-hole[data-term-id]）由 TermContent content 缺席分支产出，供「单洞」/「切回洞重现」断言。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TermGrid } from '../src/grid/TermGrid';
import type { TermCommandRequest, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture, TerminalFixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'term-list-mode',
    theme: 'dark',
    homePath: '/Users/rl',
    viewMode: 'List',
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
    // 无 content → TermContent 走 .tile-term-hole 洞分支（携 data-term-id）
    terminals: [
      { id: 't1', state: 'Running', cwd: '/Users/rl/a', customName: '主会话' },
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
      { id: 't3', state: 'WaitingInput', cwd: '/Users/rl/c' },
    ],
    ...over,
  } as Fixture;
}

const mini = (over: Partial<TerminalFixture>): TerminalFixture =>
  ({ id: 'm', state: 'Running', cwd: '/Users/rl/m', minimized: true, ...over }) as TerminalFixture;

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

interface Wires {
  onAction?: (a: UIAction) => void;
  onTermCommand?: (r: TermCommandRequest) => void;
}

async function mountGrid(fx: Fixture, w: Wires = {}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TermGrid, { fx, ...w }));
  });
  await flush();
}

async function rerender(fx: Fixture, w: Wires = {}): Promise<void> {
  await act(async () => {
    root!.render(createElement(TermGrid, { fx, ...w }));
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
function holeCount(id?: string): number {
  const sel = id ? `.tile-term-hole[data-term-id="${id}"]` : '.tile-term-hole';
  return document.querySelectorAll(sel).length;
}

describe('TG_LIST_* 终端列表模式（web 半）', () => {
  test('TG_LIST_single_hole：List 态恰一个洞 = 选中终端；非选中/收起零洞', async () => {
    await mountGrid(
      fixture({ selectedId: 't2' }),
      { onAction: vi.fn(), onTermCommand: vi.fn() },
    );
    // 布局壳成立：左栏 240 + 右详情
    expect(document.querySelector('.term-list__nav'), '左栏在').not.toBeNull();
    expect(document.querySelector('.term-list__detail'), '右详情在').not.toBeNull();
    // 恰一个洞 = 选中 t2；t1/t3 不渲洞（列表行是 .min-card 非洞）
    expect(holeCount(), 'List 态总洞数=1').toBe(1);
    expect(holeCount('t2'), '选中终端渲洞').toBe(1);
    expect(holeCount('t1'), '非选中零洞').toBe(0);
    expect(holeCount('t3'), '非选中零洞').toBe(0);
    // 左栏三行（三个非收起终端）
    expect(document.querySelectorAll('.term-list__nav .min-card').length).toBe(3);
  });

  test('TG_LIST_detail_interactive：右详情 = 完整 TermTile（role=grid 洞 + 完整 header），非只读预览', async () => {
    await mountGrid(
      fixture({ selectedId: 't1' }),
      { onAction: vi.fn(), onTermCommand: vi.fn() },
    );
    const detail = document.querySelector('.term-list__detail')!;
    // 完整 TermTile（.tile + header）：非 compact 预览（sidebar 预览无最大化钮），header 按钮可用
    expect(detail.querySelector('.tile'), '详情是完整 tile').not.toBeNull();
    expect(detail.querySelector('.tile-header'), '完整 header').not.toBeNull();
    // 洞 role=grid（TermContent holeRole='grid'）：与既有网格 tile 同源，真交互（非 sidebarPreview 罩）
    expect(holeCount('t1'), '详情洞 = 选中终端').toBe(1);
    // 点详情 tile → tileClick（可交互，非只读预览的 sidebarSelect 罩）
    const onAction = vi.fn();
    await rerender(fixture({ selectedId: 't1' }), { onAction });
    await act(async () => {
      document
        .querySelector('.term-list__detail .tile')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(actionsOf(onAction, 'tileClick').length, '详情可交互（tileClick）').toBeGreaterThanOrEqual(1);
  });

  test('TG_LIST_row_click_selects：左栏行单击发 tileClick{id}', async () => {
    const onAction = vi.fn();
    await mountGrid(fixture({ selectedId: 't1' }), { onAction, onTermCommand: vi.fn() });
    const row = document.querySelector('.term-list__nav .min-card[data-term-id="t3"]')!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const clicks = actionsOf(onAction, 'tileClick');
    expect(clicks.length).toBe(1);
    expect((clicks[0] as Extract<UIAction, { kind: 'tileClick' }>).terminalId).toBe('t3');
    // 选中行左边框高亮 class（t1 当前选中）
    const selRow = document.querySelector('.term-list__nav .min-card[data-term-id="t1"]');
    expect(selRow?.classList.contains('min-card--selected'), '选中行高亮').toBe(true);
    expect(selRow?.classList.contains('min-card--listRow'), 'listRow 变体').toBe(true);
  });

  test('TG_LIST_minimized_section：收起终端入「已收起」分组，点卡发 restoreTile（恢复+选中）', async () => {
    const onAction = vi.fn();
    await mountGrid(
      fixture({
        selectedId: 't1',
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/mini', customName: '后台任务', lastLine: 'x' }),
        ],
      }),
      { onAction, onTermCommand: vi.fn() },
    );
    const section = document.querySelector('.term-list__section');
    expect(section, '收起分组在').not.toBeNull();
    expect(section!.querySelector('.term-list__section-label')?.textContent).toBe('已收起');
    // m1 在收起分组（非可见行列表），标题=customName
    const card = section!.querySelector('.min-card[data-term-id="m1"]');
    expect(card, '收起卡在分组内').not.toBeNull();
    expect(card!.querySelector('.min-card__title')?.textContent).toBe('后台任务');
    // 收起项零洞（详情只渲选中 t1）
    expect(holeCount('m1')).toBe(0);
    // 点收起卡 → restoreTile（reducer 恢复+选中一步到位）
    await act(async () => {
      card!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const r = actionsOf(onAction, 'restoreTile');
    expect(r.length).toBe(1);
    expect((r[0] as Extract<UIAction, { kind: 'restoreTile' }>).terminalId).toBe('m1');
  });

  test('TG_LIST_empty_state：无选中（全收起/顺延到 nil）→ 右详情空态占位；收起分组仍可恢复', async () => {
    const onAction = vi.fn();
    await mountGrid(
      fixture({
        selectedId: null,
        terminals: [
          mini({ id: 'm1', cwd: '/Users/rl/m1', lastLine: 'a' }),
          mini({ id: 'm2', cwd: '/Users/rl/m2', lastLine: 'b' }),
        ],
      }),
      { onAction, onTermCommand: vi.fn() },
    );
    // 右详情空态占位、零洞
    const empty = document.querySelector('.term-list__detail .term-list__empty');
    expect(empty, '空态占位').not.toBeNull();
    expect(empty?.textContent).toContain('选择左侧终端');
    expect(holeCount(), '无选中 → 零洞').toBe(0);
    // 无可见行（全收起）、收起分组两卡仍可点恢复
    expect(document.querySelectorAll('.term-list__rows .min-card').length, '无可见行').toBe(0);
    const cards = document.querySelectorAll('.term-list__section .min-card');
    expect(cards.length).toBe(2);
    await act(async () => {
      cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(actionsOf(onAction, 'restoreTile').length).toBe(1);
  });

  test('TG_LIST_back_to_tiling_holes_restore：List→Tiling 切回后 N 个非收起终端洞全部重现', async () => {
    // List 态：仅选中 t1 一个洞
    await mountGrid(fixture({ selectedId: 't1' }), { onAction: vi.fn(), onTermCommand: vi.fn() });
    expect(holeCount(), 'List 态一个洞').toBe(1);
    expect(document.querySelector('.term-list'), 'List 布局壳在').not.toBeNull();
    // 切回 Tiling（同 fixture 仅换 viewMode）→ 三个非收起终端洞全重现，List 壳消失
    await rerender(fixture({ viewMode: 'Tiling', selectedId: 't1' }), {
      onAction: vi.fn(),
      onTermCommand: vi.fn(),
    });
    expect(document.querySelector('.term-list'), 'List 壳退场').toBeNull();
    expect(document.querySelector('.terminal-grid'), 'Tiling 网格回归').not.toBeNull();
    expect(holeCount(), '三终端洞全重现（洞数守恒）').toBe(3);
    expect(holeCount('t1')).toBe(1);
    expect(holeCount('t2')).toBe(1);
    expect(holeCount('t3')).toBe(1);
  });

  test('Tiling fixture 零变化守卫：无 List 值时 DOM 与旧一致（不渲 .term-list、走既有网格路径）', async () => {
    await mountGrid(
      fixture({ viewMode: 'Tiling' }),
      { onAction: vi.fn(), onTermCommand: vi.fn() },
    );
    expect(document.querySelector('.term-list'), 'Tiling 不渲列表壳').toBeNull();
    expect(document.querySelector('.term-list__nav'), 'Tiling 无列表左栏').toBeNull();
    expect(document.querySelector('.terminal-grid'), 'Tiling 走既有网格').not.toBeNull();
    expect(holeCount(), 'Tiling 三终端三洞').toBe(3);
  });
});
