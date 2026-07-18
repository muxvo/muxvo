// @vitest-environment jsdom
//
// 自动更新 web 半接线证据关（specs/behavior/auto-update.md §3-§7 / §12 UPD_* web 行）：
// 真实 ConfigProvider（mock bridge，可注入 data.event 推送）下挂 LiveChrome / SettingsModalLive，
// 断言菜单栏进度环 live 化、设置面板五态状态机（8s 超时/提前判定/下载关弹窗/重开重置）、
// What's New 触发门（2s）与历史折叠。文案一律**字面量逐字断言**（老版基线，禁引产品常量）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider } from '../src/config/ConfigContext';
import { LiveChrome } from '../src/screen/live/LiveChrome';
import { SettingsModalLive } from '../src/screen/modal/SettingsModalLive';
import type { BridgeApi } from '../src/bridge/client';
import type { AppRequest, AppResponse, ConfigRequest, ConfigSnapshot, DataEvent, ReleaseEntry } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

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
    tourCompleted: true,
    ...over,
  };
}

interface BridgeHarness {
  bridge: BridgeApi;
  appReqs: AppRequest[];
  /** 注入 data.event 推送（多订阅者派发，真 client 语义）。 */
  push(event: DataEvent): Promise<void>;
}

function makeBridge(
  snapshot: ConfigSnapshot,
  appResponder?: (req: AppRequest) => AppResponse
): BridgeHarness {
  const appReqs: AppRequest[] = [];
  const handlers = new Set<(event: DataEvent) => void>();
  const bridge: BridgeApi = {
    sendAction: vi.fn(),
    sendTelemetry: vi.fn(),
    sendTermCommand: vi.fn(),
    sendOrchCommand: vi.fn(),
    sendOrchQuery: vi.fn(),
    sendFsRequest: vi.fn(),
    sendChatRequest: vi.fn(),
    sendConfigRequest: vi.fn((req: ConfigRequest) => {
      if (req.kind === 'get') return Promise.resolve({ kind: 'snapshot' as const, config: snapshot });
      if (req.kind === 'set')
        return Promise.resolve({ kind: 'snapshot' as const, config: { ...snapshot, ...req.patch } });
      return Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' });
    }),
    sendAppRequest: vi.fn((req: AppRequest) => {
      appReqs.push(req);
      const fallback: AppResponse =
        req.kind === 'whatsNewStatus'
          ? { kind: 'whatsNewStatus', shouldShow: false, appVersion: '0.5.0' }
          : req.kind === 'releaseNotes'
            ? { kind: 'releaseNotes', entries: [] }
            : { kind: 'updateAck' };
      return Promise.resolve(appResponder ? appResponder(req) : fallback);
    }),
    subscribeDataEvent: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    getAppVersion: () => '0.5.0',
  };
  return {
    bridge,
    appReqs,
    push: (event) =>
      act(async () => {
        handlers.forEach((h) => h(event));
      }),
  };
}

function chromeFixture(): Fixture {
  return {
    id: 'auto-update-live',
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
    terminals: [{ id: 't1', state: 'Running', cwd: '/Users/rl/a' }],
  } as Fixture;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** 假时钟下的冲刷：推进 0ms 即冲 microtask+到期 timer（本关全程 vi.useFakeTimers）。 */
async function flushFake(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountChrome(harness: BridgeHarness): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ConfigProvider, {
        bridge: harness.bridge,
        children: createElement(LiveChrome, {
          fx: chromeFixture(),
          onAction: vi.fn(),
          onTermCommand: vi.fn(),
        }),
      })
    );
  });
  await flushFake();
}

async function mountSettings(
  harness: BridgeHarness
): Promise<{ onClose: ReturnType<typeof vi.fn> }> {
  const onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ConfigProvider, {
        bridge: harness.bridge,
        children: createElement(SettingsModalLive, { onClose }),
      })
    );
  });
  await flushFake();
  return { onClose };
}

