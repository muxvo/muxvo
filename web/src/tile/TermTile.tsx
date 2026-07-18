/**
 * 终端 Tile（spec §3）：header + 内容区。
 * 视觉态全集 = 状态点 3 态 × 装饰态（selected/focused）+ 瞬时态（dragging/drag-over）。
 */

import { useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { TermCommandRequest, UIAction } from '../bridge/gen/protocol';
import type { Fixture, TerminalFixture } from '../fixture/types';
import { TileHeader } from './TileHeader';
import { TermContent } from './TermContent';
import { useLiveInteractions } from '../screen/live/LiveInteractions';

const FILE_DRAG_TYPE = 'application/x-muxvo-path';

interface Props {
  terminal: TerminalFixture;
  fx: Fixture;
  compact?: boolean;
  focused?: boolean;
  selected?: boolean;
  dragState?: 'none' | 'dragging' | 'drag-over';
  showSidebarSwitch?: boolean;
  /** 洞分支角色（草案 §3.1）：sidebar 预览 = sidebarPreview，其余（平铺/主屏）= grid。 */
  role?: 'grid' | 'sidebarPreview';
  /** 桥线缆（M3 全 union）。未传时连监听都不挂——截图/纯展示路径 DOM 零差异 */
  onAction?: (action: UIAction) => void;
  /** term.command 线缆（close #4）。未传不挂监听。 */
  onTermCommand?: (req: TermCommandRequest) => void;
}

export function TermTile({
  terminal,
  fx,
  compact,
  focused,
  selected,
  dragState = 'none',
  showSidebarSwitch,
  role = 'grid',
  onAction,
  onTermCommand,
}: Props): JSX.Element {
  const live = useLiveInteractions();
  // 文件拖入高亮（仅 live，REQ-020）：靶只认 application/x-muxvo-path；重排拖只 set text/plain → 不命中，
  // 且 useGridInteractions 全程以 draggingRef 守门（文件拖不经 onTileDragStart → draggingId 恒 null）→ 双向隔离。
  const [fileDrop, setFileDrop] = useState(false);
  const onFileDragOver = live
    ? (e: ReactDragEvent<HTMLDivElement>): void => {
        if (!e.dataTransfer.types.includes(FILE_DRAG_TYPE)) return; // 重排拖/外部拖不响应
        e.preventDefault(); // 允许 drop
        setFileDrop(true);
      }
    : undefined;
  const onFileDragLeave = live ? (): void => setFileDrop(false) : undefined;
  const onFileDrop = live
    ? (e: ReactDragEvent<HTMLDivElement>): void => {
        const path = e.dataTransfer.getData(FILE_DRAG_TYPE);
        setFileDrop(false);
        if (!path) return;
        e.preventDefault();
        live.insertPath(terminal.id, path);
      }
    : undefined;
  // 关闭中（Stopping，用户主动关闭 ~2s 窗口，DOGFOOD_M3_09）：仅 live 门控——截图/纯展示恒 false，
  // golden 逐字节不变（fixtures.json 含大量 Stopped tile，无 Stopping，且无 live provider）。
  const stopping = !!live && terminal.state === 'Stopping';

  const classNames = [
    'tile',
    focused ? 'tile-focused' : '',
    selected ? 'tile-selected' : '',
    terminal.state === 'WaitingInput' ? 'tile--waiting' : '',
    stopping ? 'tile--stopping' : '',
    dragState === 'dragging' ? 'dragging' : '',
    dragState === 'drag-over' ? 'drag-over' : '',
    fileDrop ? 'tile--file-drop' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const editingValue =
    !compact && fx.editing && fx.editing.id === terminal.id ? fx.editing.value : null;

  return (
    <div
      className={classNames}
      // 浮层锚定按 ID 查询（LiveWorktreePopover/LiveSearchBar）：收起/重排后 `.tile` DOM 集合
      // 与 fx.terminals 全量下标不再对齐，下标索引会错位。data-* 不改渲染像素，golden 不变。
      data-terminal-id={terminal.id}
      onClick={onAction ? () => onAction({ kind: 'tileClick', terminalId: terminal.id }) : undefined}
      onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave}
      onDrop={onFileDrop}
    >
      <TileHeader
        terminal={terminal}
        homePath={fx.homePath}
        compact={compact}
        focused={focused}
        editingValue={editingValue}
        showSidebarSwitch={showSidebarSwitch}
        draggable={!compact && !focused}
        onAction={onAction}
        onTermCommand={onTermCommand}
      />
      <div className="tile-terminal">
        {/* content 缺席（真状态源）→ TermContent 走透明洞分支；一切 fixture 恒有 content */}
        <TermContent
          lines={terminal.content}
          palette={fx.palette}
          holeId={terminal.id}
          holeRole={role}
        />
      </div>
      {/* 关闭中浮层（DOGFOOD_M3_09，仅 live）：暗罩 + 「关闭中…」；data-hit-island = 浮层岛约定，
          native 从穿透区抠掉 → 垂死终端不吃点击（洞 rect 仍在，surface 不 detach、画面连续）。 */}
      {stopping && (
        <div className="tile-closing-overlay" data-hit-island="">
          关闭中…
        </div>
      )}
    </div>
  );
}
