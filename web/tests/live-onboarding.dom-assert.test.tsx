// @vitest-environment jsdom
//
// 首启导览编排（右上角批 B4；welcome-overlay.md §4 WEL_* + tour-overlay.md §7.1 TOUR_replay）：
// LiveOnboarding 在真实 ConfigProvider（假桥）下——首启 1.5s 门（fake timers）、两钮写
// tourCompleted、设置重放信箱直进导览（跳过欢迎卡）。driver.js 以 vi.mock 替身（jsdom 无真锚点/
// 字体度量，驱动行为归真机；本关把守编排状态机与写点）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider } from '../src/config/ConfigContext';
import { LiveOnboarding } from '../src/screen/live/LiveOnboarding';
import { requestTourStart } from '../src/screen/live/tourIntent';
import type { BridgeApi } from '../src/bridge/client';
import type { ConfigRequest, ConfigSnapshot, PrefsPatch } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// driver.js 替身：drive/destroy/moveNext 全 spy（真挖孔/定位归真机 dogfood）。
const driverSpies = {
  drive: vi.fn(),
  destroy: vi.fn(),
  moveNext: vi.fn(),
  hasNextStep: vi.fn(() => true),
  getActiveIndex: vi.fn(() => 0),
  setSteps: vi.fn(),
};
vi.mock('driver.js', () => ({
  driver: vi.fn(() => driverSpies),
}));

function snapshotFixture(over: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    startupTerminalCount: 1,
    doubleClickToFocus: false,
    dockBadgeMode: 'realtime',
    dockBadgeIntervalMin: 1,
    defaultTerminalCwd: '',
    showHiddenFiles: false,
    language: 'zh',
    theme: 'dark',
    terminalThemeName: 'dark',
    fontSize: 14,
    gridLayout: { columnRatios: [1], rowRatios: [1] },
    ftvLeftWidth: 250,
    ftvRightWidth: 280,
    archiveEnabled: true,
    tourCompleted: false,
    ...over,
  };
}

function fxFixture(): Fixture {
  return {
    id: 'onboarding',
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
    terminals: [{ id: 't1', state: 'Running', cwd: '/Users/rl' }],
  } as Fixture;
}

function makeBridge(snapshot: ConfigSnapshot): { bridge: BridgeApi; setPatches: PrefsPatch[] } {
  const setPatches: PrefsPatch[] = [];
  const bridge: BridgeApi = {
    sendAction: vi.fn(),
    sendTelemetry: vi.fn(),
    sendTermCommand: vi.fn(),
    sendOrchCommand: vi.fn(),
    sendOrchQuery: vi.fn(),
    sendFsRequest: vi.fn(),
    subscribeDataEvent: vi.fn(() => () => {}),
    getAppVersion: vi.fn(() => null),
    sendChatRequest: vi.fn(),
    sendConfigRequest: vi.fn((req: ConfigRequest) => {
      if (req.kind === 'get') return Promise.resolve({ kind: 'snapshot' as const, config: snapshot });
      if (req.kind === 'set') {
        setPatches.push(req.patch);
        return Promise.resolve({ kind: 'snapshot' as const, config: { ...snapshot, ...req.patch } });
      }
      return Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' });
    }),
    sendAppRequest: vi.fn(),
  };
  return { bridge, setPatches };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(bridge: BridgeApi): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ConfigProvider, {
        bridge,
        children: createElement(LiveOnboarding, { fx: fxFixture() }),
      }),
    );
  });
  // ConfigProvider get 响应落地
  await act(async () => {
    await Promise.resolve();
  });
}

const welcome = (): Element | null => document.querySelector('.welcome-overlay');

beforeEach(() => {
  vi.useFakeTimers();
  driverSpies.drive.mockClear();
  driverSpies.destroy.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
  document.querySelectorAll('.welcome-overlay, .tour-complete-toast').forEach((el) => el.remove());
});

describe('首启导览编排（B4）', () => {
  test('WEL_first_launch_gate：tourCompleted=false → 1.5s 后出欢迎卡；=true → 永不出', async () => {
    const { bridge } = makeBridge(snapshotFixture({ tourCompleted: false }));
    await mount(bridge);
    expect(welcome(), '1.5s 前不出').toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(welcome(), '1.5s 后欢迎卡出现').not.toBeNull();

    // 对照：已完成导览 → 不出
    act(() => root?.unmount());
    container?.remove();
    const { bridge: b2 } = makeBridge(snapshotFixture({ tourCompleted: true }));
    await mount(b2);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(welcome(), '已完成导览永不弹').toBeNull();
  });

  test('WEL_hit_layer_fullscreen：命中层 data-hit-island 全屏 fixed（发布阻断回修防回归——命中层塌 0 高度 → 岛 visible:false → 点击穿透终端、按钮真机点不动，jsdom 无布局测不出 hit-test，故断 inline style 几何契约）', async () => {
    const { bridge } = makeBridge(snapshotFixture({ tourCompleted: false }));
    await mount(bridge);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    const hit = document.querySelector('[data-hit-island][data-live-welcome]') as HTMLElement | null;
    expect(hit, '欢迎卡命中层存在').not.toBeNull();
    // 命中层必须自身覆盖全屏：内层 .welcome-overlay 是 position:fixed（脱流），外层若无 fixed 会塌 0 高度。
    expect(hit!.style.position, '命中层必须 fixed（否则外层塌 0 高度 → useLayoutReport 上报零高度岛 → native 不抠 → 点击穿透）').toBe('fixed');
    expect(['0', '0px'], 'inset:0 撑满全屏（命中矩形=全屏）').toContain(hit!.style.inset);
  });

  test('WEL_start_sets_completed：「开始导览」→ set{tourCompleted:true} + 欢迎卡关 + 进导览（drive）', async () => {
    const { bridge, setPatches } = makeBridge(snapshotFixture({ tourCompleted: false }));
    await mount(bridge);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    const startBtn = document.querySelector('.welcome-overlay__start-btn');
    expect(startBtn).not.toBeNull();
    await act(async () => {
      startBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setPatches).toContainEqual({ tourCompleted: true });
    expect(welcome(), '欢迎卡已关').toBeNull();
    // TourOverlayLive 挂载 → fonts fallback 直跑 drive（mock driver）
    await act(async () => {
      await Promise.resolve();
    });
    expect(driverSpies.drive, '进导览').toHaveBeenCalled();
  });

  test('WEL_skip_sets_completed：「跳过」→ set{tourCompleted:true} + 欢迎卡关 + 不进导览', async () => {
    const { bridge, setPatches } = makeBridge(snapshotFixture({ tourCompleted: false }));
    await mount(bridge);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    const skipBtn = document.querySelector('.welcome-overlay__skip-btn');
    await act(async () => {
      skipBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(setPatches).toContainEqual({ tourCompleted: true });
    expect(welcome()).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(driverSpies.drive, '跳过不进导览').not.toHaveBeenCalled();
  });

  test('TOUR_replay_from_settings：重放信箱 → 跳过欢迎卡直接进导览（不重置 tourCompleted）', async () => {
    const { bridge, setPatches } = makeBridge(snapshotFixture({ tourCompleted: true }));
    await mount(bridge);
    await act(async () => {
      requestTourStart();
      await Promise.resolve();
    });
    expect(welcome(), '重放不出欢迎卡').toBeNull();
    expect(driverSpies.drive, '直接进导览').toHaveBeenCalled();
    expect(setPatches, '不写 tourCompleted（legacy 不重置）').toEqual([]);
  });
});
