// @vitest-environment jsdom
//
// MarkdownWysiwygLive（M6 批1，A3）：source 模式可编辑 textarea onChange → markdown 上抛；
// ⌘/（Cmd/Ctrl+Slash）切模式。TipTap wysiwyg 经 React.lazy 隔离（golden 铁律）→ 本测试只覆盖
// source 模式与模式切换的数据路径（不挂 TipTap，避 ProseMirror-in-jsdom 噪声）。
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MarkdownWysiwygLive, type MarkdownEditorMode } from '../src/markdown/MarkdownWysiwygLive';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = '';
});
beforeEach(() => {
  container = null;
  root = null;
});

/** 受控宿主：持 value/mode，把回调转发给 spy。 */
function Host({ onChange, onModeChange }: { onChange: (md: string) => void; onModeChange: (m: MarkdownEditorMode) => void }): JSX.Element {
  const [value, setValue] = useState('# init');
  const [mode, setMode] = useState<MarkdownEditorMode>('source');
  return createElement(MarkdownWysiwygLive, {
    value,
    mode,
    onChange: (md: string) => { setValue(md); onChange(md); },
    onModeChange: (m: MarkdownEditorMode) => { setMode(m); onModeChange(m); },
  });
}

async function mount(onChange: (md: string) => void, onModeChange: (m: MarkdownEditorMode) => void): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Host, { onChange, onModeChange }));
  });
}

test('MarkdownWysiwygLive: source 模式 textarea 编辑 → onChange(markdown) 上抛', async () => {
  const onChange = vi.fn();
  const onModeChange = vi.fn();
  await mount(onChange, onModeChange);

  const ta = document.querySelector<HTMLTextAreaElement>('.markdown-wysiwyg-live__source')!;
  expect(ta).not.toBeNull();
  expect(ta.value).toBe('# init');

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, '# init\n\nmore');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith('# init\n\nmore');
});

test('MarkdownWysiwygLive: ⌘/ 切换 source/wysiwyg 模式', async () => {
  const onChange = vi.fn();
  const onModeChange = vi.fn();
  await mount(onChange, onModeChange);

  const rootEl = document.querySelector('.markdown-wysiwyg-live')!;
  await act(async () => {
    rootEl.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
  });
  // source → wysiwyg
  expect(onModeChange).toHaveBeenCalledWith('wysiwyg');
});
