// @vitest-environment jsdom
//
// 终端内搜索条锚定回归（与 worktree 弹窗同族 bug，fix/worktree-popover-anchor）：
// 收起终端（批A）不进 `.tile` DOM 集合 → 旧实现 querySelectorAll('.tile')[fx.terminals 全量下标]
// 越界 → 搜索条永不渲染；错位 → 贴到别的 tile。修复 = data-terminal-id 按 ID 锚定。
// jsdom getBoundingClientRect 恒 0 → 只断渲染存在与锚定命中，不断几何。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'search-anchor',
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
    terminals: [{ id: 't1', state: 'Running', cwd: '/repo', isGitRepo: true }],
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

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function mount(fx: Fixture): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TerminalScreen, { fx, onAction: vi.fn() }));
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
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('搜索条锚定：收起终端下标错位回归', () => {
  test('收起终端排在前（下标越界）：searchBar 指向可见终端时搜索条仍须渲染', async () => {
    await mount(
      baseFixture({
        searchBar: { terminalId: 't1' },
        terminals: [
          { id: 't0', state: 'Running', cwd: '/other', isGitRepo: true, minimized: true },
          { id: 't1', state: 'Running', cwd: '/repo', isGitRepo: true },
        ],
      } as Partial<Fixture>),
    );
    expect(document.querySelectorAll('.tile').length).toBe(1);
    expect(
      document.querySelector('.terminal-search-bar'),
      '有收起终端在前时搜索条仍须渲染（旧实现下标越界永不渲染）',
    ).not.toBeNull();
  });
});
