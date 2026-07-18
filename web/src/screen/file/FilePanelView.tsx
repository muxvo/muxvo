/**
 * 文件面板纯展示视图（M6 批A 抽取，golden 零像素）。
 * 复刻屏（FilePanelScreen）与 live 组件（LiveFilePanel）共用同一份 DOM/CSS。
 *
 * 回调 props 全部可选：未传不挂监听（复刻屏 DOM 逐字节与抽取前一致）。
 * live 专属空态（emptyState）走 `.file-panel__empty` 新分支（复刻屏不传 → 分支不可达，golden 无感）。
 * `.file-item` 恒 `draggable`（复刻屏 golden 本就有该属性）；拖拽 setData 在此发生（源需原生 dragstart 事件）。
 */

import type { RefObject, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { type FlatEntry } from './file-tree-static';
import { FileTreeRows } from './FileTreeRows';
import { EyeOnIcon, EyeOffIcon } from './EyeIcons';

interface FilePanelViewProps {
  projectName: string;
  entries: FlatEntry[];
  showHidden: boolean;
  /** 滑入终态：复刻屏恒 true（golden 为终态）；live 挂载下一帧翻 true */
  open: boolean;
  /** live 面板级空态：'empty' → 📁「此目录为空」、'permission' → 🔒「无法读取此目录，请检查权限」 */
  emptyState?: 'empty' | 'permission' | null;
  onToggleHidden?: () => void;
  onClose?: () => void;
  onItemClick?: (entry: FlatEntry) => void;
  onItemContextMenu?: (entry: FlatEntry, e: ReactMouseEvent) => void;
  onItemDragStart?: (path: string, e: ReactDragEvent) => void;
  onItemDragEnd?: () => void;
  containerRef?: RefObject<HTMLDivElement>;
}

export function FilePanelView({
  projectName,
  entries,
  showHidden,
  open,
  emptyState,
  onToggleHidden,
  onClose,
  onItemClick,
  onItemContextMenu,
  onItemDragStart,
  onItemDragEnd,
  containerRef,
}: FilePanelViewProps): JSX.Element {
  return (
    <div
      className={`file-panel${open ? ' file-panel--open' : ''}`}
      ref={containerRef}
      tabIndex={containerRef ? -1 : undefined}
    >
      <div className="file-panel__header">
        <div className="file-panel__title">
          <span className="file-panel__title-name">{projectName}</span>
        </div>
        <div className="file-panel__actions">
          <button
            className={`file-panel__toggle-hidden ${showHidden ? 'file-panel__toggle-hidden--active' : ''}`}
            title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
            onClick={onToggleHidden}
          >
            {showHidden ? <EyeOnIcon /> : <EyeOffIcon />}
          </button>
          <button className="file-panel__close" onClick={onClose}>
            {'✕'}
          </button>
        </div>
      </div>
      <div className="file-panel__content" data-fx-ready="">
        {emptyState ? (
          <div className="file-panel__empty">
            <span className="file-panel__empty-icon">
              {emptyState === 'permission' ? '🔒' : '📁'}
            </span>
            <span className="file-panel__empty-text">
              {emptyState === 'permission' ? '无法读取此目录，请检查权限' : '此目录为空'}
            </span>
          </div>
        ) : (
          <FileTreeRows
            entries={entries}
            onItemClick={onItemClick}
            onItemContextMenu={onItemContextMenu}
            onItemDragStart={onItemDragStart}
            onItemDragEnd={onItemDragEnd}
          />
        )}
      </div>
    </div>
  );
}
