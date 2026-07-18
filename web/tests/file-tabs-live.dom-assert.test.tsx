// @vitest-environment jsdom
//
// M6 批B tab 式文件视图 live 接线（真实 live 宿主 TerminalScreen → LiveInteractionLayer）：
//   面板点文件行→视图接管网格区(children 卸载)+fileClose 已发；readFile 载荷(image 走 base64)→内容上屏；
//   编辑→⌘S→writeFile{content,baseMtimeMs}→dirty 点消失；MTIME_CONFLICT→冲突对话框→覆盖重发无 baseMtimeMs；
//   ✕ 关 dirty tab→三键对话框→保存后关；Esc 链(关 dialog / 无 dialog 有 dirty→exitSummary / 全部丢弃回平铺)；
//   终端 tab 激活→真洞；来源终端消失→自动退出；视图内 ⌘E no-op + native 开面板被兜底 fileClose。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TerminalScreen } from '../src/screen/TerminalScreen';
import type { FsRequest, FsResponse, UIAction } from '../src/bridge/gen/protocol';
import type { Fixture } from '../src/fixture/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'ft-live',
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
    quitConfirm: null,
    palette: { background: '#1e1e1e', foreground: '#cccccc' },
    terminals: [{ id: 't1', state: 'Running', cwd: '/proj' }],
    filePanel: { terminalId: 't1' },
    ...over,
  } as Fixture;
}

const DIRS: Record<string, FsResponse> = {
  '/proj': {
    kind: 'dir',
    entries: [
      { name: 'a.ts', isDirectory: false, size: 10 },
      { name: 'b.md', isDirectory: false, size: 20 },
      { name: 'pic.png', isDirectory: false, size: 30 },
    ],
  },
};

interface FileStub {
  content: string;
  encoding?: 'utf8' | 'base64';
  mtimeMs: number;
  truncated?: boolean;
}
interface FsCfg {
  dirs?: Record<string, FsResponse>;
  files?: Record<string, FileStub>;
  readReject?: Record<string, { code: string; message: string }>;
  writeHandler?: (req: Extract<FsRequest, { kind: 'writeFile' }>) => FsResponse;
}
const FILES: Record<string, FileStub> = {
  '/proj/a.ts': { content: 'hello ts', mtimeMs: 100 },
  '/proj/b.md': { content: '# Title', mtimeMs: 200 },
  '/proj/pic.png': { content: 'BASE64PNG', encoding: 'base64', mtimeMs: 300 },
};

