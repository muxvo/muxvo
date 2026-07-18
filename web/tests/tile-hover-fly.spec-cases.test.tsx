// @vitest-environment jsdom
//
// dogfood-r6 两条 UI 反馈的 web 半（term-grid §4.1 tooltip + §11.3 收起飞行动画；r6-fix 真机否决
// 回修 2026-07-12 后语义）：
//   · TG_HDR_hover_tooltips —— tile 头按钮悬停 160ms 出自绘气泡（HoverTip）、离开即收、快扫不出、
//     mousemove 自愈补武装（mouseenter 被吞面）。
//   · TG_MIN_fly_ghost —— 点「收起」产生飞行幽灵框、起飞后飞满 380ms 不被截杀（cleanup 从起飞
//     起算，真机取证 B2 定谳）、动画后移除、reduced-motion 不产生。
// 断言面 = 真实工件 TileHeader（HoverTip 接线）+ minimizeFlyGhost.flyToRail（经 live 收起按钮触发）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TermGrid } from '../src/grid/TermGrid';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type {
  FsResponse,
  TermCommandRequest,
  TermCommandResponse,
} from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'hover-fly',
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
      { id: 't1', state: 'Running', cwd: '/Users/rl/a', isGitRepo: true },
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

async function mountGrid(fx: Fixture, onAction = vi.fn()): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TermGrid, { fx, onAction, onTermCommand: vi.fn() }));
  });
  await flush();
}

/** live 全接线宿主（收起按钮才渲）。 */
async function mountScreen(fx: Fixture, onAction = vi.fn()): Promise<void> {
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
        onTermCommand: vi.fn() as (r: TermCommandRequest) => void,
        onFsRequest: onFsRequest as never,
        onTermRequest: onTermRequest as never,
      }),
    );
  });
  await flush();
}

