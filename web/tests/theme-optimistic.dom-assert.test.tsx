// @vitest-environment jsdom
//
// 主题乐观同帧切换（settings-modal.md 外观段 / terminal-theme.md §6，右上角批 B1）：
// ConfigApi.set({theme}) 必须在发桥请求的同一帧就把 <html data-theme> 翻到目标值——对齐
// legacy handleToggleTheme 的瞬时全量语义（App.tsx:81-96：setAttribute 同帧、CSS 变量同帧重算）。
// 修复前 UI chrome 要等 web→config.request→落盘→republishState→ui.state 回推整个往返才重染，
// 与终端 Metal 链（native 内部即时）错拍 → 「终端先变、边框慢半拍」（dogfood 2026-07-13 反馈）。
// 回滚契约：set 响应 snapshot → 以权威 theme 校正；rejected/传输错 → 重拉 get 后回滚 data-theme。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider, useConfigApi, type ConfigApi } from '../src/config/ConfigContext';
import type { BridgeApi } from '../src/bridge/client';
import type { ConfigRequest, ConfigResponse, ConfigSnapshot } from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** 可控 set 响应的假桥：get 即回 snapshot；set 的响应由测试逐次注入（同帧断言靠挂起的 set）。 */
function makeBridge(initial: ConfigSnapshot): {
  bridge: BridgeApi;
  resolveSet: (resp: ConfigResponse) => void;
  rejectSet: () => void;
  getConfig: () => ConfigSnapshot;
  setGetConfig: (c: ConfigSnapshot) => void;
} {
  let pendingSet: { resolve: (r: ConfigResponse) => void; reject: (e: Error) => void } | null = null;
  let getSnapshot = initial;
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
      if (req.kind === 'get') {
        return Promise.resolve({ kind: 'snapshot' as const, config: getSnapshot });
      }
      if (req.kind === 'set') {
        return new Promise<ConfigResponse>((resolve, reject) => {
          pendingSet = { resolve, reject };
        });
      }
      return Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' });
    }),
    sendAppRequest: vi.fn(),
  };
  return {
    bridge,
    resolveSet: (resp) => pendingSet?.resolve(resp),
    rejectSet: () => pendingSet?.reject(new Error('transport')),
    getConfig: () => getSnapshot,
    setGetConfig: (c) => {
      getSnapshot = c;
    },
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let capturedApi: ConfigApi | null = null;

function CaptureApi(): null {
  capturedApi = useConfigApi();
  return null;
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(bridge: BridgeApi): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ConfigProvider, { bridge, children: createElement(CaptureApi) }));
  });
  await flush();
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  capturedApi = null;
});

describe('主题乐观同帧切换（B1）', () => {
  test('TT_theme_optimistic_same_frame：set({theme:light}) 同帧翻 data-theme（桥响应未回也已生效）', async () => {
    const { bridge } = makeBridge(snapshotFixture());
    await mount(bridge);
    expect(capturedApi).not.toBeNull();

    act(() => {
      void capturedApi!.set({ theme: 'light', terminalThemeName: 'light' });
    });
    // set 响应仍挂起 —— data-theme 必须已经是 light（乐观同帧，对齐 legacy 瞬时语义）
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('TT_theme_snapshot_correct：set 响应 snapshot → data-theme 以权威 theme 校正', async () => {
    const { bridge, resolveSet } = makeBridge(snapshotFixture());
    await mount(bridge);

    act(() => {
      void capturedApi!.set({ theme: 'light', terminalThemeName: 'light' });
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    // native 规范化把 theme 定为 dark（模拟 clamp/规范化路径）→ 校正回 dark
    await act(async () => {
      resolveSet({ kind: 'snapshot', config: snapshotFixture({ theme: 'dark' }) });
    });
    await flush();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('TT_theme_rejected_rollback：set rejected → 重拉 get 后 data-theme 回滚权威值', async () => {
    const { bridge, resolveSet } = makeBridge(snapshotFixture({ theme: 'dark' }));
    await mount(bridge);

    act(() => {
      void capturedApi!.set({ theme: 'light', terminalThemeName: 'light' });
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await act(async () => {
      resolveSet({ kind: 'rejected', code: 'E', message: 'nope' });
    });
    await flush();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('TT_theme_transport_rollback：set 传输错 → 重拉 get 后 data-theme 回滚权威值', async () => {
    const { bridge, rejectSet } = makeBridge(snapshotFixture({ theme: 'dark' }));
    await mount(bridge);

    act(() => {
      void capturedApi!.set({ theme: 'light', terminalThemeName: 'light' });
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await act(async () => {
      rejectSet();
    });
    await flush();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('TT_theme_no_touch_without_theme：patch 不含 theme → 不碰 data-theme（非主题设置零波及）', async () => {
    const { bridge } = makeBridge(snapshotFixture());
    await mount(bridge);

    act(() => {
      void capturedApi!.set({ doubleClickToFocus: true });
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