async function unmount(): Promise<void> {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

function click(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 设置面板「检查更新」行右侧控件（帮助区第 2 行；settings-modal.md §3-5 行结构冻结）。 */
function updateRow(): HTMLElement {
  const sections = container!.querySelectorAll('.settings-modal__section');
  const help = sections[sections.length - 1];
  const rows = help.querySelectorAll('.settings-modal__row');
  return rows[1] as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
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
  g.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0) as unknown as number;
  g.cancelAnimationFrame = (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
});

afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('菜单栏更新指示器 live 化（auto-update.md §3/§5；menu-bar.md §4）', () => {
  test('UPD_menubar_ring_live：updateDownloading 推送 → 26×26 环出现且 percent 驱动 strokeDashoffset；idle 无环', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountChrome(harness);
    expect(container!.querySelector('.update-progress')).toBeNull(); // idle 不可见（legacy :57）

    await harness.push({ kind: 'updateDownloading', percent: 63, transferred: 0, total: 0, bytesPerSecond: 0 });
    const ring = container!.querySelector('.update-progress');
    expect(ring).not.toBeNull();
    expect(ring!.className).not.toContain('update-progress--error');
    expect(ring!.className).not.toContain('update-progress--done');
    const fill = ring!.querySelector('.update-progress__ring-fill') as HTMLElement;
    // offset = 56.55 × (1 − 63/100)（legacy UpdateProgress.tsx:60-62）
    expect(Number.parseFloat(fill.style.strokeDashoffset)).toBeCloseTo(56.55 * 0.37, 3);
  });

  test('UPD_hover_bubble_copy：气泡「{已下载} / {总量}」与「{速度}/s」按 KB/MB 规则（<1MB 取整 KB 否则 1 位小数 MB）逐字', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountChrome(harness);
    await harness.push({
      kind: 'updateDownloading',
      percent: 27,
      transferred: 12897485, // 12.3 MB
      total: 47815066, // 45.6 MB
      bytesPerSecond: 1258291, // 1.2 MB/s
    });
    const tooltip = container!.querySelector('.update-progress__tooltip')!;
    expect(tooltip.querySelector('.update-progress__tooltip-title')!.textContent).toBe('正在下载更新...');
    expect(tooltip.querySelector('.update-progress__tooltip-info')!.textContent).toBe('12.3 MB / 45.6 MB1.2 MB/s');
    expect(tooltip.querySelector('.update-progress__tooltip-speed')!.textContent).toBe('1.2 MB/s');

    // <1MB → KB 取整（legacy formatBytes :19-22）。
    await harness.push({
      kind: 'updateDownloading',
      percent: 1,
      transferred: 512000, // 500 KB
      total: 47815066,
      bytesPerSecond: 204800, // 200 KB/s
    });
    expect(container!.querySelector('.update-progress__tooltip-info')!.textContent).toBe('500 KB / 45.6 MB200 KB/s');
  });

  test('UPD_menubar_done_badge：updateDownloaded → 绿对勾（--done+满环）+ 气泡「v{x} 下载完成」「下次启动时自动更新」+ 3s 隐藏', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountChrome(harness);
    await harness.push({ kind: 'updateDownloaded', version: '0.6.0' });
    const ring = container!.querySelector('.update-progress')!;
    expect(ring.className).toContain('update-progress--done');
    expect(ring.className).toContain('update-progress--fade-out');
    const fill = ring.querySelector('.update-progress__ring-fill') as HTMLElement;
    expect(Number.parseFloat(fill.style.strokeDashoffset)).toBe(0); // done 满环（legacy :63）
    expect(ring.querySelector('.update-progress__tooltip-title')!.textContent).toBe('v0.6.0 下载完成');
    expect(ring.querySelector('.update-progress__tooltip-info')!.textContent).toBe('下次启动时自动更新');

    await flushFake(2999);
    expect(container!.querySelector('.update-progress')).not.toBeNull();
    await flushFake(1); // 3s 隐藏（legacy :41）
    expect(container!.querySelector('.update-progress')).toBeNull();
  });

  test('UPD_error_badge_copy：updateError → 红 X（--error）+ 气泡「下载失败」+ 3s 隐藏（web 半；native 半在 MuxvoUpdaterTests）', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountChrome(harness);
    await harness.push({ kind: 'updateError' });
    const ring = container!.querySelector('.update-progress')!;
    expect(ring.className).toContain('update-progress--error');
    expect(ring.querySelector('.update-progress__tooltip-title')!.textContent).toBe('下载失败');
    await flushFake(3000);
    expect(container!.querySelector('.update-progress')).toBeNull();
  });
});

