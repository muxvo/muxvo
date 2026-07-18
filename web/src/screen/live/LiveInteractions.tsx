/**
 * 桥/live 模式的交互中间态层（批4③ web 补全；DOGFOOD_M3_04 改 FAB 直建 + 浮层岛约定）。
 *
 * 三态：① FAB→直接发 create（默认目录，native 缺省 homePath，无目录选择弹窗）；
 * ② 关闭钮→CloseConfirmDialog→确认发 close；③ 重命名本地三态（单击 header 名称区进编辑→
 * Enter/点外/blur 提交 renameSubmit→Esc 取消；spec term-grid §4.4，DOGFOOD_M3_15）。
 *
 * 浮层=岛约定（DOGFOOD_M3_04）：盖在终端洞上的 live 浮层（CloseConfirmDialog 全窗 backdrop）挂
 * data-hit-island，令 useLayoutReport 上报 role="island"、native 从穿透区抠掉；否则点击被下层
 * Metal 终端吞掉（dogfood P0「取消钮点不了」）。data-* 零像素，golden 不变。
 *
 * golden 铁律：本层只在 live 模式（TerminalScreen 收到 onAction && onTermCommand）挂载并提供
 * context；截图/纯展示模式无 provider → useLiveInteractions() 返回 null → 深层组件（Fab/TileHeader）
 * 新交互全部 inert，DOM/像素零差异。复用 M2 已复刻组件的 .close-confirm-* CSS 类（纯 class-scoped，
 * 对 terminal-grid DOM 无匹配元素故渲染无影响）；modals.css 由本层静态引入。
 */

import { createContext, useContext, useEffect, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  FsRequest,
  FsResponse,
  TermCommandRequest,
  TermCommandResponse,
  UIAction,
} from '../../bridge/gen/protocol';
import type { Fixture } from '../../fixture/types';
import type { FlatEntry } from '../file/file-tree-static';
import { fileTabsReducer, fileTypeOf } from '../filetabs/fileTabsReducer';
import { track } from '../../bridge/track';
import { LiveWorktreePopover } from './LiveWorktreePopover';
import { LiveFilePanel } from './LiveFilePanel';
import { LiveFileTabsView } from './LiveFileTabsView';
import { quotePath } from './quotePath';
import '../modal/modals.css';

export interface LiveInteractions {
  /** FAB → 直接创建新终端（默认目录，无目录选择弹窗；DOGFOOD_M3_04）。 */
  requestCreate(): void;
  /** 关闭钮 → 打开关闭确认对话框。 */
  requestClose(terminalId: string): void;
  /** 单击 header 名称区 → 进入重命名编辑态（spec §4.4 点击进入编辑，DOGFOOD_M3_15）。 */
  beginRename(terminalId: string): void;
  /** 当前编辑中的终端 id（null = 非编辑态）；单活跃编辑。 */
  editingId: string | null;
  editingValue: string;
  onEditingChange(value: string): void;
  submitRename(): void;
  cancelRename(): void;
  /** worktree 按钮 → 打开浮层（本地态，closeConfirm 同款）。 */
  openWorktree(terminalId: string): void;
  closeWorktree(): void;
  worktreeFor: string | null;
  /** 文件按钮 → 发 fileOpen/fileClose（开关态 native 拥有，从 fx.filePanel 读）。 */
  openFilePanel(terminalId: string): void;
  closeFilePanel(): void;
  /** 文件面板点文件行 → 进入 tab 式文件视图（enter+openFile 连发；同时关面板，规格 §0）。 */
  openFileTabs(terminalId: string, entry: FlatEntry): void;
  /** tile 头文件按钮右键（REQ-034）→ showFileMenu，path=该 tile cwd、isDirectory=true。 */
  fileMenuForCwd(terminalId: string, x: number, y: number): void;
  /** 拖拽路径入终端（TermTile drop 靶）→ term.command insertText（web 侧 quotePath 转义）。 */
  insertPath(terminalId: string, path: string): void;
}

const LiveInteractionContext = createContext<LiveInteractions | null>(null);

/** 深层组件消费：返回 null = 非 live 模式（截图/纯展示）→ 新交互一律不挂。 */
export function useLiveInteractions(): LiveInteractions | null {
  return useContext(LiveInteractionContext);
}

/** 退出确认两态文案（DOGFOOD_M3_19，legacy AppCloseConfirmDialog 对齐）：有运行终端 → 警告将全部终止；
 * 否则 → 普通确认退出。纯函数供单测与对话框共用。 */