function makeFs(cfg: FsCfg = {}): ReturnType<typeof vi.fn> {
  const dirs = cfg.dirs ?? DIRS;
  const files = cfg.files ?? FILES;
  return vi.fn(async (req: FsRequest): Promise<FsResponse> => {
    if (req.kind === 'readDir') return dirs[req.path] ?? { kind: 'dir', entries: [] };
    if (req.kind === 'readFile') {
      const rej = cfg.readReject?.[req.path];
      if (rej) return { kind: 'rejected', code: rej.code, message: rej.message };
      const f = files[req.path];
      if (f)
        return {
          kind: 'fileContent',
          content: f.content,
          encoding: f.encoding ?? 'utf8',
          truncated: f.truncated,
          mtimeMs: f.mtimeMs,
        };
      return { kind: 'rejected', code: 'NOT_FOUND', message: '文件不存在' };
    }
    if (req.kind === 'writeFile')
      return cfg.writeHandler ? cfg.writeHandler(req) : { kind: 'fileWritten', mtimeMs: 999 };
    if (req.kind === 'showFileMenu') return { kind: 'menuAction', action: 'dismissed' };
    return { kind: 'rejected', code: 'internal', message: 'unexpected' };
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let curOnAction: (a: UIAction) => void = () => {};
let curFs: (r: FsRequest) => Promise<FsResponse> = async () => ({ kind: 'rejected', code: 'x', message: 'x' });

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

async function mount(fx: Fixture, onAction: (a: UIAction) => void, fs: typeof curFs): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  curOnAction = onAction;
  curFs = fs;
  await act(async () => {
    root!.render(
      createElement(TerminalScreen, {
        fx,
        onAction,
        onTermCommand: vi.fn(),
        onFsRequest: fs as never,
      }),
    );
  });
  await flush();
}

/** 重渲染（同一 root → 保 useReducer 状态；模拟 native 推新快照，如 fileClose 后 filePanel 清空）。 */
async function rerender(fx: Fixture): Promise<void> {
  await act(async () => {
    root!.render(
      createElement(TerminalScreen, {
        fx,
        onAction: curOnAction,
        onTermCommand: vi.fn(),
        onFsRequest: curFs as never,
      }),
    );
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
  document.body.className = '';
});

const q = (sel: string): Element | null => document.querySelector(sel);
const qa = (sel: string): Element[] => Array.from(document.querySelectorAll(sel));
function rowIn(scope: string, name: string): HTMLElement {
  const el = Array.from(document.querySelectorAll<HTMLElement>(`${scope} .file-item`)).find(
    (r) => r.querySelector('.file-item__name')?.textContent === name,
  );
  expect(el, `找不到行 ${name} @ ${scope}`).toBeDefined();
  return el!;
}
function actionsOf(onAction: ReturnType<typeof vi.fn>, kind: string): UIAction[] {
  return onAction.mock.calls.map((c) => c[0]).filter((a) => a?.kind === kind);
}
function writeCalls(fs: ReturnType<typeof vi.fn>): Extract<FsRequest, { kind: 'writeFile' }>[] {
  return fs.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'writeFile');
}
function readFileCalls(fs: ReturnType<typeof vi.fn>): Extract<FsRequest, { kind: 'readFile' }>[] {
  return fs.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'readFile');
}
async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
async function key(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}
/** 受控 textarea 键入（native value setter + input 事件，触发 React onChange）。 */
async function typeInto(ta: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** 面板点文件行进入视图，随后模拟 native 清 filePanel（rerender）。 */
async function enterViaPanel(name = 'a.ts'): Promise<void> {
  await click(rowIn('.file-panel', name));
  await flush();
  await rerender(fixture({ filePanel: undefined }));
  await flush();
}

describe('M6 批B tab 式文件视图 live', () => {
  test('① 面板点文件行 → 视图接管(children 卸载)+fileClose 已发+readFile 拉取', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    expect(q('.terminal-grid')).not.toBeNull(); // 进入前网格在
    expect(q('.file-panel')).not.toBeNull();

    await click(rowIn('.file-panel', 'a.ts'));
    await flush();

    expect(q('.file-tabs-view'), '视图挂载').not.toBeNull();
    expect(q('.terminal-grid'), 'children(网格) 卸载').toBeNull();
    expect(actionsOf(onAction, 'fileClose').length, '进入即关面板').toBeGreaterThanOrEqual(1);
    // readFile(a.ts) 已发（utf8，无 encoding）
    const rf = readFileCalls(fs).filter((r) => r.path === '/proj/a.ts');
    expect(rf.length).toBe(1);
    expect(rf[0].encoding).toBeUndefined();
  });

  test('② readFile 载荷(image 走 base64) + loaded 内容上屏', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    // a.ts loaded → textarea 值 = 内容
    const ta = q('.file-tabs-view__editor') as HTMLTextAreaElement | null;
    expect(ta?.value).toBe('hello ts');

    // 左树点 pic.png → image tab；readFile 请求带 encoding=base64
    await click(rowIn('.file-tabs-view__left-content', 'pic.png'));
    await flush();
    const rf = readFileCalls(fs).filter((r) => r.path === '/proj/pic.png');
    expect(rf.length).toBe(1);
    expect(rf[0].encoding).toBe('base64');
    // image 上屏 data-URI
    const img = q('.file-tabs-view__image img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,BASE64PNG');
  });

  test('③ 编辑 → ⌘S → writeFile{content,baseMtimeMs} + dirty 点消失', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');

    const ta = q('.file-tabs-view__editor') as HTMLTextAreaElement;
    await typeInto(ta, 'edited body');
    await flush(1);
    expect(q('.file-tabs-view__tab-dot'), '编辑后出现 dirty 点').not.toBeNull();

    await key({ key: 's', metaKey: true });
    await flush();
    const wc = writeCalls(fs);
    expect(wc.length).toBe(1);
    expect(wc[0].path).toBe('/proj/a.ts');
    expect(wc[0].content).toBe('edited body');
    expect(wc[0].baseMtimeMs).toBe(100); // 条件写用 loaded.mtimeMs
    expect(q('.file-tabs-view__tab-dot'), '保存后 dirty 点消失').toBeNull();
  });

  test('④ MTIME_CONFLICT → 冲突对话框 → 覆盖重发(无 baseMtimeMs)', async () => {
    const onAction = vi.fn();
    // 条件写(带 baseMtimeMs)→冲突；无条件写(覆盖)→成功
    const fs = makeFs({
      writeHandler: (req) =>
        req.baseMtimeMs != null
          ? { kind: 'rejected', code: 'MTIME_CONFLICT', message: '文件已被外部修改' }
          : { kind: 'fileWritten', mtimeMs: 777 },
    });
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');

    await typeInto(q('.file-tabs-view__editor') as HTMLTextAreaElement, 'conflicting');
    await flush(1);
    await key({ key: 's', metaKey: true });
    await flush();
    expect(q('.unsaved-prompt-dialog__title')?.textContent).toBe('文件已被外部修改');

    // 覆盖 → 第二次 writeFile 不带 baseMtimeMs
    await click(q('.unsaved-prompt-dialog__btn--save'));
    await flush();
    const wc = writeCalls(fs);
    expect(wc.length).toBe(2);
    expect(wc[0].baseMtimeMs).toBe(100);
    expect(wc[1].baseMtimeMs).toBeUndefined();
    expect(q('.unsaved-prompt-dialog'), '覆盖成功后冲突框关闭').toBeNull();
    expect(q('.file-tabs-view__tab-dot'), '覆盖后 dirty 清').toBeNull();
  });

  test('⑤ ✕ 关 dirty tab → 三键对话框「保存」→ writeFile 后 tab 关闭', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    await typeInto(q('.file-tabs-view__editor') as HTMLTextAreaElement, 'dirty edit');
    await flush(1);

    const fileTab = qa('.file-tabs-view__tabs > .file-tabs-view__tab')[1];
    await click(fileTab.querySelector('.file-tabs-view__tab-close'));
    await flush(1);
    expect(q('.unsaved-prompt-dialog__title')?.textContent).toBe('未保存的更改');

    await click(q('.unsaved-prompt-dialog__btn--save'));
    await flush();
    expect(writeCalls(fs).length).toBe(1);
    // tab 关闭 → 仅剩终端 tab
    expect(qa('.file-tabs-view__tabs > .file-tabs-view__tab').length).toBe(1);
    expect(q('.file-tabs-view__tab--terminal')).not.toBeNull();
  });

  test('⑥ Esc：dialog 开→关 dialog；无 dialog 有 dirty→exitSummary；全部丢弃→回平铺', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    await typeInto(q('.file-tabs-view__editor') as HTMLTextAreaElement, 'x');
    await flush(1);

    // ✕ 开 closeConfirm 对话框 → Esc 关 dialog（tab 仍在）
    const fileTab = qa('.file-tabs-view__tabs > .file-tabs-view__tab')[1];
    await click(fileTab.querySelector('.file-tabs-view__tab-close'));
    await flush(1);
    expect(q('.unsaved-prompt-dialog')).not.toBeNull();
    await key({ key: 'Escape' });
    await flush(1);
    expect(q('.unsaved-prompt-dialog'), 'Esc 关 dialog').toBeNull();
    expect(qa('.file-tabs-view__tabs > .file-tabs-view__tab').length, 'tab 未关').toBe(2);

    // 无 dialog + dirty → Esc → exitSummary
    await key({ key: 'Escape' });
    await flush(1);
    expect(q('.unsaved-prompt-dialog__title')?.textContent).toBe('1 个文件未保存');

    // 全部丢弃 → exit → 回平铺（children 复现）
    await click(q('.unsaved-prompt-dialog__btn--discard'));
    await flush(1);
    expect(q('.file-tabs-view'), '视图退出').toBeNull();
    expect(q('.terminal-grid'), '网格复现').not.toBeNull();
  });

  test('⑦ 终端 tab 激活 → 内容区真洞 div[data-term-id]', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    // 入视图默认活跃文件 tab；点终端 tab
    await click(q('.file-tabs-view__tab--terminal'));
    await flush(1);
    const hole = q('.file-tabs-view__content .tile-term-hole');
    expect(hole).not.toBeNull();
    expect(hole?.getAttribute('data-term-id')).toBe('t1');
    expect(hole?.getAttribute('data-term-role')).toBe('grid');
  });

  test('⑧ 来源终端从 fx 消失 → 视图自动退出', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    expect(q('.file-tabs-view')).not.toBeNull();
    // 来源终端 t1 从快照消失
    await rerender(fixture({ filePanel: undefined, terminals: [], selectedId: null }));
    await flush(1);
    expect(q('.file-tabs-view'), '来源终端消失→自动退出').toBeNull();
  });

  test('⑨ 视图内 ⌘E no-op + native 开面板被兜底 fileClose', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    onAction.mockClear();

    // 视图内 ⌘E → no-op（不发 fileOpen/fileClose）
    await key({ key: 'e', metaKey: true });
    await flush(1);
    expect(actionsOf(onAction, 'fileOpen').length).toBe(0);
    expect(actionsOf(onAction, 'fileClose').length).toBe(0);
    // ⌃E（emacs 键）同样不触发
    await key({ key: 'e', ctrlKey: true });
    await flush(1);
    expect(actionsOf(onAction, 'fileOpen').length).toBe(0);

    // native ⌘E 置 fx.filePanel（视图仍开）→ 互斥兜底闸发 fileClose
    onAction.mockClear();
    await rerender(fixture({ filePanel: { terminalId: 't1' } }));
    await flush(1);
    expect(actionsOf(onAction, 'fileClose').length, 'native 开面板被兜底关').toBeGreaterThanOrEqual(1);
    expect(q('.file-panel'), '视图开期不并存文件面板').toBeNull();
  });

  test('⑩ markdown tab（dogfood-r3 问题7）：live 挂载出 .markdown-view 真渲染；Source 切换仍 textarea', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('b.md');
    await flush(); // 等 markdown/md-view 动态 import 落地（就绪前短暂 md-static fallback）

    const view = q('.file-tabs-view__md .markdown-view');
    expect(view, 'live 路径走共享真渲染 .markdown-view（非 md-static 的 .markdown-wysiwyg）').not.toBeNull();
    expect(view!.querySelector('h1')?.textContent).toBe('Title');
    expect(q('.markdown-wysiwyg'), '真渲染就绪后不再渲 md-static 容器').toBeNull();

    // ⌘/ 切 Source → 受控 textarea（编辑路径不变）
    await key({ key: '/', metaKey: true });
    await flush(1);
    expect((q('.file-tabs-view__editor') as HTMLTextAreaElement | null)?.value).toBe('# Title');
  });

  // ── dogfood-r4 问题1：file-tabs 右键接线（左树行 + 内容区）──
  // 真实右键序列：contextmenu 前先 mousedown（button 2）——项目失败案例教训（浮层点击测试必含 mousedown 前奏）。
  function menuCalls(fs: ReturnType<typeof vi.fn>): Extract<FsRequest, { kind: 'showFileMenu' }>[] {
    return fs.mock.calls.map((c) => c[0]).filter((r) => r?.kind === 'showFileMenu');
  }
  function fireRightClick(el: Element, init: MouseEventInit = {}): boolean {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, buttons: 2 }));
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...init });
    return el.dispatchEvent(ev); // false = 有 handler preventDefault（defaultPrevented）
  }

  test('⑪ 左树文件行右键 → 唯一 showFileMenu{isDirectory:false,x,y}；pending 防重入；defaultPrevented', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');

    const row = rowIn('.file-tabs-view__left-content', 'b.md');
    let dispatchRet = true;
    await act(async () => {
      dispatchRet = fireRightClick(row, { clientX: 30, clientY: 40 });
      // 立即二次右键（pending 未清）→ 防重入
      fireRightClick(row);
    });
    const menu = menuCalls(fs);
    expect(menu.length, 'pending 门只放行一条').toBe(1);
    expect(menu[0].path).toBe('/proj/b.md');
    expect(menu[0].isDirectory).toBe(false);
    expect(menu[0].x).toBe(30);
    expect(menu[0].y).toBe(40);
    expect(dispatchRet, 'contextmenu 被 preventDefault（dispatchEvent 返 false）').toBe(false);
  });

  test('⑫ 左树文件夹行右键 → showFileMenu{isDirectory:true}', async () => {
    const onAction = vi.fn();
    const fs = makeFs({
      dirs: {
        '/proj': {
          kind: 'dir',
          entries: [
            { name: 'a.ts', isDirectory: false, size: 10 },
            { name: 'sub', isDirectory: true },
          ],
        },
      },
    });
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');

    const folder = rowIn('.file-tabs-view__left-content', 'sub');
    await act(async () => {
      fireRightClick(folder, { clientX: 12, clientY: 34 });
    });
    const menu = menuCalls(fs);
    expect(menu.length).toBe(1);
    expect(menu[0].path).toBe('/proj/sub');
    expect(menu[0].isDirectory).toBe(true);
  });

  test('⑬ 打开图片 tab，内容区 img 右键 → showFileMenu{图片路径,isDirectory:false}', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    // 打开图片 tab（活跃）
    await click(rowIn('.file-tabs-view__left-content', 'pic.png'));
    await flush();
    const img = q('.file-tabs-view__image img');
    expect(img, 'image tab 上屏').not.toBeNull();
    await act(async () => {
      fireRightClick(img!, { clientX: 55, clientY: 66 });
    });
    const menu = menuCalls(fs);
    expect(menu.length).toBe(1);
    expect(menu[0].path).toBe('/proj/pic.png'); // 活跃文件 tab 路径，非左树某行
    expect(menu[0].isDirectory).toBe(false);
    expect(menu[0].x).toBe(55);
    expect(menu[0].y).toBe(66);
  });

  test('⑭ 打开文本 tab，textarea 右键 → 零 showFileMenu 且未 preventDefault（保系统编辑菜单）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts'); // code/text tab → 编辑器 textarea
    const ta = q('.file-tabs-view__editor');
    expect(ta, '文本编辑器在场').not.toBeNull();
    let dispatchRet = false;
    await act(async () => {
      dispatchRet = fireRightClick(ta!);
    });
    expect(menuCalls(fs).length, 'textarea 内右键不接管').toBe(0);
    expect(dispatchRet, 'defaultPrevented===false（放行系统剪切/复制/粘贴菜单）').toBe(true);
  });
});