describe('设置面板检查更新五态（auto-update.md §6/§10；settings-modal.md §5 挂账兑现）', () => {
  test('UPD_settings_check_button_states：zh 五态文案逐字（idle/checking/available/up-to-date/error）+ 当前版本行', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountSettings(harness);
    const row = updateRow();
    expect(row.textContent).toContain('当前版本 v0.5.0');
    expect(row.querySelector('.settings-modal__whats-new-link')!.textContent).toBe('查看更新内容');

    // idle
    const idleBtn = row.querySelector('.settings-modal__tour-btn')!;
    expect(idleBtn.textContent).toBe('检查更新');
    // checking
    await click(idleBtn);
    expect(updateRow().textContent).toContain('检查中...');
    // available（推送随时生效，legacy :130-138）
    await harness.push({ kind: 'updateAvailable', version: '0.6.0' });
    expect(updateRow().querySelector('.settings-modal__tour-btn')!.textContent).toBe('下载 v0.6.0');
    await unmount();

    // error（checking 中收 updateError → 红字「检查失败」）
    const harness2 = makeBridge(snapshotFixture());
    await mountSettings(harness2);
    await click(updateRow().querySelector('.settings-modal__tour-btn')!);
    await harness2.push({ kind: 'updateError' });
    const errorSpan = [...updateRow().querySelectorAll('.settings-modal__desc')].at(-1) as HTMLElement;
    expect(errorSpan.textContent).toBe('检查失败');
    expect(errorSpan.style.color).toBe('rgb(255, 95, 87)'); // #ff5f57（legacy :393）
  });

  test('UPD_settings_check_button_states：en 五态文案逐字（Check/Checking.../Download/Up to date/Check failed）', async () => {
    const harness = makeBridge(snapshotFixture({ language: 'en' }));
    await mountSettings(harness);
    const row = updateRow();
    expect(row.textContent).toContain('Current version v0.5.0');
    expect(row.querySelector('.settings-modal__whats-new-link')!.textContent).toBe("What's New");
    const idleBtn = row.querySelector('.settings-modal__tour-btn')!;
    expect(idleBtn.textContent).toBe('Check');
    await click(idleBtn);
    expect(updateRow().textContent).toContain('Checking...');
    await harness.push({ kind: 'updateNotAvailable' });
    expect(updateRow().textContent).toContain('Up to date');
    await unmount();

    const harness2 = makeBridge(snapshotFixture({ language: 'en' }));
    await mountSettings(harness2);
    await click(updateRow().querySelector('.settings-modal__tour-btn')!);
    await harness2.push({ kind: 'updateAvailable', version: '0.6.0' });
    expect(updateRow().querySelector('.settings-modal__tour-btn')!.textContent).toBe('Download v0.6.0');
    await unmount();

    const harness3 = makeBridge(snapshotFixture({ language: 'en' }));
    await mountSettings(harness3);
    await click(updateRow().querySelector('.settings-modal__tour-btn')!);
    await harness3.push({ kind: 'updateError' });
    expect(updateRow().textContent).toContain('Check failed');
  });

  test('UPD_settings_8s_timeout：checking 8s 无任何推送 → 「已是最新版本」（legacy :123-125 兜底）', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountSettings(harness);
    await click(updateRow().querySelector('.settings-modal__tour-btn')!);
    expect(harness.appReqs).toContainEqual({ kind: 'updateCheck' });
    await flushFake(7999);
    expect(updateRow().textContent).toContain('检查中...');
    await flushFake(1);
    expect(updateRow().textContent).toContain('已是最新版本');
  });

  test('UPD_settings_early_uptodate：checking 中收 updateNotAvailable → 立即「已是最新版本」不等 8s（偏差④）', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountSettings(harness);
    await click(updateRow().querySelector('.settings-modal__tour-btn')!);
    await flushFake(500);
    await harness.push({ kind: 'updateNotAvailable' });
    expect(updateRow().textContent).toContain('已是最新版本');
    // idle 下（非 checking）后台轮询的 notAvailable 不动面板：重开后推送无效果。
    await unmount();
    const harness2 = makeBridge(snapshotFixture());
    await mountSettings(harness2);
    await harness2.push({ kind: 'updateNotAvailable' });
    expect(updateRow().querySelector('.settings-modal__tour-btn')!.textContent).toBe('检查更新');
  });

  test('UPD_settings_download_closes：available 点「下载 v{x}」→ 发 updateDownload 且设置弹窗关闭（legacy :140-143）', async () => {
    const harness = makeBridge(snapshotFixture());
    const { onClose } = await mountSettings(harness);
    await harness.push({ kind: 'updateAvailable', version: '0.6.0' });
    await click(updateRow().querySelector('.settings-modal__tour-btn')!);
    expect(harness.appReqs).toContainEqual({ kind: 'updateDownload' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('UPD_settings_reopen_resets：available 后关闭重开设置面板 → updateStatus 重置 idle（legacy :130-132）', async () => {
    const harness = makeBridge(snapshotFixture());
    await mountSettings(harness);
    await harness.push({ kind: 'updateAvailable', version: '0.6.0' });
    expect(updateRow().querySelector('.settings-modal__tour-btn')!.textContent).toBe('下载 v0.6.0');
    await unmount(); // 关闭面板 = 卸载
    await mountSettings(harness); // 重开 = 重挂载
    expect(updateRow().querySelector('.settings-modal__tour-btn')!.textContent).toBe('检查更新');
  });
});

describe("What's New live（auto-update.md §7；whats-new-modal.md）", () => {
  const notes: ReleaseEntry[] = [
    {
      version: '0.6.0',
      date: '2026-07-13',
      sections: [{ key: 'Added', items: ['新功能甲'] }, { key: 'Fixed', items: ['修复乙'] }],
    },
    { version: '0.5.0', date: '2026-03-11', sections: [{ key: 'Changed', items: ['变更丙'] }] },
    { version: '0.4.0', date: '2026-02-01', sections: [{ key: 'Removed', items: ['移除丁'] }] },
  ];

  function responder(shouldShow: boolean, entries: ReleaseEntry[] = notes) {
    return (req: AppRequest): AppResponse => {
      if (req.kind === 'whatsNewStatus') return { kind: 'whatsNewStatus', shouldShow, appVersion: '0.6.0' };
      if (req.kind === 'releaseNotes') return { kind: 'releaseNotes', entries };
      return { kind: 'updateAck' };
    };
  }

  test('UPD_whatsnew_2s_after_upgrade：shouldShow=true → 主界面加载 2s 后弹（1999ms 不弹）；shouldShow=false 恒不弹', async () => {
    const harness = makeBridge(snapshotFixture(), responder(true));
    await mountChrome(harness);
    expect(harness.appReqs).toContainEqual({ kind: 'whatsNewStatus' });
    await flushFake(1999);
    expect(container!.querySelector('.whats-new__modal')).toBeNull();
    await flushFake(1);
    expect(container!.querySelector('.whats-new__modal')).not.toBeNull();
    expect(container!.querySelector('.whats-new__title')!.textContent).toContain('更新内容');
    // current 徽标 = v0.6.0（appVersion 划分 current/older）。
    expect(container!.querySelector('.whats-new__version-badge')!.textContent).toContain('v0.6.0');
    await unmount();

    const negative = makeBridge(snapshotFixture(), responder(false));
    await mountChrome(negative);
    await flushFake(5000);
    expect(container!.querySelector('.whats-new__modal')).toBeNull();
  });

  test('UPD_whatsnew_history：历史版本默认全折叠、点 toggle 展开；「知道了」关闭；空 entries → 空态文案', async () => {
    const harness = makeBridge(snapshotFixture(), responder(true));
    await mountChrome(harness);
    await flushFake(2000);
    // 历史区：0.5.0/0.4.0 两条、默认全折叠（无 __older-content，legacy :27 初始空 Set）。
    const toggles = container!.querySelectorAll('.whats-new__older-toggle');
    expect(toggles.length).toBe(2);
    expect(container!.querySelector('.whats-new__older-title')!.textContent).toBe('历史版本');
    expect(container!.querySelectorAll('.whats-new__older-content').length).toBe(0);
    await click(toggles[0]);
    expect(container!.querySelectorAll('.whats-new__older-content').length).toBe(1);
    expect(container!.querySelector('.whats-new__older-content')!.textContent).toContain('变更丙');
    await click(container!.querySelectorAll('.whats-new__older-toggle')[0]);
    expect(container!.querySelectorAll('.whats-new__older-content').length).toBe(0);
    // 「知道了」关闭。
    await click(container!.querySelector('.whats-new__dismiss')!);
    expect(container!.querySelector('.whats-new__modal')).toBeNull();
    await unmount();

    // 空态（releaseNotes 读失败 → []，legacy :40-42 + 空态文案 :93-96）。
    const empty = makeBridge(snapshotFixture(), responder(true, []));
    await mountChrome(empty);
    await flushFake(2000);
    expect(container!.querySelector('.whats-new__empty')!.textContent).toBe('v0.6.0 暂无更新说明');
  });

  test('设置面板「查看更新内容」链接 → 打开同一 What\'s New 弹窗（不再次查询 whatsNewStatus）', async () => {
    const harness = makeBridge(snapshotFixture(), responder(false));
    await mountChrome(harness);
    await flushFake(2000);
    expect(container!.querySelector('.whats-new__modal')).toBeNull();
    // 打开设置面板（齿轮 = title「设置」icon-btn）→ 点链接。
    const gear = [...container!.querySelectorAll('.menu-bar__icon-btn')].find(
      (b) => b.getAttribute('title') === '设置'
    )!;
    await click(gear);
    await flushFake();
    const link = container!.querySelector('.settings-modal__whats-new-link');
    expect(link).not.toBeNull();
    const statusQueriesBefore = harness.appReqs.filter((r) => r.kind === 'whatsNewStatus').length;
    await click(link!);
    await flushFake();
    expect(container!.querySelector('.whats-new__modal')).not.toBeNull();
    expect(harness.appReqs.filter((r) => r.kind === 'whatsNewStatus').length).toBe(statusQueriesBefore);
  });
});
