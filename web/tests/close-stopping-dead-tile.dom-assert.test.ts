// @vitest-environment jsdom
//
// DOGFOOD_M3_09 web 侧修复的 red→green 证据关：真实 live 宿主（createRoot + act 挂
// TerminalScreen）下断言关闭中 / 死 tile 视觉——
//   W1 Stopping tile（live）：.tile-closing-overlay 存在带 data-hit-island、✕ disabled、
//      点 ✕ 零 onTermCommand 且不弹确认（连点陷阱消解）。
//   W2 Stopped tile（live）：.tile-dead-badge「已停止」；✕ = 一键 REMOVE 直发 close 不弹确认。
//   W3 纯展示（无 live）含 Stopping+Stopped：无 overlay / 无 badge / ✕ 不 disabled（golden 守卫，绿→绿）。
// jsdom getBoundingClientRect 恒 0 → 只断 DOM 结构/属性存在，不断几何。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { TermCommandRequest, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture, TerminalFixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixtureWith(terminals: TerminalFixture[], over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'close-stopping-dead',
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
    terminals,
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

/** live 模式挂载（onAction+onTermCommand 齐 → LiveInteractionLayer 挂载）。 */
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

/** 纯展示挂载（无桥线缆 → useLiveInteractions 返回 null → 新交互全 inert）。 */
async function mountPure(fx: Fixture): Promise<void> {
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
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

describe('DOGFOOD_M3_09：关闭中 / 死 tile 视觉（live 门控）', () => {
  test('W1 Stopping tile：.tile-closing-overlay(带岛) + ✕ disabled + 点 ✕ 零 onTermCommand 无弹窗', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountLive(
      fixtureWith([{ id: 't1', state: 'Stopping', cwd: '/Users/rl/a' }]),
      onAction,
      onTermCommand,
    );

    const overlay = container!.querySelector('.tile-closing-overlay');
    expect(overlay, '关闭中浮层应存在').not.toBeNull();
    expect(overlay!.hasAttribute('data-hit-island'), '关闭中浮层应带岛标记（垂死终端不吃点击）').toBe(true);
    expect(overlay!.textContent, '关闭中文案').toContain('关闭中');

    const closeBtn = container!.querySelector('.tile-close-btn') as HTMLButtonElement | null;
    expect(closeBtn, '关闭钮应存在').not.toBeNull();
    expect(closeBtn!.disabled, 'Stopping 期 ✕ 应禁用').toBe(true);

    await click(closeBtn);
    await flush();
    expect(onTermCommand, '禁用 ✕ 不发 close').not.toHaveBeenCalled();
    expect(document.querySelector('.close-confirm-overlay'), 'Stopping 期点 ✕ 不弹确认（连点陷阱消解）').toBeNull();
  });

  test('W2 Stopped tile：.tile-dead-badge「已停止」+ 点 ✕ 直发 close 无弹窗', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mountLive(
      fixtureWith([{ id: 't1', state: 'Stopped', cwd: '/Users/rl/a' }]),
      onAction,
      onTermCommand,
    );

    const badge = container!.querySelector('.tile-dead-badge');
    expect(badge, '死 tile 应有已停止标签').not.toBeNull();
    expect(badge!.textContent, '标签文案「已停止」').toBe('已停止');

    const closeBtn = container!.querySelector('.tile-close-btn') as HTMLButtonElement | null;
    expect(closeBtn, '关闭钮应存在').not.toBeNull();
    expect(closeBtn!.disabled, '死 tile ✕ 不禁用').toBe(false);

    await click(closeBtn);
    await flush();
    expect(onTermCommand, '死 tile ✕ = 一键 REMOVE 直发 close').toHaveBeenCalledWith({
      kind: 'close',
      terminalId: 't1',
    });
    expect(document.querySelector('.close-confirm-overlay'), '死 tile ✕ 跳确认').toBeNull();
  });

  test('W3 纯展示（无 live）含 Stopping+Stopped：无 overlay / 无 badge / ✕ 不 disabled（golden 守卫）', async () => {
    await mountPure(
      fixtureWith([
        { id: 't1', state: 'Stopping', cwd: '/Users/rl/a' },
        { id: 't2', state: 'Stopped', cwd: '/Users/rl/b' },
      ]),
    );

    expect(container!.querySelector('.tile-closing-overlay'), '纯展示无关闭中浮层').toBeNull();
    expect(container!.querySelector('.tile-dead-badge'), '纯展示无已停止标签').toBeNull();
    expect(container!.querySelector('.tile--stopping'), '纯展示无 stopping 类').toBeNull();
    const closeBtns = container!.querySelectorAll('.tile-close-btn');
    expect(closeBtns.length, '两 tile 两关闭钮').toBe(2);
    closeBtns.forEach((b) =>
      expect((b as HTMLButtonElement).disabled, '纯展示 ✕ 均不禁用').toBe(false),
    );
  });
});
