// @vitest-environment jsdom
//
// M6 批1 web：LiveChrome 配置面板路由 red→green 证据关（CONFIG_L1_09/15/19/20/21/25）。
// 真实 live 宿主（createRoot + act 挂 LiveChrome，onAction/onTermCommand 为 spy）下断言面板
// 路由 / 互斥 / 角标 / Esc·终端 tab 关闭。面板槽断言用**注册机制无关的 data-live-panel 属性 + overlay
// 存在性**，不依赖 A3 交付的面板组件（未注册 → 空槽，属性仍在）。
// jsdom getBoundingClientRect 恒 0 → 只断存在/属性/类名，不断几何。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LiveChrome } from '../src/screen/live/LiveChrome';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 3 个终端（角标断言用 count=3）；content 缺席 = 有洞（不影响本关断言）。 */
function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'live-chrome',
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
      { id: 't1', state: 'Running', cwd: '/Users/rl/a' },
      { id: 't2', state: 'Running', cwd: '/Users/rl/b' },
      { id: 't3', state: 'Running', cwd: '/Users/rl/c' },
    ],
    ...over,
  } as Fixture;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(): Promise<{ onAction: ReturnType<typeof vi.fn>; onTermCommand: ReturnType<typeof vi.fn> }> {
  const onAction = vi.fn();
  const onTermCommand = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(LiveChrome, { fx: baseFixture(), onAction, onTermCommand }));
  });
  return { onAction, onTermCommand };
}

/** 按可见文案取菜单栏 tab 按钮（终端 tab textContent 含角标数字，故用 includes）。 */
function tab(label: string): HTMLButtonElement {
  const btns = [...container!.querySelectorAll('.menu-bar__tab')] as HTMLButtonElement[];
  const found = btns.find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`菜单栏无 tab 文案含「${label}」`);
  return found;
}

function overlay(): HTMLElement | null {
  return container!.querySelector('.live-panel-overlay');
}

function click(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function pressEsc(): Promise<void> {
  return act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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

describe('LiveChrome 配置面板路由（M6 批1）', () => {
  test('CONFIG_L1_19: 终端态无 overlay，点配置 tab → overlay 挂载 + activeTab 高亮', async () => {
    await mount();
    expect(overlay(), '终端态初始无面板 overlay').toBeNull();
    expect(tab('终端').classList.contains('menu-bar__tab--active'), '初始终端 tab 高亮').toBe(true);

    await click(tab('Skills'));
    expect(overlay(), '点配置 tab 后 overlay 挂载').not.toBeNull();
    expect(tab('Skills').classList.contains('menu-bar__tab--active'), '目标 tab 高亮').toBe(true);
    expect(tab('终端').classList.contains('menu-bar__tab--active'), '终端 tab 让出高亮').toBe(false);
  });

  test('CONFIG_L1_20: Skills tab → skills 面板槽挂载', async () => {
    await mount();
    await click(tab('Skills'));
    expect(overlay()?.getAttribute('data-live-panel'), 'skills 槽').toBe('skills');
    expect(overlay()?.hasAttribute('data-hit-island'), 'overlay 挂岛（盖住终端洞）').toBe(true);
  });

  test('CONFIG_L1_21: Hooks tab → hooks 面板槽挂载', async () => {
    await mount();
    await click(tab('Hooks'));
    expect(overlay()?.getAttribute('data-live-panel')).toBe('hooks');
  });

  test('CONFIG_L1_25: MCP tab → mcp 面板槽挂载', async () => {
    await mount();
    await click(tab('MCP'));
    expect(overlay()?.getAttribute('data-live-panel')).toBe('mcp');
  });

  test('CONFIG_L1_15: Esc 关当前面板；终端 tab 关全部', async () => {
    await mount();
    await click(tab('Skills'));
    expect(overlay(), '面板已开').not.toBeNull();
    await pressEsc();
    expect(overlay(), 'Esc 后面板关闭').toBeNull();

    // 终端 tab 关全部：再开一面板，点终端 tab → 关闭
    await click(tab('MCP'));
    expect(overlay(), '再开 mcp 面板').not.toBeNull();
    await click(tab('终端'));
    expect(overlay(), '点终端 tab 关全部').toBeNull();
  });

  test('CONFIG_L1_09: 面板 open-state 互斥 + 终端计数角标', async () => {
    await mount();
    // 计数角标（count=3）
    const badge = container!.querySelector('.menu-bar__badge');
    expect(badge?.textContent, '终端角标显示计数').toBe('3');

    // 互斥：开 skills 再开 mcp → 单一 overlay，只余 mcp（单 state 天然互斥，无双面板并存）
    await click(tab('Skills'));
    expect(overlay()?.getAttribute('data-live-panel')).toBe('skills');
    await click(tab('MCP'));
    const overlays = container!.querySelectorAll('.live-panel-overlay');
    expect(overlays.length, '任一时刻至多一个面板 overlay').toBe(1);
    expect(overlays[0].getAttribute('data-live-panel'), '切到 mcp，skills 已关').toBe('mcp');
  });

  test('MB_HELP_click_chain: 问号帮助钮 → 先关面板 + 发 helpOpen（menu-bar.md §6，B3）', async () => {
    const { onAction } = await mount();
    // 先开一个面板（对齐 legacy「点问号先 closeAllPanels」的可观察前提）。
    await click(tab('Skills'));
    expect(overlay(), '前提：面板已开').not.toBeNull();

    const help = [...container!.querySelectorAll('.menu-bar__icon-btn')].find(
      (b) => (b as HTMLElement).title === '帮助',
    );
    expect(help, '菜单栏有问号帮助钮').toBeTruthy();
    await click(help!);

    expect(overlay(), '点问号后覆盖面板关闭').toBeNull();
    expect(onAction, '发 helpOpen 动作').toHaveBeenCalledWith({ kind: 'helpOpen' });
  });
});
