/**
 * tab 式文件视图状态机（specs/behavior/file-tabs-view.md §2/§3/§4）——纯函数，无副作用。
 * null = 视图关；非 null = 视图开（首位恒终端 tab，activeId 指向 TERMINAL_TAB_ID 或某文件 path）。
 *
 * 契约冻结（批1-b 按此接线）：tab 以 path 为身份（无独立 id 字段），activeId ∈ {TERMINAL_TAB_ID} ∪ {tab.path}。
 * dialog!=null（模态期）屏蔽 openFile/activate/requestClose/requestExit；save 系/edit/closeTab/cancel/exit 仍放行。
 */

export type FileType = 'markdown' | 'code' | 'text' | 'image' | 'spreadsheet' | 'pdf';

/** 首位终端 tab 的固定 id（不可关；activeId 命中即内容区渲染终端洞） */
export const TERMINAL_TAB_ID = '_terminal';

export type TabLoad =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'loaded'; content: string; encoding: 'utf8' | 'base64'; truncated: boolean; mtimeMs: number };

export interface FileTab {
  path: string;
  name: string;
  fileType: FileType;
  load: TabLoad;
  /** null = 未编辑（与磁盘一致）；非 null = 未保存草稿值（dirty） */
  dirtyValue: string | null;
  mdSource: boolean;
  saving: boolean;
  saveError: string | null;
}

export type FileTabsDialog =
  | { k: 'closeConfirm'; path: string }
  | { k: 'exitSummary'; paths: string[] }
  | { k: 'conflict'; path: string };

export interface FileTabsState {
  sourceTerminalId: string;
  /** 洞内当前显示的终端（§2.5 灯组）：enter 初始=sourceTerminalId；owner 语义（左树/读写/自动退出）仍全绑 sourceTerminalId */
  displayedTerminalId: string;
  activeId: string;
  tabs: FileTab[];
  dialog: FileTabsDialog | null;
}

export type FileTabsAction =
  | { t: 'enter'; sourceTerminalId: string }
  | { t: 'openFile'; path: string; name: string; fileType: FileType }
  | { t: 'fileLoaded'; path: string; content: string; encoding: 'utf8' | 'base64'; truncated: boolean; mtimeMs: number }
  | { t: 'fileLoadFailed'; path: string; message: string }
  | { t: 'activate'; id: string }
  | { t: 'showTerminal'; id: string }
  | { t: 'setDisplayed'; id: string }
  | { t: 'requestClose'; path: string }
  | { t: 'closeTab'; path: string }
  | { t: 'edit'; path: string; value: string }
  | { t: 'toggleMdSource'; path: string }
  | { t: 'saveStarted'; path: string }
  | { t: 'saveOk'; path: string; mtimeMs: number; savedValue: string }
  | { t: 'saveFailed'; path: string; message: string }
  | { t: 'saveConflict'; path: string }
  | { t: 'requestExit' }
  | { t: 'cancelDialog' }
  | { t: 'exit' };

const CODE_EXTS = new Set<string>([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'json', 'py', 'rs', 'go', 'java', 'c', 'h',
  'cpp', 'cc', 'cxx', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'sh', 'bash', 'zsh',
  'fish', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml',
  'vue', 'svelte', 'sql', 'lua', 'vim', 'pl', 'pm', 'r', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj',
  'ml', 'fs', 'jl', 'nim', 'zig', 'proto', 'gradle', 'groovy', 'graphql', 'gql', 'tf',
]);

const IMAGE_EXTS = new Set<string>(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);

/** 扩展名判型（§3 表）：md/markdown→markdown；图片→image；xlsx/xls→spreadsheet（csv 归 text）；pdf→pdf；常见代码扩展→code；其余→text */
export function fileTypeOf(path: string): FileType {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'xlsx' || ext === 'xls') return 'spreadsheet';
  if (ext === 'pdf') return 'pdf';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'text';
}

