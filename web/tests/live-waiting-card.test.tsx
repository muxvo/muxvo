// @vitest-environment jsdom
//
// DOGFOOD_M3_18 单测：LiveWaitingCard（等待浮卡 live 覆盖层托管）契约——
//   ① fx.waitingNotification 缺席 → 不渲染（null）。
//   ② 有值 → 渲染 count；点卡片正文 → onSwitchToTerminals（各挂载方注入 setPanel(null)/chatClose/
//      exitTaskCenter，本组件只回调）。
//   ③ ✕ → 对每个 WaitingInput 终端 acknowledgeWaiting，且 stopPropagation 不触发 onSwitchToTerminals。
// main.tsx 的 chatHistory/taskCenter 分支借本组件切回终端，路由层难单测 → 以本单测锁契约。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LiveWaitingCard } from '../src/screen/live/LiveWaitingCard';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'lwc',
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

function mount(fx: Fixture, sendAction = vi.fn(), onSwitch = vi.fn()): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root!.render(createElement(LiveWaitingCard, { fx, sendAction, onSwitchToTerminals: onSwitch }));
  });
}
function click(el: Element | null): Promise<void> {
  return act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('LiveWaitingCard（DOGFOOD_M3_18）', () => {
  test('waitingNotification 缺席 → 不渲染', async () => {
    await mount(baseFixture({ waitingNotification: null }));
    expect(container!.querySelector('.waiting-card__dot'), '无 waiting 不渲染浮卡').toBeNull();
  });

  test('有值 → 渲染计数；点卡片正文 → onSwitchToTerminals', async () => {
    const onSwitch = vi.fn();
    await mount(baseFixture({ waitingNotification: { count: 2 } }), vi.fn(), onSwitch);
    const dot = container!.querySelector('.waiting-card__dot');
    expect(dot, '浮卡渲染').not.toBeNull();
    expect(container!.textContent, '显示计数文案').toContain('2 等待操作');

    await click(dot!.closest('[data-hit-island]'));
    expect(onSwitch, '点卡片正文回调 onSwitchToTerminals').toHaveBeenCalledTimes(1);
  });

  test('✕ → 每个 WaitingInput 终端 acknowledgeWaiting，且 stopPropagation 不触发切屏', async () => {
    const sendAction = vi.fn();
    const onSwitch = vi.fn();
    await mount(baseFixture({ waitingNotification: { count: 2 } }), sendAction, onSwitch);

    await click(container!.querySelector('button[aria-label="Dismiss"]'));
    expect(onSwitch, '✕ stopPropagation：不触发切屏').not.toHaveBeenCalled();

    const ack = sendAction.mock.calls
      .map((c) => c[0] as { kind: string; terminalId?: string })
      .filter((a) => a.kind === 'acknowledgeWaiting')
      .map((a) => a.terminalId)
      .sort();
    expect(ack, 'WaitingInput 的 t1/t3 各清一次，Running 的 t2 不发').toEqual(['t1', 't3']);
  });
});
