// M6 批B tab 式文件视图：状态机 reducer 纯函数直测（specs/behavior/file-tabs-view.md §2/§3/§4）。
// 描述性 test 名（非 spec 锚定；FILE_L1_ spec 翻牌归批2）。node 环境（reducer 无 DOM 依赖）。
import { expect, test } from 'vitest';
import {
  fileTabsReducer,
  fileTypeOf,
  TERMINAL_TAB_ID,
  type FileTab,
  type FileTabsState,
} from '../src/screen/filetabs/fileTabsReducer';

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

function enter(): FileTabsState {
  const s = fileTabsReducer(null, { t: 'enter', sourceTerminalId: 't1' });
  if (!s) throw new Error('enter 应返回非 null');
  return s;
}

/** 直接构造多 tab 状态（活跃 = activeId） */
function withTabs(tabs: FileTab[], activeId: string, dialog: FileTabsState['dialog'] = null): FileTabsState {
  return { sourceTerminalId: 't1', displayedTerminalId: 't1', activeId, tabs, dialog };
}

// ── 进入/退出（§0） ──

test('enter：null → 初始态（首位终端 tab 活跃、tabs 空、dialog 空）', () => {
  const s = enter();
  expect(s).toEqual({
    sourceTerminalId: 't1',
    displayedTerminalId: 't1',
    activeId: TERMINAL_TAB_ID,
    tabs: [],
    dialog: null,
  });
});

test('enter：视图已开时 no-op（不重置已有 tab 集合，返回同引用）', () => {
  const s = withTabs([mkTab('/p/a.ts')], '/p/a.ts');
  expect(fileTabsReducer(s, { t: 'enter', sourceTerminalId: 't9' })).toBe(s);
});

test('exit：→ null（视图关）', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts');
  expect(fileTabsReducer(s, { t: 'exit' })).toBeNull();
});

test('非 enter 动作作用于 null → 保持 null', () => {
  expect(fileTabsReducer(null, { t: 'openFile', path: '/p/a.ts', name: 'a.ts', fileType: 'code' })).toBeNull();
  expect(fileTabsReducer(null, { t: 'activate', id: TERMINAL_TAB_ID })).toBeNull();
});

// ── 打开/去重/聚焦（§2） ──

test('openFile：未开 → 尾插 loading tab 并聚焦', () => {
  const s = enter();
  const next = fileTabsReducer(s, { t: 'openFile', path: '/p/a.ts', name: 'a.ts', fileType: 'code' })!;
  expect(next.tabs).toHaveLength(1);
  expect(next.tabs[0]).toMatchObject({ path: '/p/a.ts', name: 'a.ts', fileType: 'code', dirtyValue: null, mdSource: false, saving: false, saveError: null });
  expect(next.tabs[0].load).toEqual({ k: 'loading' });
  expect(next.activeId).toBe('/p/a.ts');
});

test('openFile：多次打开按尾插序追加', () => {
  let s = enter();
  s = fileTabsReducer(s, { t: 'openFile', path: '/p/a.ts', name: 'a.ts', fileType: 'code' })!;
  s = fileTabsReducer(s, { t: 'openFile', path: '/p/b.md', name: 'b.md', fileType: 'markdown' })!;
  expect(s.tabs.map((t) => t.path)).toEqual(['/p/a.ts', '/p/b.md']);
  expect(s.activeId).toBe('/p/b.md');
});

test('openFile：已开该 path → 仅聚焦（按 path 去重，不重复插入）', () => {
  let s = enter();
  s = fileTabsReducer(s, { t: 'openFile', path: '/p/a.ts', name: 'a.ts', fileType: 'code' })!;
  s = fileTabsReducer(s, { t: 'openFile', path: '/p/b.md', name: 'b.md', fileType: 'markdown' })!;
  const before = s.tabs;
  s = fileTabsReducer(s, { t: 'openFile', path: '/p/a.ts', name: 'a.ts', fileType: 'code' })!;
  expect(s.tabs).toHaveLength(2); // 未重复插入
  expect(s.tabs).toBe(before); // tab 数组未变（仅切焦）
  expect(s.activeId).toBe('/p/a.ts');
});

