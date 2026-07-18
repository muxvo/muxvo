// @vitest-environment jsdom
//
// FILE_L1_13/14 销账（M6 批A 用户裁决 2026-07-06）：空态/无权限文案启用，覆盖 legacy 留白实况。
// spec 锚定 caseOf 模式（照 config-empty-state 先例）：断言 spec 期望 + 真实 live 路径渲染。
// 空态经 useLiveFileTree.selectEmptyState 派生（判空=readDir ok 且全量 0 条），非纯 View 传参 —— 走真桥路径。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fileSpec from '../../specs/legacy/l1/file.spec.json';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { FsRequest, FsResponse } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SpecCase = Record<string, any>;
function caseOf(id: string): SpecCase {
  const c = (fileSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'fp-empty',
    theme: 'dark',
    homePath: '/Users/rl',
    viewMode: 'Tiling',
    focusedId: null,
    selectedId: 't1',
    activeSidebarId: null,
    maxReached: false,
    dragging: null,
    dragOver: null,
    editing: null,
    waitingNotification: null,
    searchBar: null,
    palette: { background: '#1e1e1e', foreground: '#cccccc' },
    terminals: [{ id: 't1', state: 'Running', cwd: '/proj' }],
    filePanel: { terminalId: 't1' },
    ...over,
  } as Fixture;
}

function fsReturning(resp: FsResponse): (r: FsRequest) => Promise<FsResponse> {
  return vi.fn(async (req: FsRequest) => (req.kind === 'readDir' ? resp : { kind: 'rejected', code: 'internal', message: 'x' })) as any;
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

async function mount(fx: Fixture, fs: (r: FsRequest) => Promise<FsResponse>): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(TerminalScreen, { fx, onAction: vi.fn(), onTermCommand: vi.fn(), onFsRequest: fs as any }),
    );
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

function emptyText(): string | null {
  return document.querySelector('.file-panel__empty-text')?.textContent ?? null;
}
function emptyIcon(): string | null {
  return document.querySelector('.file-panel__empty-icon')?.textContent ?? null;
}

test('FILE_L1_13: 空目录缺省态 → 「此目录为空」+ 📁（.file-panel__empty，覆盖 legacy 留白）', async () => {
  const c = caseOf('FILE_L1_13');
  expect(c.state).toBe('emptyDirectory');
  expect(c.expectedUI.message).toBe('此目录为空');
  expect(c.expectedUI.icon).toBe('folder');

  await mount(fixture(), fsReturning({ kind: 'dir', entries: [] }));
  expect(emptyText()).toBe('此目录为空');
  expect(emptyIcon()).toBe('📁');
  // 无文件行
  expect(document.querySelector('.file-item')).toBeNull();
});

test('FILE_L1_14: 无权限读取缺省态 → 「无法读取此目录，请检查权限」+ 🔒（root readDir rejected permissionDenied）', async () => {
  const c = caseOf('FILE_L1_14');
  expect(c.state).toBe('permissionDenied');
  expect(c.expectedUI.message).toBe('无法读取此目录，请检查权限');
  expect(c.expectedUI.icon).toBe('lock');

  await mount(fixture(), fsReturning({ kind: 'rejected', code: 'permissionDenied', message: 'EACCES' }));
  expect(emptyText()).toBe('无法读取此目录，请检查权限');
  expect(emptyIcon()).toBe('🔒');
});

test('隐藏条目被 showHidden=off 滤空 ≠ 空目录文案（负例，不说谎）', async () => {
  // readDir ok 且全量 1 条（.hidden），showHidden=off 过滤后 0 行 → 树区留白，不出「此目录为空」
  await mount(
    fixture({ showHiddenFiles: false }),
    fsReturning({ kind: 'dir', entries: [{ name: '.env', isDirectory: false, size: 3 }] }),
  );
  expect(document.querySelector('.file-panel__empty'), '隐藏滤空不得显示空目录文案').toBeNull();
  expect(document.querySelector('.file-item'), '.env 被 showHidden=off 滤掉，树区留白').toBeNull();
});
