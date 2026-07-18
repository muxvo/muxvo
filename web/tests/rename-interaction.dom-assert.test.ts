// @vitest-environment jsdom
//
// DOGFOOD_M3_15 改名交互 red→green 证据关（真实 live 宿主，照 live-overlay-island 骨架）：
//   W1 单击名称区进入编辑（spec term-grid §4.4「点击进入编辑」；现状 onDoubleClick 红）
//   W2 单击进编辑不冒泡 tileClick（stopPropagation，legacy useNaming 先例）
//   W3 编辑态挂全窗透明岛（.rename-blur-guard data-hit-island，MutationObserver 重上报岛 +1）
//   W4 编辑态点输入框外（洞元素）→ renameSubmit 提交 + 退出；W4b 点输入框内不提交
//   W5 输入框 blur → 提交（spec「blur 确认」；现状 cancel 丢弃红）
//   W6 回归：Enter 提交 / Esc 取消（不发桥）；截图模式零 backdrop（golden 守卫）
// jsdom getBoundingClientRect 恒 0 → 岛只断属性/条数不断几何。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { TermCommandRequest, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'rename-live',
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
      { id: 't1', state: 'Running', cwd: '/Users/rl/a', customName: '旧名' }, // content 缺席 → 洞
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
    ],
    ...over,
  } as Fixture;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// jsdom 无 ResizeObserver/rAF：打桩（照 live-overlay-island 骨架）。
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
  onAction?: (a: UIAction) => void,
  onTermCommand?: (r: TermCommandRequest) => void,
): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TerminalScreen, { fx, onAction, onTermCommand }));
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
});

/** t1 名称区（已命名态 span）。 */
function nameSpan(): HTMLElement {
  const spans = Array.from(document.querySelectorAll<HTMLElement>('.tile-name-clickable'));
  expect(spans.length).toBeGreaterThan(0);
  return spans[0];
}

function editingInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.tile-custom-name-input');
}

