// @vitest-environment jsdom
//
// DOGFOOD_M3_19 web 侧 red→green 证据关：真实 live 宿主（createRoot + act 挂 TerminalScreen，
// onAction/onTermCommand 为 spy）下断言整 app 退出确认对话框——
//   ① quitConfirm 非空 → 渲染 .app-close-overlay（legacy 类名，close-confirm-dialog.md §3）+ data-hit-island
//   ② 两态文案：terminalCount>0 →「当前有 N 个终端正在运行，退出后将全部终止。」，否则「确定要退出 Muxvo 吗？」
//   ③ 标题「退出 Muxvo」、确认钮「退出」、取消钮「取消」
//   ④ 确认→confirmQuit / 取消钮/遮罩点→cancelQuit / Esc→cancelQuit
//   ⑤ 截图模式（无 onAction/onTermCommand → 无 LiveInteractionLayer）→ 零渲染
// jsdom getBoundingClientRect 恒 0 → 只断类名/文案/属性/action，不断几何。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import { quitConfirmMessage } from '../src/screen/live/LiveInteractions';
import type { TermCommandRequest, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'quit-confirm',
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
    quitConfirm: null,
    palette: { background: '#1e1e1e', foreground: '#cccccc' },
    terminals: [
      { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
    ],
    ...over,
  } as Fixture;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** live 宿主：带 onAction/onTermCommand → 挂 LiveInteractionLayer。 */
async function mountLive(
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

/** 截图/纯展示宿主：无桥线缆 → 不挂 LiveInteractionLayer。 */
async function mountScreenshot(fx: Fixture): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TerminalScreen, { fx }));
  });
  await flush();
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

describe('quitConfirmMessage 两态文案纯函数', () => {
  test('terminalCount>0 → 运行终端警告；==0 → 确认退出', () => {
    expect(quitConfirmMessage(3)).toBe('当前有 3 个终端正在运行，退出后将全部终止。');
    expect(quitConfirmMessage(1)).toBe('当前有 1 个终端正在运行，退出后将全部终止。');
    expect(quitConfirmMessage(0)).toBe('确定要退出 Muxvo 吗？');
  });
});

describe('DOGFOOD_M3_19：整 app 退出确认对话框（live）', () => {
  test('T1 quitConfirm 非空 → .app-close-overlay 带 data-hit-island；标题/确认钮文案', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountLive(baseFixture({ quitConfirm: { terminalCount: 2 } }), onAction, onTermCommand);

    const overlay = document.querySelector('.app-close-overlay');
    expect(overlay, '整 app 退出遮罩应存在').not.toBeNull();
    expect(overlay!.hasAttribute('data-hit-island'), 'overlay 应带岛标记').toBe(true);
    expect(document.querySelector('.close-confirm-title')?.textContent).toBe('退出 Muxvo');
    expect(document.querySelector('.close-confirm-ok')?.textContent).toBe('退出');
    expect(document.querySelector('.close-confirm-cancel')?.textContent).toBe('取消');
  });

  test('T2 文案两态：terminalCount>0 警告；==0 确认', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountLive(baseFixture({ quitConfirm: { terminalCount: 2 } }), onAction, onTermCommand);
    expect(document.querySelector('.close-confirm-message')?.textContent).toBe(
      '当前有 2 个终端正在运行，退出后将全部终止。',
    );

    await act(async () => root!.render(createElement(TerminalScreen, {
      fx: baseFixture({ quitConfirm: { terminalCount: 0 } }), onAction, onTermCommand,
    })));
    await flush();
    expect(document.querySelector('.close-confirm-message')?.textContent).toBe('确定要退出 Muxvo 吗？');
  });

  test('T3 确认钮 → confirmQuit；取消钮 → cancelQuit；遮罩点 → cancelQuit', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountLive(baseFixture({ quitConfirm: { terminalCount: 2 } }), onAction, onTermCommand);

    await click(document.querySelector('.close-confirm-ok'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'confirmQuit' });

    onAction.mockClear();
    await click(document.querySelector('.close-confirm-cancel'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'cancelQuit' });

    onAction.mockClear();
    await click(document.querySelector('.app-close-overlay')); // 点遮罩 = 取消
    expect(onAction).toHaveBeenCalledWith({ kind: 'cancelQuit' });
  });

  test('T4 Esc → cancelQuit', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountLive(baseFixture({ quitConfirm: { terminalCount: 2 } }), onAction, onTermCommand);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledWith({ kind: 'cancelQuit' });
  });

  test('T5 弹窗体 stopPropagation：点对话框内部不触发遮罩取消', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountLive(baseFixture({ quitConfirm: { terminalCount: 2 } }), onAction, onTermCommand);

    await click(document.querySelector('.close-confirm-dialog'));
    expect(onAction).not.toHaveBeenCalledWith({ kind: 'cancelQuit' });
  });

  test('T6 截图模式零渲染：无桥线缆 + quitConfirm 非空 → 无 .app-close-overlay', async () => {
    await mountScreenshot(baseFixture({ quitConfirm: { terminalCount: 2 } }));
    expect(document.querySelector('.app-close-overlay'), '截图模式不得渲染退出确认').toBeNull();
  });
});
