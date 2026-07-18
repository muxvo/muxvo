/**
 * tab 式文件视图 live 包装（specs/behavior/file-tabs-view.md）：把纯 View `FileTabsView` 接到真桥。
 *
 * 职责（纯 View 之外的副作用全在此）：
 *  - 左树：useLiveFileTree(root=来源终端实时 cwd)（复用 file-panel live 同款懒加载/隐藏开关）。
 *  - 读取控制器：tab.load==='loading' 且未在途 → fs.request readFile（image/pdf/spreadsheet 走 base64）
 *    → fileLoaded / fileLoadFailed（code→中文文案）。
 *  - 保存：writeFile{baseMtimeMs=load.mtimeMs} → saveOk / saveConflict(MTIME_CONFLICT) / saveFailed；
 *    冲突「覆盖」= 重发**不带 baseMtimeMs**。
 *  - 对话框装配（closeConfirm/exitSummary/conflict）+ 键盘（⌘S/⌘W/⌘/，⌃ 组合放行）+ 焦点迁移。
 *  - 来源终端从 fx 消失 → 自动退出（dirty 丢弃，规格未覆盖的定版补充语义）。
 *
 * Esc / ⌘E 由 LiveInteractionLayer 统一处理（视图内 ⌘E no-op，Esc 优先级栈并入既有 effect）。
 */

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { FsRequest, FsResponse, UIAction } from '../../bridge/gen/protocol';
import { track } from '../../bridge/track';
import type { Fixture } from '../../fixture/types';
import { FileTabsView } from '../filetabs/FileTabsView';
import { buildTerminalLights } from '../filetabs/FileTabBar';
import { cardTitle } from '../../tile/MiniTermCard';
import { useLiveFileTree } from '../file/useLiveFileTree';
import type { FlatEntry } from '../file/file-tree-static';
import type { DialogAction } from '../filetabs/UnsavedDialog';
import {
  TERMINAL_TAB_ID,
  fileTypeOf,
  type FileTabsAction,
  type FileTabsState,
  type FileType,
} from '../filetabs/fileTabsReducer';

type SaveResult = 'ok' | 'conflict' | 'failed';

/** readFile rejected.code → 中文文案（未知 code 回原文 message）。 */
function loadErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'NOT_FOUND':
      return '文件不存在';
    case 'PERM_DENIED':
      return '无权限';
    case 'TOO_LARGE':
      return '文件过大';
    case 'NOT_UTF8':
      return '非文本文件';
    case 'IS_DIR':
      return '是目录';
    default:
      return fallback;
  }
}

/** 二进制预览类型（readFile 需 base64 整读）。 */
function needsBase64(fileType: FileType): boolean {
  return fileType === 'image' || fileType === 'pdf' || fileType === 'spreadsheet';
}