export function quitConfirmMessage(terminalCount: number): string {
  return terminalCount > 0
    ? `当前有 ${terminalCount} 个终端正在运行，退出后将全部终止。`
    : '确定要退出 Muxvo 吗？';
}

export function LiveInteractionLayer({
  fx,
  onAction,
  onTermCommand,
  onFsRequest,
  onTermRequest,
  children,
}: {
  fx: Fixture;
  onAction: (action: UIAction) => void;
  onTermCommand: (req: TermCommandRequest) => void;
  /** fs.request（worktree/文件树/右键菜单）。live 桥宿主传；截图/纯展示不传。 */
  onFsRequest?: (req: FsRequest) => Promise<FsResponse>;
  /** term.command 带响应版（worktree 行点击需 created 响应；拖拽 insertText）。 */
  onTermRequest?: (req: TermCommandRequest) => Promise<TermCommandResponse>;
  children: ReactNode;
}): JSX.Element {
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [worktreeFor, setWorktreeFor] = useState<string | null>(null);
  // tab 式文件视图状态机（本地态，closeConfirm 范式；null = 视图关，接管整个网格区）。
  const [fileTabs, dispatchFileTabs] = useReducer(fileTabsReducer, null);

  // 弹层目标终端被移出快照（关闭/收割）→ 清本地态：浮层按 ID 锚定后 measure 找不到 tile 会
  // rAF 空转到卸载（对抗验收 MINOR-1），且 worktreeFor 是本地态、投影移除不会替我们清。
  useEffect(() => {
    if (worktreeFor != null && !fx.terminals.some((t) => t.id === worktreeFor)) {
      setWorktreeFor(null);
    }
  }, [fx.terminals, worktreeFor]);

  const api: LiveInteractions = {
    requestCreate: () => onTermCommand({ kind: 'create' }),
    // closeConfirm 打开前先关 worktree 浮层（互斥面，plan §2.5）；文件面板可共存。
    requestClose: (terminalId) => {
      setWorktreeFor(null);
      setCloseTarget(terminalId);
    },
    beginRename: (terminalId) => {
      const t = fx.terminals.find((x) => x.id === terminalId);
      setEditingId(terminalId);
      setEditingValue(t?.customName ?? '');
    },
    editingId,
    editingValue,
    onEditingChange: setEditingValue,
    // guard：editingId 已清（点外监听与 onBlur 双触发的第二次）→ no-op，不重复发桥（DOGFOOD_M3_15）。
    submitRename: () => {
      if (editingId == null) return;
      onAction({ kind: 'renameSubmit', terminalId: editingId, name: editingValue });
      setEditingId(null);
    },
    cancelRename: () => setEditingId(null),
    openWorktree: (terminalId) => setWorktreeFor(terminalId),
    closeWorktree: () => setWorktreeFor(null),
    worktreeFor,
    openFilePanel: (terminalId) => onAction({ kind: 'fileOpen', terminalId }),
    closeFilePanel: () => onAction({ kind: 'fileClose' }),
    openFileTabs: (terminalId, entry) => {
      dispatchFileTabs({ t: 'enter', sourceTerminalId: terminalId });
      dispatchFileTabs({
        t: 'openFile',
        path: entry.path,
        name: entry.name,
        fileType: fileTypeOf(entry.path),
      });
      track('files.file_opened', { kind: fileTypeOf(entry.path) });
      if (fx.filePanel != null) onAction({ kind: 'fileClose' }); // 进入即关面板（规格 §0）
    },
    fileMenuForCwd: (terminalId, x, y) => {
      const t = fx.terminals.find((x2) => x2.id === terminalId);
      if (onFsRequest && t)
        void onFsRequest({ kind: 'showFileMenu', path: t.cwd, isDirectory: true, x, y }).catch(
          () => {},
        );
    },
    insertPath: (terminalId, path) => {
      if (onTermRequest)
        void onTermRequest({ kind: 'insertText', terminalId, text: quotePath(path) }).catch(
          () => {},
        );
    },
  };

  // 点外提交（DOGFOOD_M3_15，spec §4.4「blur 确认」的可靠实现）：洞穿透架构下 DOM blur 不可靠
  //（洞区点击 WKWebView 收不到事件；native 抢焦无回传信号）——编辑期挂 document 捕获 mousedown，
  // target 不在编辑输入框内即提交。洞区点击由 .rename-blur-guard 全窗岛拦回 web 后同样落入本监听。
  // 捕获期先于 React 合成 click：点另一 tile 名称 = 先提交旧编辑再进入新编辑，顺序天然正确。
  useEffect(() => {
    if (editingId == null) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      const input = document.querySelector('.tile-custom-name-input');
      if (input && e.target instanceof Node && input.contains(e.target)) return;
      if (editingId != null) {
        onAction({ kind: 'renameSubmit', terminalId: editingId, name: editingValue });
        setEditingId(null);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, [editingId, editingValue, onAction]);

  const confirmClose = (): void => {
    if (closeTarget != null) onTermCommand({ kind: 'close', terminalId: closeTarget });
    setCloseTarget(null);
  };

  // Esc 优先级栈（plan §2.5 + file-tabs §4）：closeConfirm > worktreePopover > fileTabs.dialog(取消) >
  // fileTabs(退出视图) > filePanel，只关最顶层并 stopPropagation。
  // 编辑态（editingId!=null）放行——renameEditing 的 Esc 由 input 自身 onKeyDown 消化，不抢。
  const filePanelOpen = fx.filePanel != null;
  useEffect(() => {
    const anyOpen = closeTarget != null || worktreeFor != null || fileTabs != null || filePanelOpen;
    if (!anyOpen || editingId != null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (closeTarget != null) setCloseTarget(null);
      else if (worktreeFor != null) setWorktreeFor(null);
      else if (fileTabs != null && fileTabs.dialog != null) dispatchFileTabs({ t: 'cancelDialog' });
      else if (fileTabs != null) dispatchFileTabs({ t: 'requestExit' });
      else if (filePanelOpen) onAction({ kind: 'fileClose' });
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [closeTarget, worktreeFor, fileTabs, filePanelOpen, editingId, onAction]);

  // ⌘E（web 有焦点时；native 常态拦截，见 spec §0.5）：开则关、关则对 selected/focused 终端开
  //（"顺手做" 于本层，plan §2.5）。视图开期（fileTabs!=null）⌘E no-op（file-tabs §6「再议」项）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 仅 ⌘E（对齐 native 菜单 [.command]）；⌃E 放行——macOS emacs 行尾键，劫持会破坏输入框
      // 标准光标操作（对抗验收 MINOR-1）。
      if (!e.metaKey || e.ctrlKey || (e.key !== 'e' && e.key !== 'E')) return;
      if (fileTabs != null) return; // 视图内 ⌘E no-op
      e.preventDefault();
      if (fx.filePanel != null) {
        onAction({ kind: 'fileClose' });
      } else {
        const target = fx.selectedId ?? fx.focusedId ?? fx.terminals[0]?.id;
        if (target) onAction({ kind: 'fileOpen', terminalId: target });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fx.filePanel, fx.selectedId, fx.focusedId, fx.terminals, fileTabs, onAction]);

  // 视图开期面板互斥兜底闸：native ⌘E 仍可能置 fx.filePanel（web ⌘E no-op 拦不到 native 快捷键）——
  // 视图开着时任何 filePanel 出现即发 fileClose 关掉（视图内不并存文件面板，规格 §0）。
  useEffect(() => {
    if (fileTabs != null && fx.filePanel != null) onAction({ kind: 'fileClose' });
  }, [fileTabs, fx.filePanel, onAction]);

  // dogfood-r3 问题5：file tabs 视图开合上报 native（⌘+/- 路由态；fileTabs 是 web 本地 reducer state，
  // native 不可见）。卸载 cleanup 发 false，native setPanelMode 切换另有防御清空。
  const fileTabsOpen = fileTabs != null;
  useEffect(() => {
    if (!fileTabsOpen) return;
    onAction({ kind: 'panelOverlayReport', source: 'fileTabs', active: true });
    return () => onAction({ kind: 'panelOverlayReport', source: 'fileTabs', active: false });
  }, [fileTabsOpen, onAction]);

  return (
    <LiveInteractionContext.Provider value={api}>
      {/* 视图开（fileTabs!=null）接管整个网格区（其他 tile 不可见）；否则渲染终端网格 children。
          既有浮层（关闭/退出/重命名/worktree/文件面板）两分支下都保持挂载能力。 */}
      {fileTabs != null ? (
        <LiveFileTabsView
          fileTabs={fileTabs}
          dispatch={dispatchFileTabs}
          fx={fx}
          onAction={onAction}
          onFsRequest={onFsRequest}
        />
      ) : (
        children
      )}
      {closeTarget != null && (
        <CloseConfirmDialog
          message="确定关闭此终端？"
          confirmLabel="确定"
          onConfirm={confirmClose}
          onCancel={() => setCloseTarget(null)}
        />
      )}
      {/* 整 app 退出确认（DOGFOOD_M3_19）：native applicationShouldTerminate 拦截置 quitConfirm 待决 →
          此处弹 legacy AppCloseConfirmDialog 对等对话框（遮罩 .app-close-overlay、标题「退出 Muxvo」、
          两态文案、Esc/遮罩/取消→cancelQuit、确认→confirmQuit）。截图/纯展示模式无 LiveInteractionLayer
          （TerminalScreen 门控），故整 app 版仅 live 出现。 */}
      {fx.quitConfirm != null && (
        <CloseConfirmDialog
          overlayClass="app-close-overlay"
          title="退出 Muxvo"
          message={quitConfirmMessage(fx.quitConfirm.terminalCount)}
          confirmLabel="退出"
          escToCancel
          onConfirm={() => onAction({ kind: 'confirmQuit' })}
          onCancel={() => onAction({ kind: 'cancelQuit' })}
        />
      )}
      {editingId != null && <RenameBlurGuard />}
      {worktreeFor != null && (
        <LiveWorktreePopover
          key={worktreeFor}
          terminalId={worktreeFor}
          fx={fx}
          onFsRequest={onFsRequest}
          onTermRequest={onTermRequest}
          onAction={onAction}
          onClose={() => setWorktreeFor(null)}
        />
      )}
      {fx.filePanel != null && fileTabs == null && (
        <LiveFilePanel
          key={fx.filePanel.terminalId}
          terminalId={fx.filePanel.terminalId}
          fx={fx}
          onAction={onAction}
          onFsRequest={onFsRequest}
          onFileOpen={(entry) => api.openFileTabs(fx.filePanel!.terminalId, entry)}
        />
      )}
    </LiveInteractionContext.Provider>
  );
}

/** 改名编辑期全窗透明岛（DOGFOOD_M3_15）：唯一职责 = 挂 data-hit-island 让 native 把洞区点击
 * 拦回 web（HoleStore「洞内且不在岛内才穿透」）；`pointer-events:none` 使它在 DOM 侧不挡任何
 * 元素（零 z-index 纠纷）——点击行为全由上面的 document 捕获监听承担。portal 挂卸式 →
 * useLayoutReport MutationObserver 自动重上报（浮层=岛约定，DOGFOOD_M3_04）。 */
function RenameBlurGuard(): JSX.Element {
  return createPortal(
    <div className="rename-blur-guard" data-hit-island="" />,
    document.body,
  );
}

/** 关闭/退出确认对话框（复用 M2 .close-confirm-* 视觉）。参数化（DOGFOOD_M3_19）：
 *  - 终端关闭（默认）：overlayClass=close-confirm-overlay、无标题、message「确定关闭此终端？」、确认钮「确定」。
 *  - 整 app 退出：overlayClass=app-close-overlay（legacy 类名）、标题「退出 Muxvo」、两态 message、确认钮「退出」、
 *    escToCancel（Esc=取消）。
 * 遮罩挂 data-hit-island（弹窗期点击全归 web，native 不 detach；否则取消钮点击穿透下层 Metal 终端，
 * dogfood P0，DOGFOOD_M3_04）。弹窗体 stopPropagation：点内部不触发遮罩取消。 */
function CloseConfirmDialog({
  overlayClass = 'close-confirm-overlay',
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  escToCancel = false,
  onConfirm,
  onCancel,
}: {
  overlayClass?: string;
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  escToCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  // Esc=取消（DOGFOOD_M3_19 整 app 退出：legacy 遮罩点击/Esc 皆取消）。document keydown 随对话框
  // 生命周期挂/卸；仅 escToCancel 变体挂（终端关闭对话框保持原行为不加 Esc）。
  useEffect(() => {
    if (!escToCancel) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [escToCancel, onCancel]);

  return createPortal(
    <div className={overlayClass} data-hit-island="" onClick={onCancel}>
      <div className="close-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        {title != null && <p className="close-confirm-title">{title}</p>}
        <p className="close-confirm-message">{message}</p>
        <div className="close-confirm-actions">
          <button className="close-confirm-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="close-confirm-ok" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
