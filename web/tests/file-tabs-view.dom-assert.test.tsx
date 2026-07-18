// @vitest-environment jsdom
//
// M6 批B tab 式文件视图：纯 View DOM 断言（specs/behavior/file-tabs-view.md §1/§3/§4）。
// 纯组件直挂（零桥、零 native）：tab 栏结构 / 内容区 fileType 分发 / 三形态对话框 / 回调 inert /
// truncated 只读横幅 / 终端洞 data-term-id / 左树 active 高亮 + 空态 / SheetBody maxRows 截断。
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileTabsView, type FileTabsViewProps } from '../src/screen/filetabs/FileTabsView';
import { buildTerminalLights } from '../src/screen/filetabs/FileTabBar';
import { SheetBody } from '../src/screen/file/SheetBody';
import { TERMINAL_TAB_ID, type FileTab } from '../src/screen/filetabs/fileTabsReducer';
import type { FlatEntry } from '../src/screen/file/file-tree-static';
import type { TerminalFixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}
function click(el: Element | null): Promise<void> {
  return act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
const q = (sel: string): Element | null => container.querySelector(sel);
const qa = (sel: string): Element[] => Array.from(container.querySelectorAll(sel));

function loaded(content: string, over: Partial<Extract<FileTab['load'], { k: 'loaded' }>> = {}): FileTab['load'] {
  return { k: 'loaded', content, encoding: 'utf8', truncated: false, mtimeMs: 1, ...over };
}
function mkTab(path: string, over: Partial<FileTab> = {}): FileTab {
  return {
    path,
    name: path.split('/').pop() ?? path,
    fileType: 'text',
    load: loaded(''),
    dirtyValue: null,
    mdSource: false,
    saving: false,
    saveError: null,
    ...over,
  };
}
function baseProps(over: Partial<FileTabsViewProps> = {}): FileTabsViewProps {
  return {
    sourceTerminalId: 't1',
    terminalLabel: 'muxvo',
    entries: [],
    showHidden: false,
    activeFilePath: null,
    tabs: [],
    activeId: TERMINAL_TAB_ID,
    dialog: null,
    ...over,
  };
}
const view = (over: Partial<FileTabsViewProps> = {}): ReactNode =>
  createElement(FileTabsView, baseProps(over));

// ── tab 栏结构 ──

test('tab 栏：终端 tab 首位、不可关（无 ✕）；文件 tab 带 ✕；dirty tab 带琥珀点', async () => {
  await render(
    view({
      tabs: [mkTab('/p/a.ts', { dirtyValue: 'x' }), mkTab('/p/b.md', { fileType: 'markdown' })],
      activeId: '/p/a.ts',
    }),
  );
  const tabs = qa('.file-tabs-view__tabs > .file-tabs-view__tab');
  expect(tabs).toHaveLength(3); // 终端 + 2 文件
  // 首位是终端 tab，且内部无关闭按钮
  expect(tabs[0].classList.contains('file-tabs-view__tab--terminal')).toBe(true);
  expect(tabs[0].querySelector('.file-tabs-view__tab-close')).toBeNull();
  // 文件 tab 均有 ✕
  expect(tabs[1].querySelector('.file-tabs-view__tab-close')).not.toBeNull();
  expect(tabs[2].querySelector('.file-tabs-view__tab-close')).not.toBeNull();
  // dirty tab（/p/a.ts）有琥珀点，clean tab 无
  expect(tabs[1].querySelector('.file-tabs-view__tab-dot')).not.toBeNull();
  expect(tabs[2].querySelector('.file-tabs-view__tab-dot')).toBeNull();
  // 活跃态
  expect(tabs[1].classList.contains('file-tabs-view__tab--active')).toBe(true);
  expect(tabs[0].classList.contains('file-tabs-view__tab--active')).toBe(false);
  // 回平铺按钮存在
  expect(q('.file-tabs-view__exit')).not.toBeNull();
});

test('tab 栏：终端 tab 活跃时首位高亮', async () => {
  await render(view({ tabs: [mkTab('/p/a.ts')], activeId: TERMINAL_TAB_ID }));
  const first = q('.file-tabs-view__tabs > .file-tabs-view__tab');
  expect(first?.classList.contains('file-tabs-view__tab--active')).toBe(true);
});

// ── 内容区 fileType 分发 ──

test('内容区：终端 tab 活跃 → 渲染真洞 div（data-term-id）', async () => {
  await render(view({ activeId: TERMINAL_TAB_ID, renderHole: true }));
  const hole = q('.file-tabs-view__content .tile-term-hole');
  expect(hole).not.toBeNull();
  expect(hole?.getAttribute('data-term-id')).toBe('t1');
  expect(hole?.getAttribute('data-term-role')).toBe('grid');
});

test('洞透明修饰类：终端 tab 活跃挂 --hole（root+content 双层）；文件 tab / renderHole=false 不挂', async () => {
  // 真机黑屏回修（2026-07-08）：--hole 是 live-transparent.css 打穿 --bg-deep/--bg-primary
  // 双层不透明底的钩子；文件 tab 活跃与静态占位（renderHole=false）都不得挂，否则透出窗底色。
  await render(view({ activeId: TERMINAL_TAB_ID, renderHole: true }));
  expect(q('.file-tabs-view')?.classList.contains('file-tabs-view--hole')).toBe(true);
  expect(q('.file-tabs-view__content')?.classList.contains('file-tabs-view__content--hole')).toBe(true);
  await render(view({ tabs: [mkTab('/p/a.ts')], activeId: '/p/a.ts' }));
  expect(q('.file-tabs-view')?.classList.contains('file-tabs-view--hole')).toBe(false);
  expect(q('.file-tabs-view__content--hole')).toBeNull();
  await render(view({ activeId: TERMINAL_TAB_ID, renderHole: false }));
  expect(q('.file-tabs-view')?.classList.contains('file-tabs-view--hole')).toBe(false);
  expect(q('.file-tabs-view__term-placeholder')).not.toBeNull();
});

test('内容区：markdown 默认 WYSIWYG 渲染（.tiptap）+ Source 切换钮 title=⌘/', async () => {
  await render(
    view({ tabs: [mkTab('/p/a.md', { fileType: 'markdown', load: loaded('# Hello') })], activeId: '/p/a.md' }),
  );
  expect(q('.markdown-wysiwyg .tiptap')).not.toBeNull();
  expect(q('.tiptap h1')?.textContent).toBe('Hello');
  const mode = q('.file-tabs-view__md-mode');
  expect(mode?.getAttribute('title')).toBe('⌘/');
  expect(mode?.textContent).toBe('Source');
});

test('内容区：markdown Source 模式 → 受控 textarea（值=内容）', async () => {
  await render(
    view({ tabs: [mkTab('/p/a.md', { fileType: 'markdown', mdSource: true, load: loaded('# Hi') })], activeId: '/p/a.md' }),
  );
  const ta = q('.file-tabs-view__editor') as HTMLTextAreaElement | null;
  expect(ta).not.toBeNull();
  expect(ta!.value).toBe('# Hi');
  expect(q('.file-tabs-view__md-mode')?.textContent).toBe('WYSIWYG');
});

test('内容区：code → 行号列 + 受控 textarea（行号数=行数）', async () => {
  await render(
    view({ tabs: [mkTab('/p/a.ts', { fileType: 'code', load: loaded('l1\nl2\nl3') })], activeId: '/p/a.ts' }),
  );
  expect(q('.file-tabs-view__text--code')).not.toBeNull();
  expect(qa('.file-tabs-view__gutter-line')).toHaveLength(3);
  expect((q('.file-tabs-view__editor') as HTMLTextAreaElement).value).toBe('l1\nl2\nl3');
});

test('内容区：text truncated → 只读横幅 + textarea readOnly', async () => {
  await render(
    view({
      tabs: [mkTab('/p/big.txt', { fileType: 'text', load: loaded('...', { truncated: true }) })],
      activeId: '/p/big.txt',
      onEdit: vi.fn(), // 即便给了 onEdit，truncated 仍只读
    }),
  );
  expect(q('.file-tabs-view__truncated-banner')).not.toBeNull();
  expect((q('.file-tabs-view__editor') as HTMLTextAreaElement).readOnly).toBe(true);
});

test('内容区：image → data-URI img', async () => {
  await render(
    view({
      tabs: [mkTab('/p/pic.png', { fileType: 'image', load: loaded('AAAA', { encoding: 'base64' }) })],
      activeId: '/p/pic.png',
    }),
  );
  const img = q('.file-tabs-view__image img') as HTMLImageElement | null;
  expect(img).not.toBeNull();
  expect(img!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
});

test('内容区：spreadsheet → 分发到 SpreadsheetBody seam（占位）', async () => {
  await render(
    view({ tabs: [mkTab('/p/d.xlsx', { fileType: 'spreadsheet', load: loaded('AAAA', { encoding: 'base64' }) })], activeId: '/p/d.xlsx' }),
  );
  expect(q('.file-tabs-view__sheet-pending')).not.toBeNull();
});

test('内容区：pdf → 分发到 PdfBody（.pdf-preview 容器）', async () => {
  await render(
    view({ tabs: [mkTab('/p/d.pdf', { fileType: 'pdf', load: loaded('bm90', { encoding: 'base64' }) })], activeId: '/p/d.pdf' }),
  );
  expect(q('.pdf-preview')).not.toBeNull();
});

test('内容区：loading / error 态', async () => {
  await render(view({ tabs: [mkTab('/p/a.ts', { load: { k: 'loading' } })], activeId: '/p/a.ts' }));
  expect(q('.file-tabs-view__loading')).not.toBeNull();

  await render(view({ tabs: [mkTab('/p/a.ts', { load: { k: 'error', message: 'EACCES 读取失败' } })], activeId: '/p/a.ts' }));
  expect(q('.file-tabs-view__error')?.textContent).toBe('EACCES 读取失败');
});

// ── 左树 ──

test('左树：activeFilePath 行高亮 file-item--active', async () => {
  const entries: FlatEntry[] = [
    { name: 'a.ts', type: 'file', path: '/p/a.ts', indent: 0 },
    { name: 'b.ts', type: 'file', path: '/p/b.ts', indent: 0 },
  ];
  await render(view({ entries, activeFilePath: '/p/b.ts' }));
  const items = qa('.file-tabs-view__left-content .file-item');
  expect(items).toHaveLength(2);
  expect(items[0].classList.contains('file-item--active')).toBe(false);
  expect(items[1].classList.contains('file-item--active')).toBe(true);
});

test('左树：emptyState → 空态文案（此目录为空 / 无权限）', async () => {
  await render(view({ emptyState: 'empty' }));
  expect(q('.file-tabs-view__empty-text')?.textContent).toBe('此目录为空');
  await render(view({ emptyState: 'permission' }));
  expect(q('.file-tabs-view__empty-text')?.textContent).toBe('无法读取此目录，请检查权限');
});

// ── 三形态对话框（§4） ──

test('对话框：closeConfirm → 保存/丢弃/取消三键 + overlay data-hit-island', async () => {
  const onDialogAction = vi.fn();
  await render(
    view({ tabs: [mkTab('/p/a.ts', { dirtyValue: 'x' })], activeId: '/p/a.ts', dialog: { k: 'closeConfirm', path: '/p/a.ts' }, onDialogAction }),
  );
  expect(q('.unsaved-prompt-dialog__title')?.textContent).toBe('未保存的更改');
  expect(q('.unsaved-prompt-dialog__overlay')?.hasAttribute('data-hit-island')).toBe(true);
  await click(q('.unsaved-prompt-dialog__btn--save'));
  await click(q('.unsaved-prompt-dialog__btn--discard'));
  await click(q('.unsaved-prompt-dialog__btn--cancel'));
  expect(onDialogAction.mock.calls.map((c) => c[0])).toEqual(['save', 'discard', 'cancel']);
});

test('对话框：exitSummary → 「N 个文件未保存」+ 文件列表 + 全部保存/全部丢弃/取消', async () => {
  const onDialogAction = vi.fn();
  await render(
    view({
      tabs: [mkTab('/p/a.ts', { dirtyValue: 'x' }), mkTab('/p/b.md', { fileType: 'markdown', dirtyValue: 'y' })],
      activeId: '/p/a.ts',
      dialog: { k: 'exitSummary', paths: ['/p/a.ts', '/p/b.md'] },
      onDialogAction,
    }),
  );
  expect(q('.unsaved-prompt-dialog__title')?.textContent).toBe('2 个文件未保存');
  const items = qa('.unsaved-prompt-dialog__list-item').map((el) => el.textContent);
  expect(items).toEqual(['a.ts', 'b.md']);
  await click(q('.unsaved-prompt-dialog__btn--save')); // 全部保存
  await click(q('.unsaved-prompt-dialog__btn--discard')); // 全部丢弃
  expect(onDialogAction.mock.calls.map((c) => c[0])).toEqual(['saveAll', 'discardAll']);
});

test('对话框：conflict → 「文件已被外部修改」覆盖/放弃（放弃=cancel）', async () => {
  const onDialogAction = vi.fn();
  await render(
    view({ tabs: [mkTab('/p/a.ts', { dirtyValue: 'x' })], activeId: '/p/a.ts', dialog: { k: 'conflict', path: '/p/a.ts' }, onDialogAction }),
  );
  expect(q('.unsaved-prompt-dialog__title')?.textContent).toBe('文件已被外部修改');
  await click(q('.unsaved-prompt-dialog__btn--save')); // 覆盖
  await click(q('.unsaved-prompt-dialog__btn--cancel')); // 放弃
  expect(onDialogAction.mock.calls.map((c) => c[0])).toEqual(['overwrite', 'cancel']);
});

// ── 回调接线 / inert ──

test('回调：点 tab / ✕ / 回平铺 → 各自回调（✕ 不冒泡触发选中）', async () => {
  const onSelectTab = vi.fn();
  const onCloseTab = vi.fn();
  const onExit = vi.fn();
  await render(
    view({ tabs: [mkTab('/p/a.ts')], activeId: TERMINAL_TAB_ID, onSelectTab, onCloseTab, onExit }),
  );
  const fileTab = qa('.file-tabs-view__tabs > .file-tabs-view__tab')[1];
  await click(fileTab.querySelector('.file-tabs-view__tab-name'));
  expect(onSelectTab).toHaveBeenCalledWith('/p/a.ts');
  onSelectTab.mockClear();
  await click(fileTab.querySelector('.file-tabs-view__tab-close'));
  expect(onCloseTab).toHaveBeenCalledWith('/p/a.ts');
  expect(onSelectTab).not.toHaveBeenCalled(); // ✕ stopPropagation，不触发选中
  await click(q('.file-tabs-view__exit'));
  expect(onExit).toHaveBeenCalled();
});

test('inert：回调全缺席时点击不抛错（静态屏 golden 工艺）', async () => {
  await render(view({ tabs: [mkTab('/p/a.ts')], activeId: '/p/a.ts' }));
  await expect(
    (async () => {
      await click(qa('.file-tabs-view__tab')[1].querySelector('.file-tabs-view__tab-close'));
      await click(q('.file-tabs-view__exit'));
      await click(q('.file-tabs-view__toggle-hidden'));
    })(),
  ).resolves.toBeUndefined();
});

// ── SheetBody maxRows 截断（新增能力；默认无上限 = 抽出前恒等） ──

test('SheetBody：maxRows 超限 → 截断至上限 + 提示行', async () => {
  const sheet = { sheetNames: ['S1'], activeSheet: 0, cells: [['a'], ['b'], ['c'], ['d'], ['e']] };
  await render(createElement(SheetBody, { sheet, maxRows: 2 }));
  expect(qa('.spreadsheet-view__table tbody tr')).toHaveLength(2);
  expect(q('.spreadsheet-view__truncated')).not.toBeNull();
});

test('SheetBody：默认（无 maxRows）→ 全量渲染、无截断提示（抽出前恒等）', async () => {
  const sheet = { sheetNames: ['S1'], activeSheet: 0, cells: [['a'], ['b'], ['c']] };
  await render(createElement(SheetBody, { sheet }));
  expect(qa('.spreadsheet-view__table tbody tr')).toHaveLength(3);
  expect(q('.spreadsheet-view__truncated')).toBeNull();
});

// ── 终端状态灯组（§2.5，v1.1） ──

function mkLightTerm(id: string, state: string, over: Partial<TerminalFixture> = {}): TerminalFixture {
  return { id, state, cwd: `/p/${id}`, ...over } as TerminalFixture;
}
const LIGHT_TERMS = [
  mkLightTerm('t1', 'Running'),
  mkLightTerm('t2', 'WaitingInput', { customName: '审查' }),
  mkLightTerm('t3', 'Stopped'),
];

test('灯组：三灯渲染，三色修饰类各就位，owner（t1）琥珀外环类', async () => {
  await render(view({ lights: buildTerminalLights(LIGHT_TERMS, 't1', 't1') }));
  const lights = qa('.file-tabs-view__light');
  expect(lights).toHaveLength(3);
  expect(q('[data-term-light="t1"] .file-tabs-view__light-dot')?.className).toContain('--running');
  expect(q('[data-term-light="t2"] .file-tabs-view__light-dot')?.className).toContain('--waiting');
  expect(q('[data-term-light="t3"] .file-tabs-view__light-dot')?.className).toContain('--idle');
  expect(q('[data-term-light="t1"] .file-tabs-view__light-dot')?.className).toContain('--owner');
  expect(q('[data-term-light="t2"] .file-tabs-view__light-dot')?.className).not.toContain('--owner');
});

test('灯组：displayed≠owner 时指示条与外环分落两灯（两个独立维度）', async () => {
  await render(view({ lights: buildTerminalLights(LIGHT_TERMS, 't1', 't2') }));
  expect(q('[data-term-light="t2"]')?.className).toContain('--current');
  expect(q('[data-term-light="t1"]')?.className).not.toContain('--current');
  expect(q('[data-term-light="t1"] .file-tabs-view__light-dot')?.className).toContain('--owner');
});

test('灯组：单终端或不传 lights → 灯组整体不渲染（无可切对象）', async () => {
  await render(view({ lights: buildTerminalLights([mkLightTerm('t1', 'Running')], 't1', 't1') }));
  expect(q('.file-tabs-view__lights')).toBeNull();
  await render(view());
  expect(q('.file-tabs-view__lights')).toBeNull();
});

test('灯组：点灯回调收到终端 id；未传 onSelectTerminal 时 click 无事发生（inert）', async () => {
  const onSelectTerminal = vi.fn();
  await render(view({ lights: buildTerminalLights(LIGHT_TERMS, 't1', 't1'), onSelectTerminal }));
  await click(q('[data-term-light="t2"]'));
  expect(onSelectTerminal).toHaveBeenCalledTimes(1);
  expect(onSelectTerminal).toHaveBeenCalledWith('t2');
  await render(view({ lights: buildTerminalLights(LIGHT_TERMS, 't1', 't1') }));
  await click(q('[data-term-light="t2"]')); // 不抛即 inert
});

test('洞 data-term-id：传 displayedTerminalId 时=displayed，缺省=source（真洞与占位双分支）', async () => {
  await render(view({ activeId: TERMINAL_TAB_ID, displayedTerminalId: 't2' }));
  expect(q('.tile-term-hole')?.getAttribute('data-term-id')).toBe('t2');
  await render(view({ activeId: TERMINAL_TAB_ID }));
  expect(q('.tile-term-hole')?.getAttribute('data-term-id')).toBe('t1');
  await render(view({ activeId: TERMINAL_TAB_ID, renderHole: false, displayedTerminalId: 't2' }));
  expect(q('.file-tabs-view__term-placeholder')?.getAttribute('data-term-id')).toBe('t2');
});

test('终端 tab 名跟随 displayedTerminalLabel；左栏头恒显 owner 的 terminalLabel', async () => {
  await render(view({ displayedTerminalLabel: '审查' }));
  expect(q('.file-tabs-view__tab--terminal .file-tabs-view__tab-name')?.textContent).toBe('审查');
  expect(q('.file-tabs-view__left-title')?.textContent).toBe('muxvo');
});

test('灯 title 锚（HoverTip 工艺）：「名 · 状态」，owner 含「文件所属」，dead 族「已停止」', async () => {
  await render(view({ lights: buildTerminalLights(LIGHT_TERMS, 't1', 't1') }));
  expect(q('[data-term-light="t1"]')?.getAttribute('title')).toBe('t1 · 运行中 · 文件所属');
  expect(q('[data-term-light="t2"]')?.getAttribute('title')).toBe('审查 · 等待输入');
  expect(q('[data-term-light="t3"]')?.getAttribute('title')).toBe('t3 · 已停止');
});