export function LiveFileTabsView({
  fileTabs,
  dispatch,
  fx,
  onAction,
  onFsRequest,
}: {
  fileTabs: FileTabsState;
  dispatch: (a: FileTabsAction) => void;
  fx: Fixture;
  onAction: (action: UIAction) => void;
  onFsRequest?: (req: FsRequest) => Promise<FsResponse>;
}): JSX.Element {
  const sourceTerminalId = fileTabs.sourceTerminalId;
  const term = fx.terminals.find((t) => t.id === sourceTerminalId);
  // root = 来源终端实时 cwd（终端里 cd → cwd 变 → 树重载，与 file-panel 同源）。
  const root = term?.cwd ?? '';
  const showHidden = !!fx.showHiddenFiles;
  const { entries, emptyState, toggleDir } = useLiveFileTree(root, showHidden, onFsRequest);
  const terminalLabel = term?.customName ?? (root.split('/').pop() || '~');
  // ── 终端状态灯组（§2.5）：洞与终端 tab 名跟随 displayed；owner 语义（树/读写/退出）仍绑 source ──
  const displayedTerminalId = fileTabs.displayedTerminalId;
  const displayedTerm = fx.terminals.find((t) => t.id === displayedTerminalId);
  const displayedTerminalLabel = displayedTerm ? cardTitle(displayedTerm) : terminalLabel; // 死亡帧兜底
  const lights = buildTerminalLights(fx.terminals, sourceTerminalId, displayedTerminalId);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  // ── markdown 真渲染（动态 import markdown/md-view；ChatHistoryScreen:839 同款范式——静态/golden
  //    路径不 import → markdown-it/hljs 不进截图 bundle；就绪前 MarkdownBody 走 md-static fallback）──
  const [renderMd, setRenderMd] = useState<((text: string) => ReactNode) | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('../../markdown/md-view').then((m) => {
      if (!cancelled) setRenderMd(() => m.renderFileMarkdown);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // 桥线缆每 push 换新引用（useLiveFileTree 同款范式）→ 存 ref 不入 effect 依赖。
  const fsRef = useRef(onFsRequest);
  fsRef.current = onFsRequest;
  // 读取在途集合（防重复 readFile）。
  const loadingRef = useRef<Set<string>>(new Set());
  // 保存在途集合（防 ⌘S 连按重发；顺序保存链天然不重叠）。
  const savingRef = useRef<Set<string>>(new Set());
  // 右键菜单在途门（左树行 + 内容区共享；防重入连发 showFileMenu，LiveFilePanel 同款）。
  const menuPendingRef = useRef(false);

  // ── 读取控制器：loading 且未在途 → readFile ──
  useEffect(() => {
    for (const tab of fileTabs.tabs) {
      if (tab.load.k !== 'loading') continue;
      if (loadingRef.current.has(tab.path)) continue;
      const fn = fsRef.current;
      if (!fn) {
        // 截图模式理论不可达（本视图仅 LiveInteractionLayer 挂）；仍防御。
        dispatch({ t: 'fileLoadFailed', path: tab.path, message: '无法读取文件' });
        continue;
      }
      loadingRef.current.add(tab.path);
      const encoding = needsBase64(tab.fileType) ? 'base64' : undefined;
      const req: FsRequest = encoding
        ? { kind: 'readFile', path: tab.path, encoding }
        : { kind: 'readFile', path: tab.path };
      const path = tab.path;
      void fn(req)
        .then((resp) => {
          if (resp.kind === 'fileContent') {
            dispatch({
              t: 'fileLoaded',
              path,
              content: resp.content,
              encoding: resp.encoding === 'base64' ? 'base64' : 'utf8',
              truncated: !!resp.truncated,
              mtimeMs: resp.mtimeMs,
            });
          } else if (resp.kind === 'rejected') {
            dispatch({ t: 'fileLoadFailed', path, message: loadErrorMessage(resp.code, resp.message) });
          } else {
            dispatch({ t: 'fileLoadFailed', path, message: '读取失败' });
          }
        })
        .catch(() => dispatch({ t: 'fileLoadFailed', path, message: '读取失败' }))
        .finally(() => {
          loadingRef.current.delete(path);
        });
    }
  }, [fileTabs.tabs, dispatch]);

  // ── 保存（返回结果供对话框链判定）──
  const doWrite = async (path: string, overwrite = false): Promise<SaveResult> => {
    if (savingRef.current.has(path)) return 'failed';
    const tab = fileTabs.tabs.find((t) => t.path === path);
    if (!tab || tab.dirtyValue === null) return 'ok'; // 无脏值 = 无需保存（顺序保存跳过已净）
    const fn = fsRef.current;
    if (!fn) {
      dispatch({ t: 'saveFailed', path, message: '无法保存' });
      return 'failed';
    }
    const dirtyValue = tab.dirtyValue;
    // overwrite（冲突覆盖）不带 baseMtimeMs → create-or-overwrite；否则条件写。
    const baseMtimeMs = !overwrite && tab.load.k === 'loaded' ? tab.load.mtimeMs : undefined;
    savingRef.current.add(path);
    dispatch({ t: 'saveStarted', path });
    try {
      const req: FsRequest =
        baseMtimeMs != null
          ? { kind: 'writeFile', path, content: dirtyValue, baseMtimeMs }
          : { kind: 'writeFile', path, content: dirtyValue };
      const resp = await fn(req);
      if (resp.kind === 'fileWritten') {
        dispatch({ t: 'saveOk', path, mtimeMs: resp.mtimeMs, savedValue: dirtyValue });
        return 'ok';
      }
      if (resp.kind === 'rejected' && resp.code === 'MTIME_CONFLICT') {
        dispatch({ t: 'saveConflict', path });
        return 'conflict';
      }
      const message = resp.kind === 'rejected' ? loadErrorMessage(resp.code, resp.message) : '保存失败';
      dispatch({ t: 'saveFailed', path, message });
      return 'failed';
    } catch {
      dispatch({ t: 'saveFailed', path, message: '保存失败' });
      return 'failed';
    } finally {
      savingRef.current.delete(path);
    }
  };

  // 退出汇总「全部保存」：按序逐个 save，全部成功 → exit；首个冲突/失败即停。
  const saveAllThenExit = async (paths: string[]): Promise<void> => {
    for (const p of paths) {
      // eslint-disable-next-line no-await-in-loop
      const r = await doWrite(p);
      if (r === 'conflict') return; // saveConflict 已弹该文件冲突对话框，链停
      if (r === 'failed') {
        dispatch({ t: 'cancelDialog' }); // 失败留 saveError，关汇总对话框
        return;
      }
    }
    dispatch({ t: 'exit' });
  };

  const onDialogAction = (a: DialogAction): void => {
    const dialog = fileTabs.dialog;
    if (!dialog) return;
    if (dialog.k === 'closeConfirm') {
      const path = dialog.path;
      if (a === 'save') {
        void doWrite(path).then((r) => {
          if (r === 'ok') dispatch({ t: 'closeTab', path });
        });
      } else if (a === 'discard') {
        dispatch({ t: 'closeTab', path });
      } else if (a === 'cancel') {
        dispatch({ t: 'cancelDialog' });
      }
    } else if (dialog.k === 'exitSummary') {
      if (a === 'saveAll') void saveAllThenExit(dialog.paths);
      else if (a === 'discardAll') dispatch({ t: 'exit' });
      else if (a === 'cancel') dispatch({ t: 'cancelDialog' });
    } else if (dialog.k === 'conflict') {
      const path = dialog.path;
      if (a === 'overwrite') void doWrite(path, true); // saveOk 在 reducer 内清冲突对话框
      else if (a === 'cancel') dispatch({ t: 'cancelDialog' });
    }
  };

  // ── 键盘（挂载期 document keydown，非 capture）：⌘S/⌘W/⌘/；⌃ 组合一律放行（emacs 键，批A MINOR-1）──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey || e.ctrlKey) return;
      const { activeId, tabs } = fileTabs;
      const activeTab = activeId === TERMINAL_TAB_ID ? undefined : tabs.find((t) => t.path === activeId);
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (activeTab && activeTab.dirtyValue !== null && !activeTab.saving) void doWrite(activeTab.path);
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        if (activeTab) dispatch({ t: 'requestClose', path: activeTab.path }); // 终端 tab no-op
      } else if (e.key === '/') {
        if (activeTab && activeTab.fileType === 'markdown') {
          e.preventDefault();
          dispatch({ t: 'toggleMdSource', path: activeTab.path });
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTabs, dispatch]);

  // ── 焦点迁移：文件 tab → 编辑器聚焦；终端 tab → blur（不发协议不夺焦，用户点洞 native 自取 firstResponder）──
  useEffect(() => {
    if (fileTabs.activeId === TERMINAL_TAB_ID) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } else {
      editorRef.current?.focus?.();
    }
  }, [fileTabs.activeId]);

  // ── 来源终端被关（fx.terminals 查无）→ 自动退出（dirty 丢弃，定版补充语义）──
  useEffect(() => {
    if (!fx.terminals.some((t) => t.id === sourceTerminalId)) dispatch({ t: 'exit' });
  }, [fx.terminals, sourceTerminalId, dispatch]);

  // ── displayed 终端被关（≠owner）→ 归位 owner（§2.5：不动 activeId 不夺焦；source 消失由上一
  //    effect 整体退出接管，此处跳过避免归位/退出竞争）──
  useEffect(() => {
    if (!fx.terminals.some((t) => t.id === sourceTerminalId)) return;
    if (!fx.terminals.some((t) => t.id === displayedTerminalId)) {
      dispatch({ t: 'setDisplayed', id: sourceTerminalId });
    }
  }, [fx.terminals, sourceTerminalId, displayedTerminalId, dispatch]);

  const onItemClick = (entry: FlatEntry): void => {
    if (entry.type === 'folder') {
      toggleDir(entry.path);
      return;
    }
    dispatch({ t: 'openFile', path: entry.path, name: entry.name, fileType: fileTypeOf(entry.path) });
    track('files.file_opened', { kind: fileTypeOf(entry.path) });
  };
  // 左树行右键 → showFileMenu（LiveFilePanel.onItemContextMenu 同款：preventDefault + pending 门防重入）。
  const onItemContextMenu = (entry: FlatEntry, e: ReactMouseEvent): void => {
    e.preventDefault();
    const fn = onFsRequest;
    if (menuPendingRef.current || !fn) return;
    menuPendingRef.current = true;
    void fn({
      kind: 'showFileMenu',
      path: entry.path,
      isDirectory: entry.type === 'folder',
      x: e.clientX,
      y: e.clientY,
    })
      .catch(() => {})
      .finally(() => {
        menuPendingRef.current = false;
      });
  };
  // 内容区右键 → 活跃文件 showFileMenu。守卫序：终端 tab/无活跃 tab、编辑器内、有选区 → 一律放行系统菜单
  // （不 preventDefault）；否则接管（preventDefault + 对活跃文件路径发菜单，与左树共享 pending 门）。
  const onContentContextMenu = (e: ReactMouseEvent): void => {
    const { activeId, tabs } = fileTabs;
    if (activeId === TERMINAL_TAB_ID) return; // 终端 tab = 洞区，native 洞后合成，web 不接管
    const activeTab = tabs.find((t) => t.path === activeId);
    if (!activeTab) return;
    if ((e.target as HTMLElement).closest('textarea, input')) return; // 编辑器内 → 保系统剪切/复制/粘贴菜单
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString() !== '') return; // 有选区 → 保系统复制菜单
    e.preventDefault();
    const fn = onFsRequest;
    if (menuPendingRef.current || !fn) return;
    menuPendingRef.current = true;
    void fn({
      kind: 'showFileMenu',
      path: activeTab.path,
      isDirectory: false,
      x: e.clientX,
      y: e.clientY,
    })
      .catch(() => {})
      .finally(() => {
        menuPendingRef.current = false;
      });
  };
  const onToggleHidden = (): void => onAction({ kind: 'setShowHiddenFiles', value: !showHidden });

  return (
    <FileTabsView
      sourceTerminalId={sourceTerminalId}
      displayedTerminalId={displayedTerminalId}
      terminalLabel={terminalLabel}
      displayedTerminalLabel={displayedTerminalLabel}
      lights={lights}
      onSelectTerminal={(id) => dispatch({ t: 'showTerminal', id })}
      entries={entries}
      emptyState={emptyState}
      showHidden={showHidden}
      activeFilePath={fileTabs.activeId === TERMINAL_TAB_ID ? null : fileTabs.activeId}
      tabs={fileTabs.tabs}
      activeId={fileTabs.activeId}
      dialog={fileTabs.dialog}
      renderHole
      onSelectTab={(id) => dispatch({ t: 'activate', id })}
      onCloseTab={(path) => dispatch({ t: 'requestClose', path })}
      onExit={() => dispatch({ t: 'requestExit' })}
      onItemClick={onItemClick}
      onItemContextMenu={onItemContextMenu}
      onContentContextMenu={onContentContextMenu}
      onToggleHidden={onToggleHidden}
      onEdit={(path, value) => dispatch({ t: 'edit', path, value })}
      onToggleMdSource={(path) => dispatch({ t: 'toggleMdSource', path })}
      onDialogAction={onDialogAction}
      editorRef={editorRef}
      renderMd={renderMd ?? undefined}
    />
  );
}
