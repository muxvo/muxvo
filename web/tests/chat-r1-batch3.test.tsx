// @vitest-environment jsdom
//
// M5-R1 批3 web 大件（Agent A）：W1 顶部 tab 集成（ChatHistoryChrome + LiveChrome 面板意图信箱）、
// W5 归档进度 banner 三段、W12 canResume 放开 archiveOnly + 三级 cwd。断言面 = 真实工件（真 ChatHistoryChrome
// / ChatHistoryLive / LiveChrome / useChatData / panelIntent 单例），createRoot + act 真挂载。
// 加性纪律：live 交互走 fx.live，静态/golden 路径 fx.live 缺席 → 6 张 chat golden 零感知。
import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatHistoryChrome } from '../src/screen/chat/live/ChatHistoryChrome';
import { ChatHistoryLive } from '../src/screen/chat/live/ChatHistoryLive';
import { LiveChrome } from '../src/screen/live/LiveChrome';
import { ConfigProvider } from '../src/config/ConfigContext';
import { consumePendingPanel, setPendingPanel } from '../src/screen/live/panelIntent';
import type { BridgeApi } from '../src/bridge/client';
import type { Fixture } from '../src/fixture/types';
import type {
  ConfigRequest,
  ConfigResponse,
  ConfigSnapshot,
  ChatMessageView,
  ChatProjectView,
  ChatRequest,
  ChatResponse,
  ChatSessionView,
  DataEvent,
} from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class IOStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= IOStub;

const MS = 1717243200000; // 2024-06-01T12:00:00.000Z

// ── 挂载胶水 ──
let container: HTMLElement | null = null;
let root: Root | null = null;
async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => {
    r.render(element);
  });
  await act(async () => {});
  return el;
}
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  // 排空面板意图信箱（跨测试单例，防污染）。
  consumePendingPanel();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
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
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── 桥工厂（可注 projects/sessions/messages + 捕获 data.event 推送 handler） ──
function makeBridge(
  opts: {
    projects?: ChatProjectView[];
    sessions?: ChatSessionView[];
    messages?: ChatMessageView[];
    ccDetected?: boolean;
  } = {},
) {
  const sendAction = vi.fn();
  let dataHandler: ((e: DataEvent) => void) | null = null;
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: opts.projects ?? [], ccDetected: opts.ccDetected ?? true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: opts.sessions ?? [] });
      case 'session':
        return Promise.resolve({ kind: 'messages', messages: opts.messages ?? [] });
      case 'search':
        return Promise.resolve({ kind: 'search', results: [] });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((h: (e: DataEvent) => void) => {
    dataHandler = h;
    return () => {
      dataHandler = null;
    };
  });
  // ChatHistoryChrome 包 ConfigProvider（R7.3）→ 挂载即拉 config get；默认存根返回 archiveEnabled=true 快照。
  const sendConfigRequest = vi.fn((req: ConfigRequest): Promise<ConfigResponse> =>
    req.kind === 'get' || req.kind === 'set'
      ? Promise.resolve({ kind: 'snapshot', config: fullSnapshot(true) })
      : Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' }),
  );
  const sendAppRequest = vi.fn(() => Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' }));
  const bridge = {
    sendAction,
    sendChatRequest,
    subscribeDataEvent,
    sendConfigRequest,
    sendAppRequest,
  } as unknown as BridgeApi;
  return { bridge, sendAction, emit: (e: DataEvent) => dataHandler?.(e) };
}

function chromeFx(over: Partial<Fixture> = {}): Fixture {
  return { id: 'batch3-chrome', theme: 'dark', terminals: [], ...over } as unknown as Fixture;
}
function liveFx(): Fixture {
  return { id: 'batch3-live', theme: 'dark', terminals: [] } as unknown as Fixture;
}