/** React 受控输入赋值：必须走原生 value setter + input 事件（绕过 React 的 value 跟踪去重）。 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 单击进入 t1 编辑态（W1 主张的路径；红期本函数即失败点）。 */
async function enterEditByClick(): Promise<void> {
  await act(async () => {
    nameSpan().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush(1);
}

function renameSubmits(onAction: ReturnType<typeof vi.fn>): Array<{ name: string }> {
  return onAction.mock.calls
    .map((c) => c[0] as { kind?: string; name?: string })
    .filter((a) => a?.kind === 'renameSubmit') as Array<{ name: string }>;
}

function tileClicks(onAction: ReturnType<typeof vi.fn>): number {
  return onAction.mock.calls
    .map((c) => c[0] as { kind?: string })
    .filter((a) => a?.kind === 'tileClick').length;
}

describe('DOGFOOD_M3_15 改名交互（单击进入 + 点外提交）', () => {
  test('W1: 单击名称区进入编辑态（spec §4.4 点击进入编辑）', async () => {
    const onAction = vi.fn();
    await mount(baseFixture(), onAction, vi.fn());
    expect(editingInput()).toBeNull();
    await enterEditByClick();
    expect(editingInput(), '单击后应出现编辑输入框（现状须双击 → 红）').not.toBeNull();
  });

  test('W2: 单击进编辑不冒泡 tileClick（stopPropagation）', async () => {
    const onAction = vi.fn();
    await mount(baseFixture(), onAction, vi.fn());
    await enterEditByClick();
    expect(editingInput()).not.toBeNull();
    expect(tileClicks(onAction), '名称单击不得同时选中 tile').toBe(0);
  });

  test('W3: 编辑态挂全窗透明岛（.rename-blur-guard data-hit-island）且 layoutReport 岛 +1', async () => {
    const onAction = vi.fn();
    await mount(baseFixture(), onAction, vi.fn());
    const islandsBefore = document.querySelectorAll('[data-hit-island]').length;
    await enterEditByClick();
    const guard = document.querySelector('.rename-blur-guard');
    expect(guard, '编辑态应挂全窗透明岛（native 拦回洞区点击）').not.toBeNull();
    expect(guard!.hasAttribute('data-hit-island')).toBe(true);
    expect(document.querySelectorAll('[data-hit-island]').length).toBe(islandsBefore + 1);
    // MutationObserver 重上报：最新 layoutReport 含 island rect（jsdom 几何恒 0，只断条数方向）
    await flush();
    const reports = onAction.mock.calls
      .map((c) => c[0] as { kind?: string; rects?: Array<{ role?: string }> })
      .filter((a) => a?.kind === 'layoutReport');
    const lastIslands = reports.length
      ? (reports[reports.length - 1].rects ?? []).filter((r) => r.role === 'island').length
      : 0;
    expect(lastIslands, '编辑岛应进入 layoutReport').toBeGreaterThan(0);
  });

  test('W4: 编辑态点输入框外（洞元素）→ renameSubmit 提交并退出；W4b 点输入框内不提交', async () => {
    const onAction = vi.fn();
    await mount(baseFixture(), onAction, vi.fn());
    await enterEditByClick();
    const input = editingInput()!;
    await act(async () => {
      setInputValue(input, '新名字');
    });

    // W4b 先验：mousedown 落输入框内 → 不提交不退出。
    await act(async () => {
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(renameSubmits(onAction).length).toBe(0);
    expect(editingInput()).not.toBeNull();

    // W4 主证：mousedown 落洞元素（编辑岛拦回后的 DOM 命中点）→ 提交 + 退出。
    const hole = document.querySelector<HTMLElement>('.tile-term-hole')!;
    await act(async () => {
      hole.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await flush(1);
    const submits = renameSubmits(onAction);
    expect(submits.length, '点外应提交（现状无 document 监听 → 红）').toBe(1);
    expect(submits[0].name).toBe('新名字');
    expect(editingInput(), '提交后应退出编辑态').toBeNull();
  });

  test('W5: 输入框 blur → 提交（spec「blur 确认」；现状 cancel 丢弃 → 红）', async () => {
    const onAction = vi.fn();
    await mount(baseFixture(), onAction, vi.fn());
    await enterEditByClick();
    const input = editingInput()!;
    await act(async () => {
      setInputValue(input, 'blur名');
    });
    await act(async () => {
      // React onBlur 经 focusout 委托（blur 不冒泡进不了 root 委托）。
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    const submits = renameSubmits(onAction);
    expect(submits.length).toBe(1);
    expect(submits[0].name).toBe('blur名');
    expect(editingInput()).toBeNull();
  });

  test('W6: Enter 提交 / Esc 取消（不发桥）回归；编辑退出后岛卸载', async () => {
    const onAction = vi.fn();
    await mount(baseFixture(), onAction, vi.fn());

    await enterEditByClick();
    let input = editingInput()!;
    await act(async () => {
      setInputValue(input, '回车名');
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(renameSubmits(onAction).length).toBe(1);
    expect(renameSubmits(onAction)[0].name).toBe('回车名');
    expect(editingInput()).toBeNull();
    expect(document.querySelector('.rename-blur-guard'), '退出后岛应卸载').toBeNull();

    await enterEditByClick();
    input = editingInput()!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(renameSubmits(onAction).length, 'Esc 取消不发桥').toBe(1);
    expect(editingInput()).toBeNull();
  });

  test('W6b: 截图模式（无 onAction）零编辑岛零监听（golden 守卫）', async () => {
    await mount(baseFixture());
    expect(document.querySelector('.rename-blur-guard')).toBeNull();
    // 名称单击在截图模式 inert（live 为 null）
    const span = document.querySelector<HTMLElement>('.tile-name-clickable');
    if (span) {
      await act(async () => {
        span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
    expect(editingInput()).toBeNull();
  });
});
