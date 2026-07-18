// @vitest-environment jsdom
//
// 终端收起·左侧缩略边栏 web 半（term-grid §11 案例池 TG_MIN_*）。断言面 = 真实工件 TermGrid
// （收起二分 + 边栏渲染 + 恢复/关闭/右键交互）与 TerminalScreen（live「收起」按钮）。
// jsdom 无布局：洞元素（.tile-term-hole[data-term-id]）由 content 缺席分支产出，供「不渲洞」断言。
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
import type { Fixture, TerminalFixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'term-minimize',
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
    // 测试 helper 默认展开边栏（产品默认=折叠，由 TG_MIN_rail_default_collapsed 专用例覆盖；
    // 其余展开态用例免逐个显式）。
    minRailCollapsed: false,
    searchBar: null,
    palette: { background: '#1e1e1e', foreground: '#cccccc' },
    // 无 content → TermContent 走 .tile-term-hole 洞分支（携 data-term-id，供「不渲洞」断言）
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

/** live 全接线宿主（TerminalScreen → LiveInteractionLayer provider → 「收起」按钮才渲）。 */
async function mountScreen(fx: Fixture, onAction = vi.fn(), onTermCommand = vi.fn()): Promise<void> {
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
        onTermCommand,
        onFsRequest: onFsRequest as never,
        onTermRequest: onTermRequest as never,
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
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.className = '';
});

function actionsOf(onAction: ReturnType<typeof vi.fn>, kind: string): UIAction[] {
  return onAction.mock.calls.map((c) => c[0]).filter((a) => a?.kind === kind);
}
function holeCount(id: string): number {
  return document.querySelectorAll(`.tile-term-hole[data-term-id="${id}"]`).length;
}

const mini = (over: Partial<TerminalFixture>): TerminalFixture =>
  ({ id: 'm', state: 'Running', cwd: '/Users/rl/m', minimized: true, ...over }) as TerminalFixture;