function tab(label: string): HTMLButtonElement {
  const btns = [...container!.querySelectorAll('.menu-bar__tab')] as HTMLButtonElement[];
  const found = btns.find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`菜单栏无 tab 文案含「${label}」`);
  return found;
}
function click(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// ════════════════════════════════════════════════════════════════════════
// W1：ChatHistoryChrome 顶部 tab 集成（MenuBar activeTab=chat + tab 路由三分支 + 面板意图信箱）
// ════════════════════════════════════════════════════════════════════════

describe('W1 ChatHistoryChrome（顶部 tab 栏保留）', () => {
  test('渲染 menu-bar 且历史聊天 tab 高亮（activeTab=chat）', async () => {
    const { bridge } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge }));
    expect(container!.querySelector('.menu-bar'), 'menu-bar 挂载').not.toBeNull();
    expect(container!.querySelector('.chat-history-overlay'), 'chat 面板嵌于菜单栏下').not.toBeNull();
    expect(tab('历史聊天').classList.contains('menu-bar__tab--active'), '历史聊天 tab 高亮').toBe(true);
    expect(tab('终端').classList.contains('menu-bar__tab--active'), '终端 tab 未高亮').toBe(false);
  });

  test('点终端 tab → chatClose（回终端态）', async () => {
    const { bridge, sendAction } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge }));
    await click(tab('终端'));
    expect(sendAction).toHaveBeenCalledWith({ kind: 'chatClose' });
  });

  test('点历史聊天 tab → no-op（不发任何 ui.action）', async () => {
    const { bridge, sendAction } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge }));
    await click(tab('历史聊天'));
    expect(sendAction).not.toHaveBeenCalled();
  });

  test('点配置 tab（Skills）→ 投面板意图信箱 skills + chatClose', async () => {
    const { bridge, sendAction } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge }));
    await click(tab('Skills'));
    expect(sendAction).toHaveBeenCalledWith({ kind: 'chatClose' });
    expect(consumePendingPanel(), '信箱待开 skills').toBe('skills');
  });

  test('点齿轮 settings → 投信箱 settings + chatClose', async () => {
    const { bridge, sendAction } = makeBridge();
    await mount(createElement(ChatHistoryChrome, { fx: chromeFx(), bridge }));
    const gear = container!.querySelector('.menu-bar__icon-btn[title="设置"]')!;
    await click(gear);
    expect(sendAction).toHaveBeenCalledWith({ kind: 'chatClose' });
    expect(consumePendingPanel(), '信箱待开 settings').toBe('settings');
  });
});

// ════════════════════════════════════════════════════════════════════════
// W1：LiveChrome 端（挂载消费信箱开面板 + 历史聊天 tab → chatOpen）
// ════════════════════════════════════════════════════════════════════════