test('openFile：dialog!=null（模态期）屏蔽', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'closeConfirm', path: '/p/a.ts' });
  expect(fileTabsReducer(s, { t: 'openFile', path: '/p/b.md', name: 'b.md', fileType: 'markdown' })).toBe(s);
});

// ── 载入回填（§2） ──

test('fileLoaded：命中 tab → load 转 loaded', () => {
  let s = enter();
  s = fileTabsReducer(s, { t: 'openFile', path: '/p/a.ts', name: 'a.ts', fileType: 'code' })!;
  s = fileTabsReducer(s, { t: 'fileLoaded', path: '/p/a.ts', content: 'hi', encoding: 'utf8', truncated: false, mtimeMs: 42 })!;
  expect(s.tabs[0].load).toEqual({ k: 'loaded', content: 'hi', encoding: 'utf8', truncated: false, mtimeMs: 42 });
});

test('fileLoaded：path 已不在 tabs → no-op（异步竞态防护）', () => {
  const s = withTabs([mkTab('/p/a.ts')], '/p/a.ts');
  expect(fileTabsReducer(s, { t: 'fileLoaded', path: '/p/gone.ts', content: 'x', encoding: 'utf8', truncated: false, mtimeMs: 1 })).toBe(s);
});

test('fileLoadFailed：命中 tab → load 转 error', () => {
  let s = enter();
  s = fileTabsReducer(s, { t: 'openFile', path: '/p/a.ts', name: 'a.ts', fileType: 'code' })!;
  s = fileTabsReducer(s, { t: 'fileLoadFailed', path: '/p/a.ts', message: 'EACCES' })!;
  expect(s.tabs[0].load).toEqual({ k: 'error', message: 'EACCES' });
});

// ── 切换（§2） ──

test('activate：切焦到指定 id', () => {
  const s = withTabs([mkTab('/p/a.ts'), mkTab('/p/b.ts')], '/p/a.ts');
  expect(fileTabsReducer(s, { t: 'activate', id: '/p/b.ts' })!.activeId).toBe('/p/b.ts');
  expect(fileTabsReducer(s, { t: 'activate', id: TERMINAL_TAB_ID })!.activeId).toBe(TERMINAL_TAB_ID);
});

test('activate：dialog!=null 屏蔽', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'closeConfirm', path: '/p/a.ts' });
  expect(fileTabsReducer(s, { t: 'activate', id: TERMINAL_TAB_ID })).toBe(s);
});

// ── 关闭 + 聚焦迁移（§2 / D1） ──

test('requestClose：非 dirty → 直接关并迁移聚焦（等价 closeTab）', () => {
  const s = withTabs([mkTab('/p/a.ts'), mkTab('/p/b.ts')], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'requestClose', path: '/p/a.ts' })!;
  expect(next.tabs.map((t) => t.path)).toEqual(['/p/b.ts']);
  expect(next.activeId).toBe('/p/b.ts'); // 右邻
  expect(next.dialog).toBeNull();
});

test('requestClose：dirty tab → 弹 closeConfirm（不立即移除）', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'requestClose', path: '/p/a.ts' })!;
  expect(next.tabs).toHaveLength(1); // 未移除
  expect(next.dialog).toEqual({ k: 'closeConfirm', path: '/p/a.ts' });
});

test('requestClose：dialog!=null 屏蔽', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'conflict', path: '/p/a.ts' });
  expect(fileTabsReducer(s, { t: 'requestClose', path: '/p/a.ts' })).toBe(s);
});

test('closeTab：关活跃 tab → 聚焦右邻', () => {
  const s = withTabs([mkTab('/p/a.ts'), mkTab('/p/b.ts'), mkTab('/p/c.ts')], '/p/b.ts');
  const next = fileTabsReducer(s, { t: 'closeTab', path: '/p/b.ts' })!;
  expect(next.tabs.map((t) => t.path)).toEqual(['/p/a.ts', '/p/c.ts']);
  expect(next.activeId).toBe('/p/c.ts');
});

