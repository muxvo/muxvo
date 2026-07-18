// @vitest-environment jsdom
//
// M6 批1 web：SettingsModalLive 结构化事件委托接线证据关。真实 ConfigProvider（mock bridge）下
// 挂 SettingsModalLive，点冻结 golden 组件（SettingsModalScreen）的真实控件，断言经委托映射出正确
// config.request{set} patch / app.request。委托靠「section 序 + 组内 button 序」定位——本关正是其护栏。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider } from '../src/config/ConfigContext';
import { SettingsModalLive } from '../src/screen/modal/SettingsModalLive';
import { subscribeTourStart } from '../src/screen/live/tourIntent';
import type { BridgeApi } from '../src/bridge/client';

// track() 经动态 import client 单例取桥（analytics.md §4）：mock currentBridge 供 telemetry 组件级断言，
// 默认 null（= 其余用例 track no-op，不受影响）。
const { telemetryBridgeMock } = vi.hoisted(() => ({
  telemetryBridgeMock: vi.fn((): unknown => null),
}));
vi.mock('../src/bridge/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/bridge/client')>();
  return { ...orig, currentBridge: () => telemetryBridgeMock() };
});
import type { ConfigRequest, ConfigSnapshot, PrefsPatch } from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function snapshotFixture(over: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    startupTerminalCount: 2,
    doubleClickToFocus: true,
    dockBadgeMode: 'realtime',
    dockBadgeIntervalMin: 1,
    defaultTerminalCwd: '',
    showHiddenFiles: false,
    language: 'zh',
    theme: 'dark',
    terminalThemeName: 'dark',
    fontSize: 14,
    gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
    ftvLeftWidth: 250,
    ftvRightWidth: 280,
    archiveEnabled: true,
    tourCompleted: false,
    ...over,
  };
}

function makeBridge(
  snapshot: ConfigSnapshot,
  appResponder?: (req: { kind: string }) => unknown,
): { bridge: BridgeApi; setPatches: PrefsPatch[]; appReqs: unknown[] } {
  const setPatches: PrefsPatch[] = [];
  const appReqs: unknown[] = [];
  const bridge: BridgeApi = {
    sendAction: vi.fn(),
    sendTelemetry: vi.fn(),
    sendTermCommand: vi.fn(),
    sendOrchCommand: vi.fn(),
    sendOrchQuery: vi.fn(),
    sendFsRequest: vi.fn(),
    subscribeDataEvent: vi.fn(() => () => {}),
    sendChatRequest: vi.fn(),
    sendConfigRequest: vi.fn((req: ConfigRequest) => {
      if (req.kind === 'get') return Promise.resolve({ kind: 'snapshot' as const, config: snapshot });
      if (req.kind === 'set') {
        setPatches.push(req.patch);
        return Promise.resolve({ kind: 'snapshot' as const, config: { ...snapshot, ...req.patch } });
      }
      return Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' });
    }),
    sendAppRequest: vi.fn((req) => {
      appReqs.push(req);
      // 默认回 directorySelected（既有 cwd 浏览用例）；hooks 行用例经 appResponder 注入按 kind 分流。
      return Promise.resolve(
        (appResponder?.(req as { kind: string }) ?? { kind: 'directorySelected' as const, path: '/picked/dir' }) as never,
      );
    }),
    getAppVersion: () => '0.5.0',
  };
  return { bridge, setPatches, appReqs };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** 冲刷 microtask 数轮，让 ConfigProvider 的 get / set 响应落地并重渲。 */
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(
  snapshot: ConfigSnapshot,
  appResponder?: (req: { kind: string }) => unknown,
): Promise<{ setPatches: PrefsPatch[]; appReqs: unknown[]; onClose: ReturnType<typeof vi.fn> }> {
  const { bridge, setPatches, appReqs } = makeBridge(snapshot, appResponder);
  const onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ConfigProvider, { bridge, children: createElement(SettingsModalLive, { onClose }) }),
    );
  });
  await flush(); // 等 get 快照到位、SettingsModalScreen 就位
  return { setPatches, appReqs, onClose };
}

function toggleGroups(): NodeListOf<Element> {
  return container!.querySelectorAll('.settings-modal__toggle-group');
}
function groupButtons(group: Element): HTMLButtonElement[] {
  return [...group.querySelectorAll(':scope > button')] as HTMLButtonElement[];
}
function click(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  // dock 角标 section 仅 macOS 渲染 → 稳定为 Mac，令 badge 控件在 jsdom 就位
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
});

