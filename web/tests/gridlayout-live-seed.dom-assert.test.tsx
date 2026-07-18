// @vitest-environment jsdom
//
// M6 批1 web：gridLayout 持久化回读种子（item 4）。live 模式（ConfigProvider 有桥）下单行网格用
// config.gridLayout.columnRatios 播种列比；无 ConfigProvider（截图/纯展示）→ useConfig()=null → 均分回落
//（golden 逐字节铁律的护栏：种子路径只在 live 生效，截图路径零差异）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider } from '../src/config/ConfigContext';
import { TermGrid } from '../src/grid/TermGrid';
import type { BridgeApi } from '../src/bridge/client';
import type { ConfigRequest, ConfigSnapshot } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function twoTermFixture(): Fixture {
  return {
    id: 'grid-seed',
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
    ],
  } as Fixture;
}

function snapshot(columnRatios: number[]): ConfigSnapshot {
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
    gridLayout: { columnRatios, rowRatios: [1, 1] },
    ftvLeftWidth: 250,
    ftvRightWidth: 280,
    archiveEnabled: true,
    tourCompleted: false,
  };
}

function bridgeWith(snap: ConfigSnapshot): BridgeApi {
  return {
    sendAction: vi.fn(),
    sendTelemetry: vi.fn(),
    sendTermCommand: vi.fn(),
    sendOrchCommand: vi.fn(),
    sendOrchQuery: vi.fn(),
    sendFsRequest: vi.fn(),
    subscribeDataEvent: vi.fn(() => () => {}),
    sendChatRequest: vi.fn(),
    sendConfigRequest: vi.fn((req: ConfigRequest) =>
      req.kind === 'get'
        ? Promise.resolve({ kind: 'snapshot' as const, config: snap })
        : Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' }),
    ),
    sendAppRequest: vi.fn(),
    getAppVersion: () => '0.5.0',
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function gridCols(): string {
  return (container!.querySelector('.terminal-grid') as HTMLElement).style.gridTemplateColumns;
}

beforeEach(() => {
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  const g = globalThis as unknown as { ResizeObserver: unknown; requestAnimationFrame: (cb: FrameRequestCallback) => number; cancelAnimationFrame: (id: number) => void };
  g.ResizeObserver = RO;
  g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id) => clearTimeout(id);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('gridLayout live 种子回读（M6 批1 item 4）', () => {
  test('live（ConfigProvider）：单行列比用 config.gridLayout 播种', async () => {
    await act(async () => {
      root!.render(
        createElement(ConfigProvider, {
          bridge: bridgeWith(snapshot([3, 1])),
          children: createElement(TermGrid, { fx: twoTermFixture() }),
        }),
      );
    });
    await flush();
    expect(gridCols(), 'config 列比 [3,1] → 3fr 1fr').toBe('3fr 1fr');
  });

  test('无 ConfigProvider（截图/纯展示）：均分回落，golden 逐字节不变', async () => {
    await act(async () => {
      root!.render(createElement(TermGrid, { fx: twoTermFixture() }));
    });
    await flush();
    expect(gridCols(), 'useConfig()=null → 1fr 1fr').toBe('1fr 1fr');
  });
});