test('closeTab：无右邻 → 聚焦左邻', () => {
  const s = withTabs([mkTab('/p/a.ts'), mkTab('/p/b.ts')], '/p/b.ts');
  const next = fileTabsReducer(s, { t: 'closeTab', path: '/p/b.ts' })!;
  expect(next.activeId).toBe('/p/a.ts');
});

test('closeTab：关最后一个文件 tab → 聚焦终端 tab，视图保持（D1，绝不退出）', () => {
  const s = withTabs([mkTab('/p/a.ts')], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'closeTab', path: '/p/a.ts' });
  expect(next).not.toBeNull();
  expect(next!.tabs).toHaveLength(0);
  expect(next!.activeId).toBe(TERMINAL_TAB_ID);
});

test('closeTab：关非活跃 tab → 活跃 tab 不变', () => {
  const s = withTabs([mkTab('/p/a.ts'), mkTab('/p/b.ts')], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'closeTab', path: '/p/b.ts' })!;
  expect(next.activeId).toBe('/p/a.ts');
  expect(next.tabs.map((t) => t.path)).toEqual(['/p/a.ts']);
});

test('closeTab：清除指向该 path 的 closeConfirm/conflict 对话框', () => {
  const closeC = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'closeConfirm', path: '/p/a.ts' });
  expect(fileTabsReducer(closeC, { t: 'closeTab', path: '/p/a.ts' })!.dialog).toBeNull();
  const conflict = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'conflict', path: '/p/a.ts' });
  expect(fileTabsReducer(conflict, { t: 'closeTab', path: '/p/a.ts' })!.dialog).toBeNull();
});

// ── 编辑 / dirty（§3） ──

test('edit：更新 dirtyValue', () => {
  const s = withTabs([mkTab('/p/a.ts', { load: loaded('hello') })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'edit', path: '/p/a.ts', value: 'hi' })!;
  expect(next.tabs[0].dirtyValue).toBe('hi');
});

test('edit：恢复原文（value===load.content）→ dirtyValue 清 null', () => {
  const s = withTabs([mkTab('/p/a.ts', { load: loaded('hello'), dirtyValue: 'hi' })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'edit', path: '/p/a.ts', value: 'hello' })!;
  expect(next.tabs[0].dirtyValue).toBeNull();
});

test('edit：清除 saveError', () => {
  const s = withTabs([mkTab('/p/a.ts', { load: loaded('hello'), saveError: 'boom' })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'edit', path: '/p/a.ts', value: 'hi' })!;
  expect(next.tabs[0].saveError).toBeNull();
});

test('toggleMdSource：翻转 mdSource', () => {
  const s = withTabs([mkTab('/p/a.md', { fileType: 'markdown' })], '/p/a.md');
  const on = fileTabsReducer(s, { t: 'toggleMdSource', path: '/p/a.md' })!;
  expect(on.tabs[0].mdSource).toBe(true);
  const off = fileTabsReducer(on, { t: 'toggleMdSource', path: '/p/a.md' })!;
  expect(off.tabs[0].mdSource).toBe(false);
});

// ── 保存（§3 / ⌘S / D3） ──

test('saveStarted：saving=true', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'v1' })], '/p/a.ts');
  expect(fileTabsReducer(s, { t: 'saveStarted', path: '/p/a.ts' })!.tabs[0].saving).toBe(true);
});

test('saveOk：saving=false、content/mtime 更新、dirtyValue===savedValue 时清 dirty', () => {
  const s = withTabs([mkTab('/p/a.ts', { load: loaded('old'), dirtyValue: 'v1', saving: true })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'saveOk', path: '/p/a.ts', mtimeMs: 99, savedValue: 'v1' })!;
  expect(next.tabs[0].saving).toBe(false);
  expect(next.tabs[0].dirtyValue).toBeNull();
  expect(next.tabs[0].load).toEqual({ k: 'loaded', content: 'v1', encoding: 'utf8', truncated: false, mtimeMs: 99 });
});

test('saveOk：陈值守卫——保存期继续键入（dirtyValue≠savedValue）不误清 dirty', () => {
  const s = withTabs([mkTab('/p/a.ts', { load: loaded('old'), dirtyValue: 'v2', saving: true })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'saveOk', path: '/p/a.ts', mtimeMs: 99, savedValue: 'v1' })!;
  expect(next.tabs[0].dirtyValue).toBe('v2'); // 保留最新键入
  expect(next.tabs[0].load).toMatchObject({ content: 'v1', mtimeMs: 99 });
});

