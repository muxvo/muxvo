/**
 * 文件树行渲染段（从 FilePanelView 抽出的 `.file-item` 行循环，file-panel 与 filetabs 左树共用）。
 *
 * DOM 恒等契约：`activeFilePath` 缺省时 className 与抽出前的模板字面量逐字节一致
 * （`['file-item', folder?, active?].filter(Boolean).join(' ')` ⇒ 无 active 段即 `file-item`[` file-item--folder`]）。
 * 回调全可选：未传不挂监听（复刻屏/静态左树 DOM 无差异）。
 */

import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { fileIcon, type FlatEntry } from './file-tree-static';

interface FileTreeRowsProps {
  entries: FlatEntry[];
  /** 当前活跃文件行高亮（file-item--active）；file-panel 不传 → 无高亮，DOM 恒等 */
  activeFilePath?: string | null;
  onItemClick?: (entry: FlatEntry) => void;
  onItemContextMenu?: (entry: FlatEntry, e: ReactMouseEvent) => void;
  onItemDragStart?: (path: string, e: ReactDragEvent) => void;
  onItemDragEnd?: () => void;
}

export function FileTreeRows({
  entries,
  activeFilePath,
  onItemClick,
  onItemContextMenu,
  onItemDragStart,
  onItemDragEnd,
}: FileTreeRowsProps): JSX.Element {
  return (
    <>
      {entries.map((entry) => (
        <div
          key={entry.path}
          className={[
            'file-item',
            entry.type === 'folder' ? 'file-item--folder' : '',
            activeFilePath != null && entry.path === activeFilePath ? 'file-item--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: 8 + entry.indent * 20 }}
          draggable
          onClick={onItemClick ? () => onItemClick(entry) : undefined}
          onContextMenu={onItemContextMenu ? (e) => onItemContextMenu(entry, e) : undefined}
          onDragStart={
            onItemDragStart
              ? (e) => {
                  e.dataTransfer.setData('application/x-muxvo-path', entry.path);
                  e.dataTransfer.setData('text/plain', entry.path);
                  e.dataTransfer.effectAllowed = 'copy';
                  onItemDragStart(entry.path, e);
                }
              : undefined
          }
          onDragEnd={onItemDragEnd ? () => onItemDragEnd() : undefined}
        >
          <span className="file-item__icon">{fileIcon(entry.type, entry.ext, entry.expanded)}</span>
          <span className="file-item__name">{entry.name}</span>
          {entry.meta && <span className="file-item__meta">{entry.meta}</span>}
        </div>
      ))}
    </>
  );
}