// ── 终端状态灯组（§2.5，v1.1）：点灯切洞 + layoutReport 命门 + 归位/退出边界 ──

describe('file-tabs 终端状态灯组（§2.5）', () => {
  const TERMS2 = [
    { id: 't1', state: 'Running', cwd: '/proj' },
    { id: 't2', state: 'WaitingInput', cwd: '/other', customName: '审查' },
  ];
  /** 双终端场景进入视图（enterViaPanel 的 rerender 会重置 terminals，这里保持自定终端集） */
  async function enterWith(terminals: typeof TERMS2, name = 'a.ts'): Promise<void> {
    await click(rowIn('.file-panel', name));
    await flush();
    await rerender(fixture({ filePanel: undefined, terminals }));
    await flush();
  }

  test('⑮ 双终端进入 → 灯组在场；owner(t1) 环+指示条同灯（初始 displayed=source）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture({ terminals: TERMS2 }), onAction, fs as never);
    await enterWith(TERMS2);
    expect(qa('.file-tabs-view__light')).toHaveLength(2);
    expect(q('[data-term-light="t1"] .file-tabs-view__light-dot')?.className).toContain('--owner');
    expect(q('[data-term-light="t1"]')?.className).toContain('--current');
    expect(q('[data-term-light="t2"] .file-tabs-view__light-dot')?.className).not.toContain('--owner');
  });

  test('⑯ 点 t2 灯 → 洞 data-term-id=t2 + 终端 tab 活跃 + tab 名跟随 + 左栏头仍 owner；layoutReport rects 含 t2（key 重挂命门）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture({ terminals: TERMS2 }), onAction, fs as never);
    await enterWith(TERMS2);

    await click(q('[data-term-light="t2"]'));
    await flush();

    const hole = q('.tile-term-hole') as HTMLElement | null;
    expect(hole, '终端 tab 激活出洞').not.toBeNull();
    expect(hole!.dataset.termId).toBe('t2');
    expect(q('.file-tabs-view__tab--terminal')?.className).toContain('--active');
    expect(q('.file-tabs-view__tab--terminal .file-tabs-view__tab-name')?.textContent).toBe('审查');
    expect(q('.file-tabs-view__left-title')?.textContent, '左栏头恒 owner').toBe('proj');
    expect(q('[data-term-light="t2"]')?.className).toContain('--current');
    expect(q('[data-term-light="t1"]')?.className).not.toContain('--current');
    // layoutReport 命门：属性级变更零上报——靠洞 key 重挂触发 MutationObserver（childList）重采集
    const reports = actionsOf(onAction, 'layoutReport') as Array<{ rects: Array<{ terminalId: string; role: string }> }>;
    expect(reports.length).toBeGreaterThan(0);
    const last = reports[reports.length - 1];
    expect(last.rects.some((r) => r.terminalId === 't2' && r.role === 'grid')).toBe(true);
    expect(last.rects.some((r) => r.terminalId === 't1' && r.role === 'grid')).toBe(false);
  });

  test('⑰ 点灯后回切文件 tab，displayed(t2) 被关 → 归位 owner 且不夺文件 tab 焦点；灯组随之隐藏', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture({ terminals: TERMS2 }), onAction, fs as never);
    await enterWith(TERMS2);
    await click(q('[data-term-light="t2"]'));
    await flush();
    // 回文件 tab（a.ts）
    const fileTab = qa('.file-tabs-view__tabs .file-tabs-view__tab').find(
      (t) => !t.classList.contains('file-tabs-view__tab--terminal'),
    );
    await click(fileTab);
    await flush();
    // t2 被关（fx 只剩 owner）
    await rerender(fixture({ filePanel: undefined, terminals: [TERMS2[0]] }));
    await flush();
    expect(q('.file-tabs-view'), '视图保持（owner 仍在）').not.toBeNull();
    expect(q('.file-tabs-view__tab--terminal')?.className, '不夺焦：文件 tab 仍活跃').not.toContain('--active');
    expect(fileTab?.className).toContain('--active');
    expect(q('.file-tabs-view__tab--terminal .file-tabs-view__tab-name')?.textContent, '终端 tab 名归位 owner').toBe('proj');
    expect(q('.file-tabs-view__lights'), '单终端灯组隐藏').toBeNull();
  });

  test('⑱ displayed=t2 时 owner 被关 → 整体退出（归位不与退出竞争）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture({ terminals: TERMS2 }), onAction, fs as never);
    await enterWith(TERMS2);
    await click(q('[data-term-light="t2"]'));
    await flush();
    await rerender(fixture({ filePanel: undefined, terminals: [TERMS2[1]] }));
    await flush();
    expect(q('.file-tabs-view'), 'owner 消失 → 退出').toBeNull();
    expect(q('.terminal-grid'), '回网格').not.toBeNull();
  });

  test('⑲ 单终端 → 灯组缺席（默认 fixture 回归）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture(), onAction, fs as never);
    await enterViaPanel('a.ts');
    expect(q('.file-tabs-view')).not.toBeNull();
    expect(q('.file-tabs-view__lights')).toBeNull();
  });

  test('⑳ dialog 模态期点灯 → showTerminal 被屏蔽（displayed 不变、对话框仍在）', async () => {
    const onAction = vi.fn();
    const fs = makeFs();
    await mount(fixture({ terminals: TERMS2 }), onAction, fs as never);
    await enterWith(TERMS2);
    // a.ts 置 dirty → ✕ → closeConfirm 对话框
    const ta = q('.file-tabs-view__editor') as HTMLTextAreaElement;
    await typeInto(ta, 'dirty!');
    await click(q('.file-tabs-view__tab-close'));
    await flush();
    expect(q('.unsaved-prompt-dialog')).not.toBeNull();
    await click(q('[data-term-light="t2"]'));
    await flush();
    expect(q('.unsaved-prompt-dialog'), '对话框仍在').not.toBeNull();
    expect(q('[data-term-light="t2"]')?.className, 'displayed 未变').not.toContain('--current');
    expect(q('[data-term-light="t1"]')?.className).toContain('--current');
  });
});