afterEach(async () => {
  // track() 是 fire-and-forget 动态 import（track.ts）：本测试内触发的 telemetry 若不在此排干，
  // 会泄漏到下一个测试（spy 已装上）多计一发——「主题切换 telemetry 断言 2 次」预存红根因
  //（settings-dogfood 批回修：埋点批 L4 track 接线 × 主题批 selectChange 测试的跨测试异步泄漏）。
  await vi.dynamicImportSettled();
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('SettingsModalLive 控件 → 桥写入委托（M6 批1）', () => {
  test('启动终端数 + → set{startupTerminalCount: cur+1}', async () => {
    const { setPatches } = await mount(snapshotFixture({ startupTerminalCount: 2 }));
    // realtime 模式无 timed 子行 → 唯一 stepper = 启动数；[0]=− [1]=+
    const stepperBtns = [...container!.querySelectorAll('.settings-modal__stepper-btn')] as HTMLButtonElement[];
    await click(stepperBtns[1]);
    await flush();
    expect(setPatches).toContainEqual({ startupTerminalCount: 3 });
  });

  test('双击聚焦「关闭」→ set{doubleClickToFocus:false}', async () => {
    const { setPatches } = await mount(snapshotFixture({ doubleClickToFocus: true }));
    const general = groupButtons(toggleGroups()[0]); // 通用 section 首个 toggle-group
    await click(general[1]); // [0]=启用 [1]=关闭
    await flush();
    expect(setPatches).toContainEqual({ doubleClickToFocus: false });
  });

  test('语言「English」→ set{language:en}', async () => {
    const { setPatches } = await mount(snapshotFixture({ language: 'zh' }));
    // R1 合并后外观区无 toggle-group → 语言是第二个（[0]=通用双击聚焦、[1]=语言）
    const lang = groupButtons(toggleGroups()[1]);
    await click(lang[1]); // [0]=中文 [1]=English
    await flush();
    expect(setPatches).toContainEqual({ language: 'en' });
  });

  test('Dock 角标「定时」→ set{dockBadgeMode:timed}', async () => {
    const { setPatches } = await mount(snapshotFixture({ dockBadgeMode: 'realtime' }));
    const badgeBtns = [...container!.querySelectorAll('.settings-modal__badge-toggle-btn')] as HTMLButtonElement[];
    await click(badgeBtns[2]); // [0]=off [1]=realtime [2]=timed
    await flush();
    expect(setPatches).toContainEqual({ dockBadgeMode: 'timed' });
  });

  test('终端默认路径「浏览」→ app.request selectDirectory → set{defaultTerminalCwd}', async () => {
    const { setPatches, appReqs } = await mount(snapshotFixture({ defaultTerminalCwd: '' }));
    // cwd-controls 首个 tour-btn = 浏览
    const cwd = container!.querySelector('.settings-modal__cwd-controls')!;
    const browse = cwd.querySelector('button')!;
    await click(browse);
    await flush();
    expect(appReqs).toContainEqual({ kind: 'selectDirectory', defaultPath: undefined });
    expect(setPatches).toContainEqual({ defaultTerminalCwd: '/picked/dir' });
  });

  test('✕ 关闭 → onClose', async () => {
    const { onClose } = await mount(snapshotFixture());
    await click(container!.querySelector('.settings-modal__close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Dock 角标定时间隔手输：剥非数字 + blur 提交 + Enter 提交 + 非法回退 1（MAJOR-2 回修）', async () => {
    const { setPatches } = await mount(snapshotFixture({ dockBadgeMode: 'timed', dockBadgeIntervalMin: 5 }));
    const input = container!.querySelector('.settings-modal__stepper-input') as HTMLInputElement;
    expect(input, 'timed 模式下手输框在').toBeTruthy();
    expect(input.readOnly, '不再是 readOnly 死件').toBe(false);
    // 输入剥非数字
    await act(async () => {
      input.value = '1a2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('12');
    // blur 提交
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();
    expect(setPatches).toContainEqual({ dockBadgeIntervalMin: 12 });
    // Enter 提交（改值后）
    const input2 = container!.querySelector('.settings-modal__stepper-input') as HTMLInputElement;
    await act(async () => {
      input2.value = '30';
      input2.dispatchEvent(new Event('input', { bubbles: true }));
      input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();
    expect(setPatches).toContainEqual({ dockBadgeIntervalMin: 30 });
    // 非法（清空）→ 回退 1
    const input3 = container!.querySelector('.settings-modal__stepper-input') as HTMLInputElement;
    await act(async () => {
      input3.value = '';
      input3.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();
    expect(setPatches).toContainEqual({ dockBadgeIntervalMin: 1 });
  });

  test('TOUR_replay_delegate：帮助区行0「新手引导」→ 关面板 + 100ms 后投导览信箱；行1 检查更新仍 inert', async () => {
    // 先真时钟挂载（mount 的 flush 依赖真 setTimeout），点击前才切 fake timers 控 100ms 窗。
    const { onClose } = await mount(snapshotFixture());
    const tourStarted = vi.fn();
    const unsubscribe = subscribeTourStart(tourStarted);
    vi.useFakeTimers();
    try {
      const sections = container!.querySelectorAll('.settings-modal__section');
      const helpRows = sections[4].querySelectorAll('.settings-modal__row');
      // 行 0 = 新手引导（legacy handleRestartTour：关面板 100ms 后 START_TOUR）
      await click(helpRows[0].querySelector('button')!);
      expect(onClose, '先关面板').toHaveBeenCalledTimes(1);
      expect(tourStarted, '100ms 前不触发').not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(tourStarted, '100ms 后进导览').toHaveBeenCalledTimes(1);
      // 行 1 = 检查更新（归 feat/auto-update，本批 inert）：点击零副作用
      await click(helpRows[1].querySelector('button')!);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  // R1 合并：外观区「主题」单下拉（select，非 button）→ change 委托双字段 set{theme 派生 + terminalThemeName}
  function selectChange(el: HTMLSelectElement, value: string): Promise<void> {
    return act(async () => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  test('主题下拉选 Monokai → set{theme:dark, terminalThemeName:monokai}（花样配暗界面）', async () => {
    const { setPatches } = await mount(snapshotFixture({ theme: 'light', terminalThemeName: 'light' }));
    const select = container!.querySelector('.settings-modal__select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    await selectChange(select, 'monokai');
    await flush();
    expect(setPatches).toContainEqual({ theme: 'dark', terminalThemeName: 'monokai' });
  });

  test('主题切换发 settings.theme_changed telemetry（analytics.md L4；AN_bridge_telemetry_decode web 半）', async () => {
    const sendTelemetry = vi.fn();
    telemetryBridgeMock.mockReturnValue({ sendTelemetry });
    await mount(snapshotFixture({ theme: 'light', terminalThemeName: 'light' }));
    const select = container!.querySelector('.settings-modal__select') as HTMLSelectElement;
    await selectChange(select, 'monokai');
    await flush();
    await vi.dynamicImportSettled();
    telemetryBridgeMock.mockReturnValue(null);
    expect(sendTelemetry).toHaveBeenCalledTimes(1);
    expect(sendTelemetry).toHaveBeenCalledWith({
      metric: 'settings.theme_changed',
      params: [{ key: 'theme', value: 'monokai' }],
    });
  });

  test('主题下拉选亮色 → set{theme:light, terminalThemeName:light}', async () => {
    const { setPatches } = await mount(snapshotFixture({ theme: 'dark', terminalThemeName: 'dark' }));
    const select = container!.querySelector('.settings-modal__select') as HTMLSelectElement;
    await selectChange(select, 'light');
    await flush();
    expect(setPatches).toContainEqual({ theme: 'light', terminalThemeName: 'light' });
  });

  test('下拉当前值随 snapshot.terminalThemeName 显示（solarized-dark）', async () => {
    await mount(snapshotFixture({ terminalThemeName: 'solarized-dark' }));
    const select = container!.querySelector('.settings-modal__select') as HTMLSelectElement;
    expect(select.value).toBe('solarized-dark');
  });

  test('set 响应回填快照 → 下拉显示值校正（dark→dracula）', async () => {
    await mount(snapshotFixture({ terminalThemeName: 'dark' }));
    const select = container!.querySelector('.settings-modal__select') as HTMLSelectElement;
    expect(select.value).toBe('dark');
    await selectChange(select, 'dracula');
    await flush();
    const after = container!.querySelector('.settings-modal__select') as HTMLSelectElement;
    expect(after.value).toBe('dracula'); // ConfigContext 用 set 响应快照校正 controlled value
  });
});

describe('终端等待检测行（wait-detector.md §7 单绑定入口 + §7 用户面归一）', () => {
  /** hooks 行用例的 appResponder：hookStatus 回注入态，其余 kind 走默认 directorySelected。 */
  const hookResponder =
    (status: unknown, enable?: unknown, disable?: unknown) =>
    (req: { kind: string }): unknown => {
      if (req.kind === 'hookStatus') return status;
      if (req.kind === 'hookEnable') return enable ?? status;
      if (req.kind === 'hookDisable') return disable ?? status;
      return undefined; // 回落默认 directorySelected
    };

  test('WD_panel_row_states：notInstalled=启用 / foreignBound≡notInstalled（无实例字眼） / drift=重新启用+reason / installed=已启用+停用钮', async () => {
    // notInstalled → 「启用」按钮 + 平实描述
    await mount(snapshotFixture(), hookResponder({ kind: 'hookStatus', state: 'notInstalled' }));
    let btn = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(btn?.textContent).toBe('启用');
    expect(container!.textContent).toContain('检测终端何时在等你回复，并及时提醒你');
    await act(async () => root!.unmount());
    container!.remove();

    // foreignBound → 与 notInstalled 完全同构（§7 用户面归一，2026-07-17 用户裁决）：
    // 同「启用」按钮 + 同描述，多实例/绑定字眼一律不出现（接管语境只活在 native sheet）。
    await mount(snapshotFixture(), hookResponder({ kind: 'hookStatus', state: 'foreignBound' }));
    btn = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(btn?.textContent).toBe('启用');
    expect(container!.textContent).toContain('检测终端何时在等你回复，并及时提醒你');
    expect(container!.textContent).not.toContain('实例');
    expect(container!.textContent).not.toContain('绑定');
    await act(async () => root!.unmount());
    container!.remove();

    // drift → 「重新启用」+ reason 透出
    await mount(
      snapshotFixture(),
      hookResponder({ kind: 'hookStatus', state: 'drift', reason: '缺 hook：SessionStart' }),
    );
    btn = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(btn?.textContent).toBe('重新启用');
    expect(container!.textContent).toContain('缺 hook：SessionStart');
    await act(async () => root!.unmount());
    container!.remove();

    // installed → 「已启用」+ 「停用」按钮（opt-out 入口，2026-07-17 用户裁决）
    await mount(snapshotFixture(), hookResponder({ kind: 'hookStatus', state: 'installed' }));
    btn = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(btn?.textContent).toBe('停用');
    expect(container!.textContent).toContain('已启用');
  });

  test('WD_panel_enable_delegate：点「启用」→ 委托 {kind:hookEnable}；响应 installed → 行转已启用+停用钮', async () => {
    const { appReqs } = await mount(
      snapshotFixture(),
      hookResponder(
        { kind: 'hookStatus', state: 'notInstalled' },
        { kind: 'hookStatus', state: 'installed' },
      ),
    );
    const btn = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(btn?.textContent).toBe('启用');
    await click(btn);
    await flush();
    expect(appReqs).toContainEqual({ kind: 'hookEnable' });
    const after = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(after?.textContent).toBe('停用');
    expect(container!.textContent).toContain('已启用');
  });

  test('WD_panel_foreign_enable_delegate：foreignBound 点「启用」→ 仍委托 {kind:hookEnable}（接管走 enable 语义，绝不 disable）', async () => {
    const { appReqs } = await mount(
      snapshotFixture(),
      hookResponder(
        { kind: 'hookStatus', state: 'foreignBound' },
        { kind: 'hookStatus', state: 'installed' },
      ),
    );
    const btn = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(btn?.textContent).toBe('启用');
    await click(btn);
    await flush();
    expect(appReqs).toContainEqual({ kind: 'hookEnable' });
    expect(appReqs).not.toContainEqual({ kind: 'hookDisable' });
    expect(container!.textContent).toContain('已启用');
  });

  test('WD_panel_disable_delegate：installed 点「停用」→ 委托 {kind:hookDisable}；响应 notInstalled → 行回「启用」', async () => {
    const { appReqs } = await mount(
      snapshotFixture(),
      hookResponder(
        { kind: 'hookStatus', state: 'installed' },
        undefined,
        { kind: 'hookStatus', state: 'notInstalled' },
      ),
    );
    const btn = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(btn?.textContent).toBe('停用');
    await click(btn);
    await flush();
    expect(appReqs).toContainEqual({ kind: 'hookDisable' });
    expect(appReqs).not.toContainEqual({ kind: 'hookEnable' });
    const after = container!.querySelector('.settings-modal__hook-btn') as HTMLButtonElement;
    expect(after?.textContent).toBe('启用');
  });

  test('WD_panel_disabled_hidden：hookStatus=disabled（禁装门分身）→ 行整体不渲染', async () => {
    await mount(snapshotFixture(), hookResponder({ kind: 'hookStatus', state: 'disabled' }));
    expect(container!.querySelector('.settings-modal__hook-btn')).toBeNull();
    expect(container!.textContent).not.toContain('终端等待检测');
  });

  test('WD_panel_golden_parity：hooks 未拉到（默认桥回 directorySelected）→ 无 hook 行 DOM（golden 安全护栏）', async () => {
    await mount(snapshotFixture());
    expect(container!.querySelector('.settings-modal__hook-btn')).toBeNull();
    expect(container!.textContent).not.toContain('终端等待检测');
  });
});
