// @vitest-environment jsdom
//
// M6 批1 spec 翻牌（web，A3）：Skills 选中自动 load SKILL.md / Hooks 表单保存回写 settings。
// 真实 live 组件（SkillsPanelLive/HooksPanelLive）经 A2 的 ConfigProvider 挂载，桥用 stub
// （sendConfigRequest 按 kind 派发 canned 响应，永不真桥）。断言经委托点击驱动真实交互路径。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider } from '../src/config/ConfigContext';
import type { BridgeApi } from '../src/bridge/client';
import type { ConfigRequest, ConfigResponse, ConfigSnapshot } from '../src/bridge/gen/protocol';
import { SkillsPanelLive } from '../src/screen/panels/live/SkillsPanelLive';
import { HooksPanelLive } from '../src/screen/panels/live/HooksPanelLive';

// TipTap 懒加载编辑器在 jsdom 无意义（ProseMirror 需真 DOM）→ mock 为 null，断言只看数据路径。
vi.mock('../src/markdown/TiptapEditor', () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SNAPSHOT: ConfigSnapshot = {
  startupTerminalCount: 1,
  doubleClickToFocus: false,
  dockBadgeMode: 'off',
  dockBadgeIntervalMin: 5,
  defaultTerminalCwd: '~',
  showHiddenFiles: false,
  language: 'zh',
  theme: 'dark',
  terminalThemeName: 'dark',
  fontSize: 13,
  gridLayout: { columnRatios: [1], rowRatios: [1] },
  ftvLeftWidth: 220,
  ftvRightWidth: 320,
  archiveEnabled: true,
    tourCompleted: false,
};

/** 最小 stub 桥：只实装 sendConfigRequest（按 kind 派发），其余 no-op/reject。 */
function stubBridge(handler: (req: ConfigRequest) => ConfigResponse): { bridge: BridgeApi; calls: ConfigRequest[] } {
  const calls: ConfigRequest[] = [];
  const bridge: BridgeApi = {
    sendAction: () => {},
    sendTelemetry: () => {},
    sendTermCommand: () => Promise.reject(new Error('n/a')),
    sendOrchCommand: () => Promise.reject(new Error('n/a')),
    sendOrchQuery: () => Promise.reject(new Error('n/a')),
    sendFsRequest: () => Promise.reject(new Error('n/a')),
    subscribeDataEvent: () => () => {},
    sendChatRequest: () => Promise.reject(new Error('n/a')),
    sendAppRequest: () => Promise.reject(new Error('n/a')),
    getAppVersion: () => '0.5.0',
    sendConfigRequest: (req: ConfigRequest) => {
      calls.push(req);
      return Promise.resolve(handler(req));
    },
  };
  return { bridge, calls };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function mount(el: JSX.Element): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
  });
  await flush();
}

async function click(sel: string): Promise<void> {
  await act(async () => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`元素不存在: ${sel}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush(2);
}

async function setTextarea(sel: string, value: string): Promise<void> {
  await act(async () => {
    const el = document.querySelector<HTMLTextAreaElement>(sel)!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush(1);
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

beforeEach(() => {
  container = null;
  root = null;
});

describe('M6 批1 live 面板交互翻牌', () => {
  // CONFIG_L1_12：预览 Skill 内容 — 点击 Skill 自动 load SKILL.md 渲染右栏。
  test('CONFIG_L1_12: 选中 skill → 自动 readResource(SKILL.md) → 右栏渲染内容', async () => {
    const { bridge, calls } = stubBridge((req) => {
      if (req.kind === 'get') return { kind: 'snapshot', config: SNAPSHOT };
      if (req.kind === 'listResources') return { kind: 'resources', items: [{ name: 'alpha-skill', path: '/s/alpha', type: 'skills' }] };
      if (req.kind === 'readResource') return { kind: 'resourceContent', content: '# Alpha\n\nbody text', format: 'md' };
      if (req.kind === 'listResourceDir') return { kind: 'dirEntries', entries: [{ name: 'SKILL.md', isDirectory: false }] };
      return { kind: 'rejected', code: 'x', message: 'x' };
    });

    await mount(createElement(ConfigProvider, { bridge, children: createElement(SkillsPanelLive, { onClose: () => {} }) }));

    // 列表已渲染（listResources 映射）
    expect(document.querySelector('.skill-list__item-name')?.textContent).toBe('alpha-skill');

    await click('.skill-list__item');

    // 自动 load：readResource 命中 <path>/SKILL.md
    const read = calls.find((c) => c.kind === 'readResource');
    expect(read).toEqual({ kind: 'readResource', path: '/s/alpha/SKILL.md' });
    // 右栏渲染 SKILL.md 内容（golden 静态渲染器把 '# Alpha' 渲入 .tiptap）
    expect(document.body.textContent).toContain('Alpha');
  });

  // CONFIG_L1_13：编辑 Settings（hooks 表单）— 改值保存后 saveSettings 写入含更新的 settings。
  test('CONFIG_L1_13: hooks 表单保存 → saveSettings payload 含更新命令', async () => {
    const settingsJson = JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'old cmd' }] }] },
    });
    const { bridge, calls } = stubBridge((req) => {
      if (req.kind === 'get') return { kind: 'snapshot', config: SNAPSHOT };
      if (req.kind === 'getSettings') return { kind: 'settingsJson', json: settingsJson };
      if (req.kind === 'saveSettings') return { kind: 'saved' };
      return { kind: 'rejected', code: 'x', message: 'x' };
    });

    await mount(createElement(ConfigProvider, { bridge, children: createElement(HooksPanelLive, { onClose: () => {} }) }));

    // 列表渲染一条 hook；选中 → 编辑 → 进 form
    expect(document.querySelector('.hooks-panel__item')).not.toBeNull();
    await click('.hooks-panel__item');
    await click('.hooks-panel__btn--primary'); // detail 的「编辑」
    // form 覆盖层就位（命令预填 old cmd）
    const cmd = document.querySelector<HTMLTextAreaElement>('.panel-form-live-cover .hooks-panel__form-textarea');
    expect(cmd?.value).toBe('old cmd');

    await setTextarea('.panel-form-live-cover .hooks-panel__form-textarea', 'new cmd');
    await click('.panel-form-live-cover .hooks-panel__btn--primary'); // form 的「保存」

    const saved = calls.find((c) => c.kind === 'saveSettings') as { kind: 'saveSettings'; json: string } | undefined;
    expect(saved).toBeDefined();
    expect(saved!.json).toContain('new cmd');
    expect(saved!.json).not.toContain('old cmd');
  });
});