test('saveOk：清除指向该 path 的 conflict 对话框（覆盖成功）', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'v1' })], '/p/a.ts', { k: 'conflict', path: '/p/a.ts' });
  const next = fileTabsReducer(s, { t: 'saveOk', path: '/p/a.ts', mtimeMs: 5, savedValue: 'v1' })!;
  expect(next.dialog).toBeNull();
});

test('saveFailed：saving=false + saveError 置文案', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'v1', saving: true })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'saveFailed', path: '/p/a.ts', message: 'ENOSPC' })!;
  expect(next.tabs[0]).toMatchObject({ saving: false, saveError: 'ENOSPC' });
});

test('saveConflict：saving=false + 弹 conflict 对话框（mtime 冲突，D3）', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'v1', saving: true })], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'saveConflict', path: '/p/a.ts' })!;
  expect(next.tabs[0].saving).toBe(false);
  expect(next.dialog).toEqual({ k: 'conflict', path: '/p/a.ts' });
});

// ── 退出汇总（§4 / D2） ──

test('requestExit：无 dirty tab → 退出视图（null）', () => {
  const s = withTabs([mkTab('/p/a.ts'), mkTab('/p/b.ts')], '/p/a.ts');
  expect(fileTabsReducer(s, { t: 'requestExit' })).toBeNull();
});

test('requestExit：存在 dirty → exitSummary 列出全部 dirty（按 tab 序）', () => {
  const s = withTabs(
    [mkTab('/p/a.ts', { dirtyValue: 'x' }), mkTab('/p/b.ts'), mkTab('/p/c.ts', { dirtyValue: 'y' })],
    '/p/a.ts',
  );
  const next = fileTabsReducer(s, { t: 'requestExit' })!;
  expect(next.dialog).toEqual({ k: 'exitSummary', paths: ['/p/a.ts', '/p/c.ts'] });
  expect(next.tabs).toHaveLength(3); // 未退出
});

test('requestExit：dialog!=null 屏蔽', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'exitSummary', paths: ['/p/a.ts'] });
  expect(fileTabsReducer(s, { t: 'requestExit' })).toBe(s);
});

test('cancelDialog：清 dialog（保持视图与 tab 集合）', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'closeConfirm', path: '/p/a.ts' });
  const next = fileTabsReducer(s, { t: 'cancelDialog' })!;
  expect(next.dialog).toBeNull();
  expect(next.tabs).toHaveLength(1);
});

// ── 不可变性 ──

test('纯函数：不改入参（tabs 数组与 tab 对象均不被就地修改）', () => {
  const tab = mkTab('/p/a.ts', { load: loaded('hello') });
  const s = withTabs([tab], '/p/a.ts');
  const snapshot = JSON.parse(JSON.stringify(s));
  fileTabsReducer(s, { t: 'edit', path: '/p/a.ts', value: 'changed' });
  fileTabsReducer(s, { t: 'openFile', path: '/p/b.ts', name: 'b.ts', fileType: 'code' });
  fileTabsReducer(s, { t: 'closeTab', path: '/p/a.ts' });
  expect(s).toEqual(snapshot); // 原状态逐字段不变
});

// ── fileTypeOf 判型（§3 表） ──

test('fileTypeOf：扩展名判型（md/图片/表格/pdf/代码/文本）', () => {
  expect(fileTypeOf('/p/readme.md')).toBe('markdown');
  expect(fileTypeOf('/p/a.markdown')).toBe('markdown');
  expect(fileTypeOf('/p/logo.PNG')).toBe('image'); // 大小写无关
  expect(fileTypeOf('/p/pic.jpeg')).toBe('image');
  expect(fileTypeOf('/p/icon.svg')).toBe('image');
  expect(fileTypeOf('/p/data.xlsx')).toBe('spreadsheet');
  expect(fileTypeOf('/p/data.xls')).toBe('spreadsheet');
  expect(fileTypeOf('/p/data.csv')).toBe('text'); // csv 归 text（契约）
  expect(fileTypeOf('/p/doc.pdf')).toBe('pdf');
  expect(fileTypeOf('/p/main.ts')).toBe('code');
  expect(fileTypeOf('/p/mod.rs')).toBe('code');
  expect(fileTypeOf('/p/notes.txt')).toBe('text');
  expect(fileTypeOf('/p/LICENSE')).toBe('text'); // 无扩展名
  expect(fileTypeOf('/p/.env')).toBe('text'); // 点头文件（无扩展名）
});

