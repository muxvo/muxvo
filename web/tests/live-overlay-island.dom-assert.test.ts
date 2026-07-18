// @vitest-environment jsdom
//
// DOGFOOD_M3_04 web 侧修复的 red→green 证据关：真实 live 宿主（createRoot + act 挂
// TerminalScreen，onAction/onTermCommand 为 spy）下断言两条约定——
//   ① FAB 直建：点 FAB 不再弹 cwd-picker，直接发 term.command{create}
//   ② 浮层=岛：盖在洞上的 live 浮层（关闭确认 / 搜索条 / 等待卡）挂 data-hit-island，
//      且 MutationObserver 令 portal 挂载触发 layoutReport 重上报（岛条数 +1）。
// jsdom getBoundingClientRect 恒 0 → 只断 role/条数/属性存在，不断几何/visible。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { TermCommandRequest, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

// React 18 act 需要环境旗标，否则告警「environment is not configured to support act」。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 2 个 content 缺席终端 = 有洞路径（useLayoutReport 才采集岛）。 */
function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'live-overlay',
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
    terminals: [
      { id: 't1', state: 'Running', cwd: '/Users/rl/a' }, // content 缺席 → .tile-term-hole
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
    ],
    ...over,
  } as Fixture;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** 冲刷 microtask（MutationObserver 投递）+ setTimeout(0)（rAF stub） 数轮，让重上报落地。 */
async function flush(times = 3): Promise<void> {
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
  onTermCommand: (r: TermCommandRequest) => void,
): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TerminalScreen, { fx, onAction, onTermCommand }));
  });
  await flush();
}

/** 最新一条 layoutReport 里 role==='island' 的 rect 条数（无则 0）。 */
function islandCount(calls: unknown[][]): number {
  const reports = calls
    .map((c) => c[0] as { kind?: string; rects?: Array<{ role?: string }> })
    .filter((a) => a?.kind === 'layoutReport');
  const last = reports[reports.length - 1];
  return last?.rects ? last.rects.filter((r) => r.role === 'island').length : 0;
}

function click(el: Element | null): Promise<void> {
  return act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

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

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('DOGFOOD_M3_04：FAB 直建 + 浮层岛约定', () => {
  test('T1 FAB 直建：click FAB → onTermCommand{create}，无 .cwd-picker', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(baseFixture(), onAction, onTermCommand);

    const fab = container!.querySelector('.terminal-grid__fab');
    expect(fab, 'FAB 应存在').not.toBeNull();
    await click(fab);
    await flush();

    expect(onTermCommand).toHaveBeenCalledWith({ kind: 'create' });
    expect(document.querySelector('.cwd-picker'), '不应弹目录选择器').toBeNull();
  });

  test('T2 关闭对话框岛：click .tile-close-btn → .close-confirm-overlay 带 data-hit-island', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(baseFixture(), onAction, onTermCommand);

    const closeBtn = container!.querySelector('.tile-close-btn');
    expect(closeBtn, '关闭钮应存在').not.toBeNull();
    await click(closeBtn);
    await flush();

    const overlay = document.querySelector('.close-confirm-overlay');
    expect(overlay, '关闭确认浮层应存在').not.toBeNull();
    expect(overlay!.hasAttribute('data-hit-island'), 'overlay 应带岛标记').toBe(true);
  });

  test('T3 MutationObserver 重上报：弹窗后 island 条数 +1', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(baseFixture(), onAction, onTermCommand);

    const before = islandCount(onAction.mock.calls);
    await click(container!.querySelector('.tile-close-btn'));
    await flush();
    const after = islandCount(onAction.mock.calls);

    expect(after - before, 'portal 挂载应触发新 layoutReport 且 island +1').toBe(1);
  });

  test('T4 live 终端屏 waiting → 浮卡不挂载（DOGFOOD_M3_18 覆盖层门控）', async () => {
    // ☆ DOGFOOD_M3_18：等待浮卡改为「仅非终端覆盖层」显示（legacy WaitingInputNotification.tsx L74
    // overlayActive 门控 + 用户裁决 2026-07-07），终端屏不再常驻遮挡 FAB。故 live 终端屏（onAction 在）
    // 即便 waiting 也不挂浮卡；浮卡根 data-hit-island 的岛断言迁至覆盖层上下文
    // （waiting-card-overlay-gate.dom-assert.test.tsx「浮卡根 div 带 data-hit-island」）。
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(baseFixture({ waitingNotification: { count: 2 } }), onAction, onTermCommand);

    expect(container!.querySelector('.waiting-card__dot'), 'live 终端屏不得显示等待浮卡').toBeNull();
  });

  test('T5 LiveSearchBar：内层 .terminal-search-bar 带岛，外层 fixed 包裹不带', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(baseFixture({ searchBar: { terminalId: 't1' } }), onAction, onTermCommand);

    const bar = document.querySelector('.terminal-search-bar');
    expect(bar, '搜索条应存在').not.toBeNull();
    expect(bar!.hasAttribute('data-hit-island'), '内层搜索条应带岛标记').toBe(true);

    const fixedWrapper = bar!.parentElement!.parentElement as HTMLElement; // relative → fixed 包裹
    expect(fixedWrapper.style.position, '导航自检：外层为 fixed 包裹').toBe('fixed');
    expect(fixedWrapper.hasAttribute('data-hit-island'), '外层 fixed 包裹不得挂岛').toBe(false);
  });
});
