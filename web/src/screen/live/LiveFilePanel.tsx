/**
 * 文件面板 live 组件（specs/behavior/file-panel.md §0.5，v9）。
 * 开关态 native 拥有（ui.state.filePanel{terminalId}）；本组件只在 fx.filePanel!=null 时挂载。
 * 树数据走 useLiveFileTree（懒加载/折叠保 cache/子目录失败静默/root 失败入空态）；渲染共享 FilePanelView。
 *
 * - root = 归属 tile 的 cwd（终端里 cd → cwd 变 → 树重载，PRD M01 L277「跟着用新目录」）。
 * - 点文件行 = 批A no-op（用户裁决，批B tab 视图接管）；点 folder 行懒加载展开。
 * - showHidden 读 fx.showHiddenFiles；眼睛 → setShowHiddenFiles（native 落盘+推快照）。
 * - 右键（行 + tile 头文件按钮同路）→ showFileMenu；pending 期间防重入。
 * - 关闭：✕ / Esc（LiveInteractionLayer 栈）/ 点外 overlay → fileClose。
 * - 拖拽：源行挂 DragIsland + body.dragging-file（overlay 放行）；靶=tile 根（TermTile）。
 * - 滑入：mount 下一帧加 --open（rAF 一次 setState；关闭直接卸载，legacy 亦无退出动画）。
 */

import { useEffect, useRef, useState } from 'react';
import type { FsRequest, FsResponse, UIAction } from '../../bridge/gen/protocol';
import type { Fixture } from '../../fixture/types';
import { FilePanelView } from '../file/FilePanelView';
import { useLiveFileTree } from '../file/useLiveFileTree';
import type { FlatEntry } from '../file/file-tree-static';
import { DragIsland } from './DragIsland';

export function LiveFilePanel({
  terminalId,
  fx,
  onAction,
  onFsRequest,
  onFileOpen,
}: {
  terminalId: string;
  fx: Fixture;
  onAction: (action: UIAction) => void;
  onFsRequest?: (req: FsRequest) => Promise<FsResponse>;
  /** 点文件行 → 进入 tab 式文件视图（批B）；缺省=批A no-op。 */
  onFileOpen?: (entry: FlatEntry) => void;
}): JSX.Element {
  const term = fx.terminals.find((t) => t.id === terminalId);
  const root = term?.cwd ?? '';
  const showHidden = !!fx.showHiddenFiles;
  const { entries, emptyState, toggleDir } = useLiveFileTree(root, showHidden, onFsRequest);

  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuPendingRef = useRef(false);

  // 滑入：mount 下一帧翻 --open（截图路径不存在本组件，无需禁动画）
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // Esc 落 web：容器聚焦（Esc 栈在 LiveInteractionLayer，document capture）
  useEffect(() => {
    containerRef.current?.focus();
  }, []);
  // 卸载兜底：清 body.dragging-file（dragend 未触发时防残留）
  useEffect(() => () => document.body.classList.remove('dragging-file'), []);

  const projectName = root.split('/').pop() || '~';

  const onItemClick = (entry: FlatEntry): void => {
    if (entry.type === 'folder') toggleDir(entry.path);
    else if (onFileOpen) onFileOpen(entry); // 文件行 → tab 视图（批A 缺省 no-op）
  };
  const onItemContextMenu = (entry: FlatEntry, e: React.MouseEvent): void => {
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
  const onItemDragStart = (): void => {
    setDragging(true);
    document.body.classList.add('dragging-file');
  };
  const onItemDragEnd = (): void => {
    setDragging(false);
    document.body.classList.remove('dragging-file');
  };
  const onClose = (): void => onAction({ kind: 'fileClose' });
  const onToggleHidden = (): void => onAction({ kind: 'setShowHiddenFiles', value: !showHidden });

  return (
    <>
      {/* overlay 全窗挂岛（点外关，点击不漏给下层 Metal 终端）；拖拽期 body.dragging-file 令其放行 */}
      <div className="file-panel-overlay" data-hit-island="" onMouseDown={onClose} />
      <FilePanelView
        projectName={projectName}
        entries={entries}
        showHidden={showHidden}
        open={open}
        emptyState={emptyState}
        onToggleHidden={onToggleHidden}
        onClose={onClose}
        onItemClick={onItemClick}
        onItemContextMenu={onItemContextMenu}
        onItemDragStart={onItemDragStart}
        onItemDragEnd={onItemDragEnd}
        containerRef={containerRef}
      />
      {dragging && <DragIsland />}
    </>
  );
}
