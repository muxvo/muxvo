// @vitest-environment jsdom
//
// DOGFOOD_M3_18 web red→green 证据关：等待浮卡 WaitingCard **只在非终端覆盖层**显示，
// 终端屏（裸网格）不显示——现场缺陷是浮卡常驻终端屏遮挡右下 FAB「+」。
// 三方对照铁证：legacy src/renderer/components/terminal/WaitingInputNotification.tsx L74
//   `if (waitingCount === 0 || !overlayActive || dismissed) return null;`
//   （overlayActive = 聊天/Skills/MCP/Hooks/Plugins/文件面板等覆盖层激活，**不含 settings**）。
// 用户裁决 2026-07-07：按 legacy 对齐——终端屏不显示，非终端 tile 视图保留 + 点击跳回终端。
// live 门控（onAction 在＝live）：截图/纯展示（onAction 缺席）仍渲染浮卡，保 golden f8 字节冻结。
// jsdom getBoundingClientRect 恒 0 → 只断存在/属性/回调，不断几何。
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import { LiveChrome } from '../src/screen/live/LiveChrome';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** t1/t3 WaitingInput、t2 Running（acknowledge 目标断言用）。 */
function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'wc-gate',
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
      { id: 't1', state: 'WaitingInput', cwd: '/Users/rl/a' },
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
      { id: 't3', state: 'WaitingInput', cwd: '/Users/rl/c' },
    ],
    ...over,
  } as Fixture;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mountEl(el: ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root!.render(el);
  });
}

/** 浮卡红点（存在＝浮卡渲染）。 */
function cardDot(): HTMLElement | null {
  return container!.querySelector('.waiting-card__dot');
}
function overlay(): HTMLElement | null {
  return container!.querySelector('.live-panel-overlay');
}
function tab(label: string): HTMLButtonElement {
  const btns = [...container!.querySelectorAll('.menu-bar__tab')] as HTMLButtonElement[];
  const f = btns.find((b) => b.textContent?.includes(label));
  if (!f) throw new Error(`菜单栏无 tab 文案含「${label}」`);
  return f;
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

describe('DOGFOOD_M3_18：等待浮卡覆盖层门控（legacy overlayActive 对齐）', () => {
  test('live 终端屏（裸网格）+ waiting → 浮卡不渲染（不再遮挡 FAB）', async () => {
    await mountEl(
      createElement(TerminalScreen, {
        fx: baseFixture({ waitingNotification: { count: 2 } }),
        onAction: vi.fn(),
        onTermCommand: vi.fn(),
      }),
    );
    expect(cardDot(), 'live 终端屏不得显示等待浮卡（legacy L74 overlayActive 门控）').toBeNull();
  });

  test('截图/纯展示模式（无 onAction）+ waiting → 浮卡仍渲染（golden f8 字节冻结保全）', async () => {
    await mountEl(
      createElement(TerminalScreen, {
        fx: baseFixture({ waitingNotification: { count: 2 } }),
      }),
    );
    expect(cardDot(), '截图/纯展示模式浮卡渲染以保 golden f8（存在:f8 终端屏+浮卡组合）').not.toBeNull();
  });

  test('配置面板（Skills）+ waiting → 浮卡渲染；点卡片正文关面板回终端', async () => {
    await mountEl(
      createElement(LiveChrome, {
        fx: baseFixture({ waitingNotification: { count: 2 } }),
        onAction: vi.fn(),
        onTermCommand: vi.fn(),
      }),
    );
    expect(cardDot(), '裸终端屏（无面板）不显示浮卡').toBeNull();

    await click(tab('Skills'));
    expect(overlay(), 'Skills 面板已开').not.toBeNull();
    expect(cardDot(), '非终端覆盖层（Skills）显示等待浮卡').not.toBeNull();

    // 点击卡片正文（非 ✕）→ onSwitchToTerminals = closePanel → 关面板回终端
    const cardRoot = cardDot()!.closest('[data-hit-island]') as HTMLElement;
    await click(cardRoot);
    expect(overlay(), '点浮卡正文切回终端（关面板）').toBeNull();
    expect(cardDot(), '回终端后浮卡随面板消失').toBeNull();
  });

  test('设置面板（settings）+ waiting → 浮卡不渲染（legacy overlayActive 排除 settings）', async () => {
    await mountEl(
      createElement(LiveChrome, {
        fx: baseFixture({ waitingNotification: { count: 2 } }),
        onAction: vi.fn(),
        onTermCommand: vi.fn(),
      }),
    );
    await click(container!.querySelector('.menu-bar__icon-btn[title="设置"]'));
    expect(overlay()?.getAttribute('data-live-panel'), 'settings 面板已开').toBe('settings');
    expect(cardDot(), 'settings 覆盖层不显示等待浮卡（legacy L74 门控集不含 settings）').toBeNull();
  });

  test('浮卡 ✕ → 对每个 WaitingInput 终端发 acknowledgeWaiting 且 stopPropagation（不切屏）', async () => {
    const onAction = vi.fn();
    await mountEl(
      createElement(LiveChrome, {
        fx: baseFixture({ waitingNotification: { count: 2 } }),
        onAction,
        onTermCommand: vi.fn(),
      }),
    );
    await click(tab('Skills'));
    const dismissBtn = container!.querySelector('button[aria-label="Dismiss"]');
    expect(dismissBtn, '✕ 应存在').not.toBeNull();

    await click(dismissBtn);
    expect(overlay(), '✕ stopPropagation：不触发切屏，面板仍开').not.toBeNull();

    const ack = onAction.mock.calls
      .map((c) => c[0] as { kind: string; terminalId?: string })
      .filter((a) => a.kind === 'acknowledgeWaiting')
      .map((a) => a.terminalId)
      .sort();
    expect(ack, '仅 WaitingInput 终端（t1/t3）各 acknowledge 一次，Running 的 t2 不发').toEqual(['t1', 't3']);
  });

  test('浮卡根 div 带 data-hit-island（覆盖层上下文；从 M3_04 T4 迁入）', async () => {
    await mountEl(
      createElement(LiveChrome, {
        fx: baseFixture({ waitingNotification: { count: 2 } }),
        onAction: vi.fn(),
        onTermCommand: vi.fn(),
      }),
    );
    await click(tab('Skills'));
    const cardRoot = cardDot()!.parentElement!.parentElement as HTMLElement; // 内层 flex → 根 div
    expect(cardRoot.style.position, '导航自检：根为 fixed').toBe('fixed');
    expect(cardRoot.hasAttribute('data-hit-island'), '等待卡根应带岛标记').toBe(true);
  });
});
