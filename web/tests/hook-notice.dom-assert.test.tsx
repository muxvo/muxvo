// @vitest-environment jsdom
//
// hook 首启自动启用一次性轻提示（wait-detector.md §7 首启自动启用条款）：HookEnabledNoticeLive
// mount 拉一次 hookAutoEnableNotice（一次性由 native 查询即消费保证，web 半只管展示时序），
// show=true → 底部 toast 显形 4s 自动消隐卸载；show=false / 无桥 → 零 DOM。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider } from '../src/config/ConfigContext';
import { HookEnabledNoticeLive } from '../src/screen/live/HookEnabledNoticeLive';
import type { BridgeApi } from '../src/bridge/client';
import type { ConfigSnapshot } from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SNAPSHOT = {
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
  tourCompleted: true,
} as ConfigSnapshot;

function makeBridge(show: boolean): { bridge: BridgeApi; appReqs: unknown[] } {
  const appReqs: unknown[] = [];
  const bridge = {
    sendAction: vi.fn(),
    sendTelemetry: vi.fn(),
    sendTermCommand: vi.fn(),
    sendOrchCommand: vi.fn(),
    sendOrchQuery: vi.fn(),
    sendFsRequest: vi.fn(),
    subscribeDataEvent: vi.fn(() => () => {}),
    sendChatRequest: vi.fn(),
    sendConfigRequest: vi.fn(() =>
      Promise.resolve({ kind: 'snapshot' as const, config: SNAPSHOT })),
    sendAppRequest: vi.fn((req: { kind: string }) => {
      appReqs.push(req);
      if (req.kind === 'hookAutoEnableNotice') {
        return Promise.resolve({ kind: 'hookNotice' as const, show });
      }
      return Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' });
    }),
    getAppVersion: () => '0.5.0',
  } as unknown as BridgeApi;
  return { bridge, appReqs };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(show: boolean): Promise<{ appReqs: unknown[] }> {
  const { bridge, appReqs } = makeBridge(show);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ConfigProvider, { bridge, children: createElement(HookEnabledNoticeLive) }),
    );
  });
  await flush();
  return { appReqs };
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe('hook 首启自动启用轻提示（wait-detector.md §7）', () => {
  test('WD_auto_enable_toast：show=true → toast 出现（文案+仅查询一次）；4s 后自动消隐卸载', async () => {
    vi.useFakeTimers();
    const { appReqs } = await mount(true);
    // 入场 50ms 拍后显形
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    const toast = container!.querySelector('.hook-enabled-toast');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain('已启用终端等待检测，可在设置中管理');
    expect(toast!.classList.contains('hook-enabled-toast--visible')).toBe(true);
    // 一次性：查询恰好一次（native 半查询即消费；web 半不重查）
    expect(appReqs.filter((r) => (r as { kind: string }).kind === 'hookAutoEnableNotice')).toHaveLength(1);
    // 4s 显形 + 0.4s 消隐过渡 → 卸载零 DOM
    await act(async () => {
      vi.advanceTimersByTime(4000 + 400 + 50);
    });
    expect(container!.querySelector('.hook-enabled-toast')).toBeNull();
  });

  test('WD_auto_enable_toast_hidden：show=false → 零 DOM（查询仍发一次）', async () => {
    const { appReqs } = await mount(false);
    expect(container!.querySelector('.hook-enabled-toast')).toBeNull();
    expect(appReqs.filter((r) => (r as { kind: string }).kind === 'hookAutoEnableNotice')).toHaveLength(1);
  });
});