describe('W1 LiveChrome（信箱消费 + chat tab → chatOpen）', () => {
  test('挂载时 consumePendingPanel → 直接打开待开面板（mcp）', async () => {
    setPendingPanel('mcp');
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(createElement(LiveChrome, { fx: liveFx(), onAction, onTermCommand }));
    const overlay = container!.querySelector('.live-panel-overlay');
    expect(overlay, 'overlay 挂载').not.toBeNull();
    expect(overlay!.getAttribute('data-live-panel'), '直接开 mcp 面板').toBe('mcp');
  });

  test('无待开面板 → 终端态无 overlay；点历史聊天 tab → chatOpen', async () => {
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(createElement(LiveChrome, { fx: liveFx(), onAction, onTermCommand }));
    expect(container!.querySelector('.live-panel-overlay'), '无待开面板 → 终端态').toBeNull();
    await click(tab('历史聊天'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'chatOpen' });
    // chat tab 不开配置面板 overlay
    expect(container!.querySelector('.live-panel-overlay')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// W5：归档进度 banner 三段（首扫中 → 完成 hold ~2s → 静态长文案；× 关闭走既有 localStorage）
// ════════════════════════════════════════════════════════════════════════

function bannerText(): string {
  return container!.querySelector('.chat-archive-banner__text')?.textContent ?? '';
}

describe('W5 归档进度 banner 三段（fake timers）', () => {
  test('首扫中显进度 → 完成 hold ~2s → 回静态长文案', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge, emit } = makeBridge();
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await flush();

    // ① 首扫中（syncing 且 synced<total）
    await act(async () => emit({ kind: 'chatSyncStatus', status: 'syncing', synced: 1, total: 3 }));
    expect(bannerText()).toContain('正在归档 1/3');
    expect(bannerText()).not.toContain('共享归档库');   // PR-5：进度态不显静态长文案

    // 进度推进
    await act(async () => emit({ kind: 'chatSyncStatus', status: 'syncing', synced: 2, total: 3 }));
    expect(bannerText()).toContain('正在归档 2/3');

    // ② 完成（末帧 synced==total / 转 idle）→ hold 期仍显进度
    await act(async () => emit({ kind: 'chatSyncStatus', status: 'idle', lastSyncMs: MS, synced: 3, total: 3 }));
    expect(bannerText()).toContain('正在归档 3/3');

    // hold 满 ~2s → 回静态长文案
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(bannerText()).toContain('共享归档库');   // PR-5：回落到共享归档库静态长文案
    expect(bannerText()).not.toContain('正在归档');
  });

  test('③ × 关闭 → banner 连同进度整条隐藏（localStorage 一次性）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge, emit } = makeBridge();
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await flush();
    await act(async () => emit({ kind: 'chatSyncStatus', status: 'syncing', synced: 1, total: 3 }));
    expect(container!.querySelector('.chat-archive-banner')).not.toBeNull();

    await click(container!.querySelector('.chat-archive-banner__close')!);
    expect(container!.querySelector('.chat-archive-banner'), '× 关闭后整条 banner 消失').toBeNull();
    // 进度帧再来也不显示（banner 已隐藏）
    await act(async () => emit({ kind: 'chatSyncStatus', status: 'syncing', synced: 2, total: 3 }));
    expect(container!.querySelector('.chat-archive-banner')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// W12：canResume 放开 archiveOnly（★批2 裁决超30天可达）+ resumeCwd 三级解析
// ════════════════════════════════════════════════════════════════════════

async function selectFirstCardAndFlush(): Promise<void> {
  // 首屏 projects→sessions 落地
  for (let i = 0; i < 12; i++) {
    await flush();
    if (container!.querySelector('.session-card')) break;
  }
  const card = container!.querySelector('.session-card');
  if (!card) throw new Error('session-card 未渲染');
  await act(async () => {
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(220); // 单击选中去抖
  });
  await flush();
  await flush();
}

describe('W12 canResume 放开 archiveOnly + 三级 cwd', () => {
  test('archiveOnly 会话（cwd 就位）→ 继续聊天按钮可达（去掉 !archiveOnly 拦截）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge, sendAction } = makeBridge({
      sessions: [
        { sessionId: 's1', projectHash: 'ph', title: 't', startedAtMs: MS, lastModifiedMs: MS, fileSize: 1, source: 'claudeCode', cwd: '/w', archiveOnly: true },
      ],
      messages: [{ uuid: 'm1', sessionId: 's1', role: 'user', cwd: '/w', tsMs: MS, text: 'hi' }],
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await selectFirstCardAndFlush();
    const btn = container!.querySelector('.session-detail__resume-btn');
    expect(btn, 'archiveOnly 会话继续聊天按钮必须可达').not.toBeNull();
    await click(btn!);
    expect(sendAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'chatResume', sessionId: 's1', cwd: '/w' }),
    );
  });

  test('三级 cwd：会话/消息均无 cwd → 退回项目 displayPath', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge, sendAction } = makeBridge({
      projects: [
        { projectHash: 'ph', displayPath: '/proj/root', displayName: 'root', sessionCount: 1, totalSize: 0, lastActivityMs: MS },
      ],
      sessions: [
        { sessionId: 's1', projectHash: 'ph', title: 't', startedAtMs: MS, lastModifiedMs: MS, fileSize: 1, source: 'claudeCode' },
      ],
      messages: [{ uuid: 'm1', sessionId: 's1', role: 'user', tsMs: MS, text: 'hi' }], // 无 cwd
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await selectFirstCardAndFlush();
    const btn = container!.querySelector('.session-detail__resume-btn');
    expect(btn, '三级 cwd 解析成功 → 按钮可达').not.toBeNull();
    await click(btn!);
    expect(sendAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'chatResume', sessionId: 's1', cwd: '/proj/root' }),
    );
  });

  test('三级全空（无项目 displayPath 兜底）→ canResume=false 按钮不显', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bridge } = makeBridge({
      projects: [], // 无项目兜底
      sessions: [
        { sessionId: 's1', projectHash: 'ph', title: 't', startedAtMs: MS, lastModifiedMs: MS, fileSize: 1, source: 'claudeCode' },
      ],
      messages: [{ uuid: 'm1', sessionId: 's1', role: 'user', tsMs: MS, text: 'hi' }], // 无 cwd
    });
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await selectFirstCardAndFlush();
    expect(container!.querySelector('.session-detail__resume-btn'), 'cwd 全空 → 按钮不显').toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// 对抗 M-1：归档开关 UI（R7.3）——读 ConfigSnapshot.archiveEnabled + 切换发 PrefsPatch + 写失败回弹
// ════════════════════════════════════════════════════════════════════════

function fullSnapshot(archiveEnabled: boolean): ConfigSnapshot {
  return {
    startupTerminalCount: 1,
    doubleClickToFocus: false,
    dockBadgeMode: 'off',
    dockBadgeIntervalMin: 5,
    defaultTerminalCwd: '',
    showHiddenFiles: false,
    language: 'zh',
    theme: 'dark',
    terminalThemeName: 'default',
    fontSize: 13,
    gridLayout: { columnRatios: [1], rowRatios: [1] },
    ftvLeftWidth: 200,
    ftvRightWidth: 200,
    archiveEnabled,
    tourCompleted: false,
  };
}

function makeConfigBridge(initialArchive: boolean, setResult: 'ok' | 'reject') {
  let current = initialArchive;
  const setPatches: Array<{ archiveEnabled?: boolean }> = [];
  const sendConfigRequest = vi.fn((req: ConfigRequest): Promise<ConfigResponse> => {
    if (req.kind === 'get') return Promise.resolve({ kind: 'snapshot', config: fullSnapshot(current) });
    if (req.kind === 'set') {
      setPatches.push(req.patch);
      if (setResult === 'reject') return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
      if (req.patch.archiveEnabled != null) current = req.patch.archiveEnabled;
      return Promise.resolve({ kind: 'snapshot', config: fullSnapshot(current) });
    }
    return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
  });
  const sendChatRequest = vi.fn((req: ChatRequest): Promise<ChatResponse> => {
    switch (req.kind) {
      case 'projects':
        return Promise.resolve({ kind: 'projects', projects: [], ccDetected: true });
      case 'sessions':
        return Promise.resolve({ kind: 'sessions', sessions: [] });
      case 'session':
        return Promise.resolve({ kind: 'messages', messages: [] });
      case 'search':
        return Promise.resolve({ kind: 'search', results: [] });
      default:
        return Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' });
    }
  });
  const subscribeDataEvent = vi.fn((_h: (e: DataEvent) => void) => () => {});
  const sendAppRequest = vi.fn(() => Promise.resolve({ kind: 'rejected', code: 'x', message: 'x' }));
  const bridge = {
    sendAction: vi.fn(),
    sendChatRequest,
    subscribeDataEvent,
    sendConfigRequest,
    sendAppRequest,
  } as unknown as BridgeApi;
  return { bridge, setPatches, sendConfigRequest };
}

function archiveCheckbox(): HTMLInputElement {
  const el = container!.querySelector('.chat-archive-toggle input') as HTMLInputElement | null;
  if (!el) throw new Error('归档开关 checkbox 未渲染（banner 缺失？）');
  return el;
}
function archiveLabel(): string {
  return container!.querySelector('.chat-archive-toggle span')?.textContent ?? '';
}

async function mountWithConfig(bridge: BridgeApi): Promise<void> {
  await mount(
    createElement(ConfigProvider, { bridge, children: createElement(ChatHistoryLive, { fx: liveFx(), bridge }) }),
  );
  await flush(); // config get 落地
  await flush();
}

describe('M-1 归档开关 UI（R7.3）', () => {
  test('初值：读 ConfigSnapshot.archiveEnabled=false → checkbox 未勾 + 文案「关闭」', async () => {
    const { bridge } = makeConfigBridge(false, 'ok');
    await mountWithConfig(bridge);
    expect(archiveCheckbox().checked).toBe(false);
    expect(archiveLabel()).toContain('关闭');
  });

  test('切换：勾选状态点击 → 发 PrefsPatch{archiveEnabled:false} + 乐观翻牌「关闭」', async () => {
    const { bridge, setPatches } = makeConfigBridge(true, 'ok');
    await mountWithConfig(bridge);
    expect(archiveCheckbox().checked).toBe(true);
    await act(async () => {
      archiveCheckbox().click();
    });
    await flush();
    expect(setPatches).toContainEqual({ archiveEnabled: false });
    expect(archiveCheckbox().checked).toBe(false);
    expect(archiveLabel()).toContain('关闭');
  });

  test('回弹：set 被 rejected → 重拉 get 校正回权威态（checkbox 回勾）', async () => {
    const { bridge, setPatches } = makeConfigBridge(true, 'reject');
    await mountWithConfig(bridge);
    expect(archiveCheckbox().checked).toBe(true);
    await act(async () => {
      archiveCheckbox().click();
    });
    await flush();
    await flush();
    expect(setPatches).toContainEqual({ archiveEnabled: false }); // 确实发了 patch
    expect(archiveCheckbox().checked, 'rejected → get 校正回 true').toBe(true);
    expect(archiveLabel()).toContain('开启');
  });

  test('golden 安全：无 ConfigProvider（旧直挂）→ checkbox readOnly inert，默认勾选', async () => {
    const { bridge } = makeBridge();
    await mount(createElement(ChatHistoryLive, { fx: liveFx(), bridge }));
    await flush();
    // 无 configApi：archiveEnabled 默认 true；checkbox 不接 onChange，点击不发 config.request
    expect(archiveCheckbox().checked).toBe(true);
    await act(async () => {
      archiveCheckbox().click();
    });
    await flush();
    expect(archiveCheckbox().checked, '无 configApi → 点击 inert').toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 对抗 M-2：StrictMode（dev）双渲染下面板意图不丢（peek 初始化器纯读 + effect 清除幂等）
// ════════════════════════════════════════════════════════════════════════

describe('M-2 StrictMode 面板意图不丢', () => {
  test('StrictMode 包裹 LiveChrome：待开 mcp 意图挂载后仍打开（初始化器双调不吞）', async () => {
    setPendingPanel('mcp');
    const onAction = vi.fn();
    const onTermCommand = vi.fn();
    await mount(
      createElement(
        StrictMode,
        null,
        createElement(LiveChrome, { fx: liveFx(), onAction, onTermCommand }),
      ),
    );
    const overlay = container!.querySelector('.live-panel-overlay');
    expect(overlay, 'StrictMode 下 overlay 仍挂载').not.toBeNull();
    expect(overlay!.getAttribute('data-live-panel'), 'mcp 意图未被 StrictMode 第二次初始化器吞掉').toBe('mcp');
    // 挂载 effect 已清空信箱（一次性消费落定）
    expect(consumePendingPanel(), '信箱已清空').toBeNull();
  });
});
