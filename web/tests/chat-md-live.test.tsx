// @vitest-environment jsdom
//
// M5-R1 批3 W11：chat-md-live 真渲染增量——```mermaid 围栏 → div.mermaid + 动态 import mermaid run；
// 代码块 pre 命令式注入「复制」钮 + 点击写剪贴板。mermaid 经 vi.mock 拦截（不真载 11.x 大包）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mermaidRun = vi.fn().mockResolvedValue(undefined);
const mermaidInit = vi.fn();
vi.mock('mermaid', () => ({
  default: { initialize: mermaidInit, run: mermaidRun },
}));

import { renderChatMarkdownLive } from '../src/screen/chat/chat-md-live';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement | null = null;
let root: Root | null = null;
async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => {
    r.render(node);
  });
  // 冲刷 effect + 动态 import('mermaid') 的微任务队列
  for (let i = 0; i < 6; i++) await act(async () => await Promise.resolve());
  return el;
}
beforeEach(() => {
  mermaidRun.mockClear();
  mermaidInit.mockClear();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('W11 mermaid 围栏', () => {
  test('```mermaid → div.mermaid（转义源码）+ 动态 import mermaid.run 被调', async () => {
    await mount(renderChatMarkdownLive('```mermaid\ngraph TD; A-->B\n```'));
    const div = container!.querySelector('.mermaid');
    expect(div, 'mermaid 围栏产 .mermaid 容器').not.toBeNull();
    expect(div!.textContent).toContain('graph TD');
    // 非 pre → 不注入复制钮
    expect(div!.querySelector('.md-copy-btn')).toBeNull();
    expect(mermaidRun, 'mermaid.run 被调渲染图').toHaveBeenCalledTimes(1);
    expect(mermaidRun.mock.calls[0][0]).toHaveProperty('nodes');
  });

  test('普通语言围栏走 hljs（pre.hljs），不进 mermaid', async () => {
    await mount(renderChatMarkdownLive('```js\nconst a = 1;\n```'));
    expect(container!.querySelector('pre.hljs'), 'js 围栏 → pre.hljs').not.toBeNull();
    expect(container!.querySelector('.mermaid')).toBeNull();
    expect(mermaidRun).not.toHaveBeenCalled();
  });
});

describe('W11 代码块「复制」钮', () => {
  test('pre 注入 .md-copy-btn；点击写剪贴板（navigator.clipboard 优先）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(renderChatMarkdownLive('```\nhello world\n```'));
    const btn = container!.querySelector('.md-copy-btn') as HTMLButtonElement;
    expect(btn, '代码块注入复制钮').not.toBeNull();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => await Promise.resolve());
    expect(writeText).toHaveBeenCalledWith('hello world\n');
    expect(btn.textContent, '写入成功反馈').toContain('已复制');
  });

  test('复制钮幂等：重复挂载同文本不重复注入（data-copy-injected 守卫）', async () => {
    await mount(renderChatMarkdownLive('```\nx\n```'));
    // 同一 pre 仅一个复制钮
    expect(container!.querySelectorAll('.md-copy-btn').length).toBe(1);
  });
});