describe('TG_MIN_* 终端收起·左侧缩略边栏（web 半）', () => {
  test('TG_MIN_rail_hidden_when_empty：无收起 → 无边栏、无 .term-shell 包裹层，网格 DOM 与旧渲染一致', async () => {
    await mountGrid(fixture(), { onAction: vi.fn(), onTermCommand: vi.fn() });
    expect(document.querySelector('.min-rail'), '无收起不渲边栏').toBeNull();
    expect(document.querySelector('.term-shell'), '无收起不加包裹层').toBeNull();
    // 网格容器仍是顶层直渲（未被 .term-shell 包裹）
    const grid = document.querySelector('.terminal-grid');
    expect(grid).not.toBeNull();
    expect(grid!.closest('.term-shell'), '网格未被壳包裹').toBeNull();
  });

  test('TG_MIN_no_hole_for_minimized：收起终端不渲洞（layoutReport 无其 rect），可见终端有洞', async () => {
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/mini', lastLine: 'x' }),
        ],
      }),
      { onAction: vi.fn(), onTermCommand: vi.fn() },
    );
    expect(holeCount('t1'), '可见终端渲洞').toBe(1);
    expect(holeCount('m1'), '收起终端零洞').toBe(0);
    // 收起项在边栏（min-card）而非网格
    expect(document.querySelector('.min-rail .min-card'), '收起项落边栏').not.toBeNull();
  });

  test('TG_MIN_minimize_leaves_grid：收起项不在网格、在 Rail；点「收起」按钮发 minimizeTile', async () => {
    const onAction = vi.fn();
    await mountScreen(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a', customName: '主会话' },
          mini({ id: 'm1', cwd: '/Users/rl/mini', customName: '后台任务', lastLine: 'x' }),
        ],
      }),
      onAction,
    );
    // 收起项 m1 不在网格（无洞），在边栏卡（标题「后台任务」）
    expect(holeCount('m1')).toBe(0);
    const cardTitle = document.querySelector('.min-rail .min-card__title');
    expect(cardTitle?.textContent).toBe('后台任务');
    // 可见 tile 头「收起」按钮（live 才渲）恰一枚 → 点击发 minimizeTile{t1}
    const btns = document.querySelectorAll<HTMLButtonElement>('.tile-minimize-btn');
    expect(btns.length, '仅可见 tile 有收起按钮').toBe(1);
    await act(async () => {
      btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const mins = actionsOf(onAction, 'minimizeTile');
    expect(mins.length).toBe(1);
    expect((mins[0] as Extract<UIAction, { kind: 'minimizeTile' }>).terminalId).toBe('t1');
    // stopPropagation：不冒泡成 tileClick
    expect(actionsOf(onAction, 'tileClick').length, '不选中 tile').toBe(0);
  });

  test('TG_MIN_rail_collapsed_dots：折叠细条（默认态）= 逐收起终端一个状态点 + 悬停 title=终端名；顶部展开钮展开', async () => {
    await mountGrid(
      fixture({
        minRailCollapsed: true,
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', state: 'Running', cwd: '/Users/rl/m1', customName: '构建任务', lastLine: 'a' }),
          mini({ id: 'm2', state: 'WaitingInput', cwd: '/Users/rl/m2', lastLine: 'b' }),
        ],
      }),
      { onAction: vi.fn(), onTermCommand: vi.fn() },
    );
    const rail = document.querySelector('.min-rail');
    expect(rail?.classList.contains('min-rail--collapsed'), '折叠细条态').toBe(true);
    // 逐收起终端一个点（dogfood 反馈③+二轮修订）：统一淡灰无状态色 + 悬停自绘 tooltip=终端名
    const dots = rail!.querySelectorAll<HTMLElement>('.min-rail__dot');
    expect(dots.length, '每收起终端一个点').toBe(2);
    expect(dots[0].classList.contains('tile-status--running'), '不带状态色 class（收起=不关注）').toBe(false);
    expect(dots[1].classList.contains('tile-status--waiting'), '不带状态色 class').toBe(false);
    expect(dots[0].getAttribute('data-term-title'), 'm1 名=customName').toBe('构建任务');
    expect(dots[1].getAttribute('data-term-title'), 'm2 名=cwd 末段').toBe('m2');
    // 悬停出自绘 tooltip（WKWebView 无原生 title tooltip）
    await act(async () => {
      dots[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await flush(1);
    expect(document.querySelector('.min-rail__tooltip')?.textContent, '悬停出终端名').toBe('构建任务');
    await act(async () => {
      dots[0].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    await flush(1);
    expect(document.querySelector('.min-rail__tooltip'), '移出即收').toBeNull();
    // 折叠态不渲卡片列表 / 数量徽标已退役
    expect(rail?.querySelector('.min-card'), '折叠不渲卡').toBeNull();
    expect(rail?.querySelector('.min-rail__badge'), '徽标退役').toBeNull();
    // 展开唯一入口 = 细条顶部展开钮（dogfood 反馈 2026-07-13：点圆点=直接恢复，不再点条任意处展开）
    const expandBtn = rail!.querySelector<HTMLElement>('.min-rail__expand-btn');
    expect(expandBtn, '折叠细条顶部有展开钮').not.toBeNull();
    await act(async () => {
      expandBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(document.querySelector('.min-rail--collapsed'), '点展开钮后展开').toBeNull();
    expect(document.querySelector('.min-rail .min-card'), '展开后见卡').not.toBeNull();
  });

  test('TG_MIN_rail_dot_direct_restore：折叠细条点圆点 → restoreTile 直接恢复该终端（不展开）；细条背景点击不展开；截图态 inert', async () => {
    const onAction = vi.fn();
    await mountGrid(
      fixture({
        minRailCollapsed: true,
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', state: 'Running', cwd: '/Users/rl/m1', customName: '构建任务', lastLine: 'a' }),
          mini({ id: 'm2', state: 'WaitingInput', cwd: '/Users/rl/m2', lastLine: 'b' }),
        ],
      }),
      { onAction, onTermCommand: vi.fn() },
    );
    const rail = document.querySelector<HTMLElement>('.min-rail--collapsed')!;
    const dots = rail.querySelectorAll<HTMLElement>('.min-rail__dot');
    // ① 点圆点 → restoreTile{该终端}，且不展开（细条仍在、不渲卡）
    await act(async () => {
      dots[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const restores = actionsOf(onAction, 'restoreTile');
    expect(restores.length, '点圆点直接恢复').toBe(1);
    expect((restores[0] as Extract<UIAction, { kind: 'restoreTile' }>).terminalId).toBe('m2');
    expect(document.querySelector('.min-rail--collapsed'), '点圆点不展开').not.toBeNull();
    expect(document.querySelector('.min-rail .min-card'), '不渲卡').toBeNull();
    // ② 细条背景点击不再展开（展开唯一入口=顶部展开钮）
    await act(async () => {
      rail.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(document.querySelector('.min-rail--collapsed'), '点条背景不展开').not.toBeNull();
  });

  test('TG_MIN_rail_dot_inert_screenshot：截图态（无 onAction）点圆点 inert——不恢复不展开不炸', async () => {
    await mountGrid(
      fixture({
        minRailCollapsed: true,
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/m1', lastLine: 'a' }),
        ],
      }),
      {},
    );
    const dot = document.querySelector<HTMLElement>('.min-rail__dot')!;
    await act(async () => {
      dot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(document.querySelector('.min-rail--collapsed'), '截图态点圆点无副作用').not.toBeNull();
  });

  test('TG_MIN_rail_default_collapsed：无种子时边栏默认折叠（收起后不默认占 180px，dogfood 反馈②）', async () => {
    const fx = fixture({
      terminals: [
        { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
        mini({ id: 'm1', cwd: '/Users/rl/m1', lastLine: 'a' }),
      ],
    });
    delete (fx as Record<string, unknown>).minRailCollapsed; // 无种子 = 产品默认路径
    await mountGrid(fx, { onAction: vi.fn(), onTermCommand: vi.fn() });
    expect(document.querySelector('.min-rail--collapsed'), '默认折叠').not.toBeNull();
    expect(document.querySelector('.min-card'), '默认不渲卡').toBeNull();
  });

  test('TG_MIN_all_minimized_empty_hint：全收起 → 网格区提示态 +（可用）FAB + 边栏在', async () => {
    await mountGrid(
      fixture({
        terminals: [
          mini({ id: 'm1', cwd: '/Users/rl/m1', lastLine: 'a' }),
          mini({ id: 'm2', cwd: '/Users/rl/m2', lastLine: 'b' }),
        ],
      }),
      { onAction: vi.fn(), onTermCommand: vi.fn() },
    );
    const empty = document.querySelector('.terminal-grid__empty');
    expect(empty?.textContent).toContain('全部终端已收起');
    const fab = empty?.querySelector<HTMLButtonElement>('.terminal-grid__fab');
    expect(fab, '提示态仍有 FAB').not.toBeNull();
    expect(fab!.disabled, 'FAB 可用').toBe(false);
    expect(document.querySelectorAll('.min-rail .min-card').length, '两卡在边栏').toBe(2);
    // 提示态仍被 .term-shell 包裹（有收起）
    expect(empty!.closest('.term-shell')).not.toBeNull();
  });

  test('restoreTile：单击 mini 卡发 restoreTile{id}', async () => {
    const onAction = vi.fn();
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/mini', lastLine: 'a' }),
        ],
      }),
      { onAction, onTermCommand: vi.fn() },
    );
    await act(async () => {
      document
        .querySelector('.min-rail .min-card')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const r = actionsOf(onAction, 'restoreTile');
    expect(r.length).toBe(1);
    expect((r[0] as Extract<UIAction, { kind: 'restoreTile' }>).terminalId).toBe('m1');
  });

  test('restoreAllMinimized：点底部「全部恢复」发 restoreAllMinimized', async () => {
    const onAction = vi.fn();
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/m1', lastLine: 'a' }),
        ],
      }),
      { onAction, onTermCommand: vi.fn() },
    );
    await act(async () => {
      document
        .querySelector('.min-rail__restore-all')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    expect(actionsOf(onAction, 'restoreAllMinimized').length).toBe(1);
  });

  test('右键菜单渲染 + data-hit-island；恢复项发 restoreTile', async () => {
    const onAction = vi.fn();
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/mini', lastLine: 'a' }),
        ],
      }),
      { onAction, onTermCommand: vi.fn() },
    );
    expect(document.querySelector('.min-rail__menu')).toBeNull();
    await act(async () => {
      document
        .querySelector('.min-rail .min-card')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
        );
    });
    await flush(1);
    const menu = document.querySelector('.min-rail__menu');
    expect(menu, '右键出菜单').not.toBeNull();
    expect(menu!.hasAttribute('data-hit-island'), '菜单挂 data-hit-island（浮层岛）').toBe(true);
    const items = menu!.querySelectorAll<HTMLButtonElement>('.min-rail__menu-item');
    expect(Array.from(items).map((b) => b.textContent)).toEqual(['恢复', '关闭']);
    await act(async () => {
      items[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const r = actionsOf(onAction, 'restoreTile');
    expect(r.length).toBe(1);
    expect((r[0] as Extract<UIAction, { kind: 'restoreTile' }>).terminalId).toBe('m1');
    expect(document.querySelector('.min-rail__menu'), '恢复后菜单关闭').toBeNull();
  });

  test('右键「关闭」：死会话走 term.command close 直移除', async () => {
    const onTermCommand = vi.fn();
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', state: 'Stopped', cwd: '/Users/rl/mini', lastLine: 'a' }),
        ],
      }),
      { onAction: vi.fn(), onTermCommand },
    );
    await act(async () => {
      document
        .querySelector('.min-rail .min-card')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
        );
    });
    await flush(1);
    const items = document.querySelectorAll<HTMLButtonElement>('.min-rail__menu .min-rail__menu-item');
    await act(async () => {
      items[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const closes = onTermCommand.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'close');
    expect(closes.length).toBe(1);
    expect(closes[0].terminalId).toBe('m1');
  });

  test('TG_MIN_card_hover_close：展开卡行内关闭钮（悬停浮现 ×）——死会话点 × → term.command close 直移除；stopPropagation 不触发恢复', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', state: 'Stopped', cwd: '/Users/rl/mini', lastLine: 'a' }),
        ],
      }),
      { onAction, onTermCommand },
    );
    const btn = document.querySelector<HTMLButtonElement>('.min-rail .min-card .min-card__close');
    expect(btn, '交互态卡内渲行内关闭钮').not.toBeNull();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const closes = onTermCommand.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'close');
    expect(closes.length, '死会话走 close 直移除').toBe(1);
    expect(closes[0].terminalId).toBe('m1');
    // stopPropagation：点 × 不冒泡成卡片单击（不发 restoreTile）
    expect(actionsOf(onAction, 'restoreTile').length, '点 × 不触发恢复').toBe(0);
  });

  test('TG_MIN_card_hover_close 活会话：点 × → requestClose 确认对话框（close 全链，不直杀）', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountScreen(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', state: 'Running', cwd: '/Users/rl/mini', customName: '后台任务', lastLine: 'a' }),
        ],
      }),
      onAction,
      onTermCommand,
    );
    const btn = document.querySelector<HTMLButtonElement>('.min-rail .min-card .min-card__close');
    expect(btn, 'live 宿主卡内渲行内关闭钮').not.toBeNull();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    // 活会话不直杀：出确认对话框（close-confirm-dialog），且未发 close/restoreTile
    expect(document.querySelector('.close-confirm-dialog'), '活会话出确认对话框').not.toBeNull();
    const closes = onTermCommand.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'close');
    expect(closes.length, '未确认前不发 close').toBe(0);
    expect(actionsOf(onAction, 'restoreTile').length, '点 × 不触发恢复').toBe(0);
  });

  test('lastLine 摘要：携带则显示、缺席则不渲该行', async () => {
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/m1', lastLine: '✓ build 完成 · 12 tests passed' }),
          mini({ id: 'm2', cwd: '/Users/rl/m2' }),
        ],
      }),
      { onAction: vi.fn(), onTermCommand: vi.fn() },
    );
    const cards = document.querySelectorAll('.min-rail .min-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.min-card__lastline')?.textContent).toBe(
      '✓ build 完成 · 12 tests passed',
    );
    expect(cards[1].querySelector('.min-card__lastline'), '无 lastLine 不渲摘要行').toBeNull();
  });

  test('screenshot 态（无 onAction/无 provider）：边栏渲染但恢复/收起按钮 inert', async () => {
    await mountGrid(
      fixture({
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
          mini({ id: 'm1', cwd: '/Users/rl/mini', lastLine: 'a' }),
        ],
      }),
    );
    // 边栏由 fx 数据驱动、截图态照渲（golden 侧）；「收起」按钮 live 门控 → 截图态零渲染
    expect(document.querySelector('.min-rail .min-card'), '截图态边栏照渲').not.toBeNull();
    expect(document.querySelector('.tile-minimize-btn'), '截图态无收起按钮（live 门控）').toBeNull();
    // 行内关闭钮同 golden 守卫：截图态（无 onTermCommand/live）不渲 → DOM 与 golden 零动
    expect(document.querySelector('.min-card__close'), '截图态无行内关闭钮').toBeNull();
    // 单击卡片无 onAction → 无副作用（不抛错、菜单不弹）
    await act(async () => {
      document
        .querySelector('.min-rail .min-card')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
        );
    });
    await flush(1);
    expect(document.querySelector('.min-rail__menu'), '截图态右键 inert').toBeNull();
  });
});