// ── 终端状态灯与洞内显示切换（§2.5，v1.1） ──

test('enter：displayedTerminalId 初始 = sourceTerminalId', () => {
  const s = enter();
  expect(s.displayedTerminalId).toBe(s.sourceTerminalId);
});

test('showTerminal：切换 displayed 并自动激活终端 tab（文件 tab 活跃时点灯即跳终端 tab）', () => {
  const s = withTabs([mkTab('/p/a.ts')], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'showTerminal', id: 't2' })!;
  expect(next.displayedTerminalId).toBe('t2');
  expect(next.activeId).toBe(TERMINAL_TAB_ID);
  expect(next.sourceTerminalId).toBe('t1'); // owner 不变
});

test('showTerminal：同 id 且终端 tab 已活跃 → no-op 返回原引用', () => {
  const s = withTabs([mkTab('/p/a.ts')], TERMINAL_TAB_ID);
  expect(fileTabsReducer(s, { t: 'showTerminal', id: 't1' })).toBe(s);
});

test('showTerminal：同 id 但文件 tab 活跃 → 仍激活终端 tab', () => {
  const s = withTabs([mkTab('/p/a.ts')], '/p/a.ts');
  const next = fileTabsReducer(s, { t: 'showTerminal', id: 't1' })!;
  expect(next.activeId).toBe(TERMINAL_TAB_ID);
});

test('showTerminal：dialog 模态期屏蔽（activate 同门）', () => {
  const s = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'closeConfirm', path: '/p/a.ts' });
  expect(fileTabsReducer(s, { t: 'showTerminal', id: 't2' })).toBe(s);
});

test('setDisplayed：只改 displayed，activeId（文件 tab）不被夺焦', () => {
  const s = { ...withTabs([mkTab('/p/a.ts')], '/p/a.ts'), displayedTerminalId: 't2' };
  const next = fileTabsReducer(s, { t: 'setDisplayed', id: 't1' })!;
  expect(next.displayedTerminalId).toBe('t1');
  expect(next.activeId).toBe('/p/a.ts');
});

test('setDisplayed：dialog 模态期放行（模态期终端可死，state 须能归位）；同 id no-op 引用相等', () => {
  const dlg = withTabs([mkTab('/p/a.ts', { dirtyValue: 'x' })], '/p/a.ts', { k: 'closeConfirm', path: '/p/a.ts' });
  const s = { ...dlg, displayedTerminalId: 't2' };
  const next = fileTabsReducer(s, { t: 'setDisplayed', id: 't1' })!;
  expect(next.displayedTerminalId).toBe('t1');
  expect(next.dialog).toEqual(dlg.dialog);
  expect(fileTabsReducer(next, { t: 'setDisplayed', id: 't1' })).toBe(next);
});

test('exit → null；重 enter displayed 重置回新 source', () => {
  const s = { ...withTabs([], TERMINAL_TAB_ID), displayedTerminalId: 't2' };
  const closed = fileTabsReducer(s, { t: 'exit' });
  expect(closed).toBeNull();
  const reopened = fileTabsReducer(closed, { t: 'enter', sourceTerminalId: 't3' })!;
  expect(reopened.displayedTerminalId).toBe('t3');
});

test('activate(TERMINAL_TAB_ID)：不改 displayed（回归：切 tab 不切洞）', () => {
  const s = { ...withTabs([mkTab('/p/a.ts')], '/p/a.ts'), displayedTerminalId: 't2' };
  const next = fileTabsReducer(s, { t: 'activate', id: TERMINAL_TAB_ID })!;
  expect(next.displayedTerminalId).toBe('t2');
});