function findTab(tabs: FileTab[], path: string): FileTab | undefined {
  return tabs.find((t) => t.path === path);
}

/** tab.path 处替换为投影结果（不存在则原样返回，引用不变） */
function patchTab(tabs: FileTab[], path: string, patch: (t: FileTab) => FileTab): FileTab[] {
  let hit = false;
  const next = tabs.map((t) => {
    if (t.path !== path) return t;
    hit = true;
    return patch(t);
  });
  return hit ? next : tabs;
}

/** 关 tab 后的聚焦迁移：仅当被关的是活跃 tab 才迁移——右邻→左邻→终端 tab（§2/D1） */
function activeAfterClose(tabs: FileTab[], closedPath: string, activeId: string): string {
  if (activeId !== closedPath) return activeId;
  const idx = tabs.findIndex((t) => t.path === closedPath);
  const right = tabs[idx + 1];
  if (right) return right.path;
  const left = tabs[idx - 1];
  if (left) return left.path;
  return TERMINAL_TAB_ID;
}

export function fileTabsReducer(state: FileTabsState | null, action: FileTabsAction): FileTabsState | null {
  // enter 是唯一能从 null 起态的动作
  if (state === null) {
    if (action.t === 'enter') {
      return {
        sourceTerminalId: action.sourceTerminalId,
        displayedTerminalId: action.sourceTerminalId,
        activeId: TERMINAL_TAB_ID,
        tabs: [],
        dialog: null,
      };
    }
    return null;
  }

  switch (action.t) {
    case 'enter':
      // 视图已开：enter no-op（不重置已有 tab 集合）
      return state;

    case 'openFile': {
      if (state.dialog !== null) return state; // 模态期屏蔽
      const existing = findTab(state.tabs, action.path);
      if (existing) {
        // 去重聚焦：已开该 path 仅切焦，不重复插入
        return state.activeId === action.path ? state : { ...state, activeId: action.path };
      }
      const tab: FileTab = {
        path: action.path,
        name: action.name,
        fileType: action.fileType,
        load: { k: 'loading' },
        dirtyValue: null,
        mdSource: false,
        saving: false,
        saveError: null,
      };
      // 尾插并聚焦
      return { ...state, tabs: [...state.tabs, tab], activeId: action.path };
    }

    case 'fileLoaded': {
      if (!findTab(state.tabs, action.path)) return state; // path 已不在 tabs → no-op
      const tabs = patchTab(state.tabs, action.path, (t) => ({
        ...t,
        load: {
          k: 'loaded',
          content: action.content,
          encoding: action.encoding,
          truncated: action.truncated,
          mtimeMs: action.mtimeMs,
        },
      }));
      return { ...state, tabs };
    }

    case 'fileLoadFailed': {
      if (!findTab(state.tabs, action.path)) return state;
      const tabs = patchTab(state.tabs, action.path, (t) => ({ ...t, load: { k: 'error', message: action.message } }));
      return { ...state, tabs };
    }

    case 'activate':
      if (state.dialog !== null) return state;
      return state.activeId === action.id ? state : { ...state, activeId: action.id };

    case 'showTerminal':
      // 点灯复合意图（§2.5）：切显 + 必激活终端 tab；模态期屏蔽（activate 同门）
      if (state.dialog !== null) return state;
      if (state.displayedTerminalId === action.id && state.activeId === TERMINAL_TAB_ID) return state;
      return { ...state, displayedTerminalId: action.id, activeId: TERMINAL_TAB_ID };

    case 'setDisplayed':
      // Live 归位专用（§2.5 displayed 终端消失回落 owner）：不动 activeId、不受 dialog 屏蔽
      return state.displayedTerminalId === action.id ? state : { ...state, displayedTerminalId: action.id };

    case 'requestClose': {
      if (state.dialog !== null) return state;
      const tab = findTab(state.tabs, action.path);
      if (!tab) return state;
      if (tab.dirtyValue !== null) {
        // dirty → 未保存确认（§4）
        return { ...state, dialog: { k: 'closeConfirm', path: action.path } };
      }
      // 非 dirty → 直接关（等价 closeTab）
      return closeTabImpl(state, action.path);
    }

    case 'closeTab':
      // 无条件移除（confirm 后 discard / 非 dirty 直关都走这里）
      return closeTabImpl(state, action.path);

    case 'edit': {
      const tab = findTab(state.tabs, action.path);
      if (!tab) return state;
      const original = tab.load.k === 'loaded' ? tab.load.content : null;
      const dirtyValue = action.value === original ? null : action.value; // 恢复原文 = 不 dirty
      const tabs = patchTab(state.tabs, action.path, (t) => ({ ...t, dirtyValue, saveError: null }));
      return { ...state, tabs };
    }

    case 'toggleMdSource': {
      if (!findTab(state.tabs, action.path)) return state;
      const tabs = patchTab(state.tabs, action.path, (t) => ({ ...t, mdSource: !t.mdSource }));
      return { ...state, tabs };
    }

    case 'saveStarted': {
      if (!findTab(state.tabs, action.path)) return state;
      const tabs = patchTab(state.tabs, action.path, (t) => ({ ...t, saving: true, saveError: null }));
      return { ...state, tabs };
    }

    case 'saveOk': {
      if (!findTab(state.tabs, action.path)) return state;
      const tabs = patchTab(state.tabs, action.path, (t) => {
        const load: TabLoad =
          t.load.k === 'loaded'
            ? { ...t.load, content: action.savedValue, mtimeMs: action.mtimeMs }
            : { k: 'loaded', content: action.savedValue, encoding: 'utf8', truncated: false, mtimeMs: action.mtimeMs };
        // 仅 dirtyValue===savedValue 才清 dirty（保存期继续键入不被误清）
        const dirtyValue = t.dirtyValue === action.savedValue ? null : t.dirtyValue;
        return { ...t, saving: false, load, dirtyValue };
      });
      // 冲突对话框若指向该 path，覆盖成功后清除
      const dialog = state.dialog?.k === 'conflict' && state.dialog.path === action.path ? null : state.dialog;
      return { ...state, tabs, dialog };
    }

    case 'saveFailed': {
      if (!findTab(state.tabs, action.path)) return state;
      const tabs = patchTab(state.tabs, action.path, (t) => ({ ...t, saving: false, saveError: action.message }));
      return { ...state, tabs };
    }

    case 'saveConflict': {
      if (!findTab(state.tabs, action.path)) return state;
      const tabs = patchTab(state.tabs, action.path, (t) => ({ ...t, saving: false }));
      return { ...state, tabs, dialog: { k: 'conflict', path: action.path } };
    }

    case 'requestExit': {
      if (state.dialog !== null) return state;
      const dirtyPaths = state.tabs.filter((t) => t.dirtyValue !== null).map((t) => t.path);
      if (dirtyPaths.length > 0) {
        return { ...state, dialog: { k: 'exitSummary', paths: dirtyPaths } };
      }
      return null; // 无 dirty → 退出视图
    }

    case 'cancelDialog':
      return state.dialog === null ? state : { ...state, dialog: null };

    case 'exit':
      return null;

    default: {
      // 穷尽保护
      const _never: never = action;
      return _never;
    }
  }
}

function closeTabImpl(state: FileTabsState, path: string): FileTabsState {
  if (!findTab(state.tabs, path)) return state;
  const activeId = activeAfterClose(state.tabs, path, state.activeId);
  const tabs = state.tabs.filter((t) => t.path !== path);
  // 若对话框指向该 path（closeConfirm/conflict），关闭后清除
  const dialog =
    state.dialog && (state.dialog.k === 'closeConfirm' || state.dialog.k === 'conflict') && state.dialog.path === path
      ? null
      : state.dialog;
  return { ...state, tabs, activeId, dialog };
}