afterEach(async () => {
  vi.useRealTimers();
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

// ──────────────────────────────────────────────────────────────────────────────
describe('TG_HDR_hover_tooltips —— tile 头按钮自绘悬停 tooltip', () => {
  test('悬停 160ms 后出气泡=按钮文案；离开即收', async () => {
    await mountGrid(fixture());
    const closeBtn = document.querySelector<HTMLButtonElement>('.tile-close-btn')!;
    expect(closeBtn.getAttribute('title'), 'title 保留作测试锚').toBe('关闭终端');

    vi.useFakeTimers();
    // 悬停进入（React onMouseEnter 由 mouseover 触发，同 min-rail tooltip 先例）
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    // 160ms 前不出（快速反馈不闪）
    act(() => {
      vi.advanceTimersByTime(159);
    });
    expect(document.querySelector('.hover-tip'), '160ms 前不出').toBeNull();
    // 跨过 160ms → 气泡出现，文案=按钮说明
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const tip = document.querySelector('.hover-tip');
    expect(tip, '160ms 后出气泡').not.toBeNull();
    expect(tip!.textContent).toBe('关闭终端');
    // 离开即收
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(document.querySelector('.hover-tip'), '离开即收').toBeNull();
  });

  test('快速扫过（<160ms 内离开）→ 气泡不出', async () => {
    await mountGrid(fixture());
    const fileBtn = document.querySelector<HTMLButtonElement>('.tile-file-btn')!;
    vi.useFakeTimers();
    act(() => {
      fileBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      fileBtn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    // 再推进过原定 160ms 门槛：因已 mouseout 清定时器 → 永不出
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.hover-tip'), '快扫不出').toBeNull();
  });

  test('mousemove 自愈：mouseenter 被吞（只来 mousemove）也出气泡（WKWebView 穿透洞跨界面）', async () => {
    await mountGrid(fixture());
    const closeBtn = document.querySelector<HTMLButtonElement>('.tile-close-btn')!;
    vi.useFakeTimers();
    // 不派 mouseover——模拟真机 native 层吞掉 enter，只有悬停期间的 move 到达
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(document.querySelector('.hover-tip'), 'move 补武装出泡').not.toBeNull();
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(document.querySelector('.hover-tip')).toBeNull();
  });

  test('mousemove 不重置在跑的定时器（抖动光标也能到点出泡）', async () => {
    await mountGrid(fixture());
    const closeBtn = document.querySelector<HTMLButtonElement>('.tile-close-btn')!;
    vi.useFakeTimers();
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    // 100ms 时来一发 move：若错误地重置定时器，160ms 总刻度就不会出泡
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(document.querySelector('.hover-tip'), 'enter 起算 160ms 到点出泡').not.toBeNull();
  });

  test('mousedown 即收且抑制自愈回弹；mouseenter 解除抑制', async () => {
    await mountGrid(fixture());
    const closeBtn = document.querySelector<HTMLButtonElement>('.tile-close-btn')!;
    vi.useFakeTimers();
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(document.querySelector('.hover-tip')).not.toBeNull();
    // 按下 → 即收；悬停不动继续 move → 不回弹（抑制自愈）
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.hover-tip'), '按下即收').toBeNull();
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(document.querySelector('.hover-tip'), '按下后 move 不回弹').toBeNull();
    // 重新进入 → 解除抑制，160ms 后正常出泡
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      closeBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(document.querySelector('.hover-tip'), '再进入正常出泡').not.toBeNull();
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
  });

  test('多按钮各自文案：文件=「文件」、worktree=「Worktree」', async () => {
    await mountGrid(fixture());
    const fileBtn = document.querySelector<HTMLButtonElement>('.tile-file-btn')!;
    expect(fileBtn.getAttribute('title')).toBe('文件');
    const wtBtn = document.querySelector<HTMLButtonElement>('.tile-worktree-btn')!;
    expect(wtBtn.getAttribute('title')).toBe('Worktree');
    vi.useFakeTimers();
    act(() => {
      fileBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(160);
    });
    expect(document.querySelector('.hover-tip')!.textContent).toBe('文件');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('TG_MIN_fly_ghost —— 收起飞行幽灵框', () => {
  test('点「收起」→ 幽灵框出现、起飞后飞满 380ms 不被截杀、动画后移除', async () => {
    await mountScreen(fixture());
    const minBtn = document.querySelector<HTMLButtonElement>('.tile-minimize-btn');
    expect(minBtn, 'live 才渲收起按钮').not.toBeNull();
    // 点击 = 立即挂幽灵框（纯装饰，同步 append，不阻塞 minimizeTile）
    await act(async () => {
      minBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const ghost = document.querySelector<HTMLElement>('.min-fly-ghost');
    expect(ghost, '点收起产生幽灵框').not.toBeNull();
    expect(ghost!.getAttribute('data-term-id')).toBe('t1');
    expect(ghost!.style.pointerEvents, '不截击').toBe('');
    // 幽灵框天然不进洞清单（无 data-term-hole）
    expect(ghost!.hasAttribute('data-term-hole')).toBe(false);
    // 收纳点等待窗（240ms）+ 余量后：jsdom 无 rail dot → 回退点起飞（inline transition 已设）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    const flying = document.querySelector<HTMLElement>('.min-fly-ghost');
    expect(flying, '起飞后仍在飞（不被 append 基准定时器截杀——r6-fix 取证 B2 定谳）').not.toBeNull();
    expect(flying!.style.transition, '已设 transition（起飞证据）').toContain('380ms');
    // 起飞(~240-300ms) + 飞行 380ms + 兜底 250ms 全部走完 → 移除（防泄漏）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    expect(document.querySelector('.min-fly-ghost'), '动画后移除').toBeNull();
  });

  test('prefers-reduced-motion: reduce → 不产生幽灵框（无障碍豁免）', async () => {
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (q: string) =>
      ({
        matches: /prefers-reduced-motion/.test(q),
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList;
    await mountScreen(fixture());
    const minBtn = document.querySelector<HTMLButtonElement>('.tile-minimize-btn')!;
    await act(async () => {
      minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.min-fly-ghost'), 'reduced-motion 不产生动画').toBeNull();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });
});
