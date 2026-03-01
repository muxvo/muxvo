/**
 * TerminalGrid — CSS Grid container for multiple terminals
 * DEV-PLAN A4: Uses calculateGridLayout for dynamic row/column calculation
 * DEV-PLAN B1: Focused mode layout (75% main + 25% sidebar)
 *
 * Supports:
 * - Tiling mode with dynamic grid layout (rowPattern/spanRow for centering)
 * - Resize handles between columns/rows via grid-resize manager
 * - Drag & drop reordering via TerminalTile drag props
 * - Focused mode with sidebar (max 3 visible, scrollable)
 */

/** Sidebar shows at most this many terminals per screen; extras are scrollable */
const MAX_SIDEBAR_VISIBLE = 3;

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useI18n } from '@/renderer/i18n';
import { calculateGridLayout, GridLayoutResult } from '@/shared/utils/grid-layout';
import { createGridResizeManager } from '@/renderer/stores/grid-resize';
import { createDragManager } from '@/renderer/stores/drag-manager';
import { TerminalTile } from './TerminalTile';
import { TerminalChatSidebar } from './TerminalChatSidebar';
import { ResizeHandle } from './ResizeHandle';
import { TerminalInfo } from '@/renderer/types/terminal';

interface Props {
  terminals: TerminalInfo[];
  viewMode?: 'Tiling' | 'Focused';
  focusedId?: string | null;
  selectedId?: string | null;
  chatSidebarTerminalId?: string | null;
  onCloseChatSidebar?: () => void;
  onDoubleClick?: (id: string) => void;
  onSidebarClick?: (id: string) => void;
  onClick?: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (newOrder: string[]) => void;
  onRename?: (id: string, name: string) => void;
  onAddTerminal?: () => void;
  maxReached?: boolean;
}

export function TerminalGrid({ terminals, viewMode = 'Tiling', focusedId, selectedId, chatSidebarTerminalId, onCloseChatSidebar, onDoubleClick, onSidebarClick, onClick, onClose, onReorder, onRename, onAddTerminal, maxReached }: Props): JSX.Element {
  const { t } = useI18n();
  if (terminals.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        color: 'var(--text-secondary)',
        fontSize: '13px',
        position: 'relative',
      }}>
        {t('terminal.noTerminals')}
        {onAddTerminal && (
          <button className="terminal-grid__fab" onClick={onAddTerminal} disabled={maxReached} title={t('menu.newTerminal')}>+</button>
        )}
      </div>
    );
  }

  // Always render TilingGrid — focused mode is handled via CSS overlay
  // to avoid unmounting/remounting XTermRenderer instances.
  // NOTE: TilingGrid renders its own FAB inside, sharing the same .terminal-grid__fab class.
  return (
    <TilingGrid
      terminals={terminals}
      selectedId={selectedId}
      focusedId={viewMode === 'Focused' ? focusedId : null}
      chatSidebarTerminalId={viewMode === 'Focused' ? null : chatSidebarTerminalId}
      onCloseChatSidebar={onCloseChatSidebar}
      onDoubleClick={onDoubleClick}
      onSidebarClick={onSidebarClick}
      onClick={onClick}
      onClose={onClose}
      onReorder={onReorder}
      onRename={onRename}
      onAddTerminal={onAddTerminal}
      maxReached={maxReached}
    />
  );
}

/** Compute grid placement for each tile based on layout result */
export function computeTilePlacements(layout: GridLayoutResult, count: number): Array<{ gridRow: string; gridColumn: string }> {
  const { cols, rowPattern, spanRow, distribution, lastRowCentered } = layout;
  const placements: Array<{ gridRow: string; gridColumn: string }> = [];

  if (rowPattern && spanRow) {
    // Explicit rowPattern mode (e.g. 5 terminals: [3,2] with spans {0:2, 1:3})
    let tileIdx = 0;
    for (let rowIdx = 0; rowIdx < rowPattern.length; rowIdx++) {
      const rowCount = rowPattern[rowIdx];
      const span = spanRow[rowIdx] || 1;
      // Center tiles: startCol = floor((cols - rowCount*span) / 2) + 1 (1-indexed)
      const totalSpan = rowCount * span;
      const startOffset = Math.floor((cols - totalSpan) / 2);
      for (let colIdx = 0; colIdx < rowCount; colIdx++) {
        const colStart = startOffset + colIdx * span + 1;
        placements.push({
          gridRow: `${rowIdx + 1}`,
          gridColumn: span > 1 ? `${colStart} / span ${span}` : `${colStart}`,
        });
        tileIdx++;
      }
    }
  } else if (distribution) {
    // Distribution mode: each row has a known count, items fill from left
    let tileIdx = 0;
    for (let rowIdx = 0; rowIdx < distribution.length; rowIdx++) {
      const rowCount = distribution[rowIdx];
      const isLastRow = rowIdx === distribution.length - 1;
      for (let colIdx = 0; colIdx < rowCount; colIdx++) {
        if (isLastRow && lastRowCentered && rowCount < cols) {
          // Center last row items using span to fill evenly
          // For last row with fewer items, each item spans floor(cols/rowCount) cols
          const spanSize = Math.floor(cols / rowCount);
          const totalUsed = spanSize * rowCount;
          const offset = Math.floor((cols - totalUsed) / 2);
          const colStart = offset + colIdx * spanSize + 1;
          placements.push({
            gridRow: `${rowIdx + 1}`,
            gridColumn: `${colStart} / span ${spanSize}`,
          });
        } else {
          placements.push({
            gridRow: `${rowIdx + 1}`,
            gridColumn: `${colIdx + 1}`,
          });
        }
        tileIdx++;
      }
    }
  } else {
    // Simple grid: fill left-to-right, top-to-bottom
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols) + 1;
      const col = (i % cols) + 1;
      placements.push({
        gridRow: `${row}`,
        gridColumn: `${col}`,
      });
    }
  }

  return placements;
}

interface TilingGridProps {
  terminals: TerminalInfo[];
  selectedId?: string | null;
  focusedId?: string | null;
  chatSidebarTerminalId?: string | null;
  onCloseChatSidebar?: () => void;
  onDoubleClick?: (id: string) => void;
  onSidebarClick?: (id: string) => void;
  onClick?: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (newOrder: string[]) => void;
  onRename?: (id: string, name: string) => void;
  onAddTerminal?: () => void;
  maxReached?: boolean;
}

function TilingGrid({ terminals, selectedId, focusedId, chatSidebarTerminalId, onCloseChatSidebar, onDoubleClick, onSidebarClick, onClick, onClose, onReorder, onRename, onAddTerminal, maxReached }: TilingGridProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const layout = calculateGridLayout(terminals.length);
  const { cols, rows } = layout;

  // Resize manager — recreate when grid shape changes
  const resizeManager = useMemo(
    () => createGridResizeManager({ cols, rows }),
    [cols, rows],
  );

  // Force re-render when ratios change during resize
  const [, forceUpdate] = useState(0);

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Mouse handlers for resize (attached to container)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    resizeManager.moveResize({ clientX: e.clientX, clientY: e.clientY });
    forceUpdate((n) => n + 1);
  }, [resizeManager]);

  const handleMouseUp = useCallback(() => {
    resizeManager.endResize();
    resizeManager.cursor = 'default';
    forceUpdate((n) => n + 1);
  }, [resizeManager]);

  // Compute grid template strings from ratios
  const gridTemplateColumns = resizeManager.columnRatios.map((r) => `${r}fr`).join(' ');
  const gridTemplateRows = resizeManager.rowRatios.map((r) => `${r}fr`).join(' ');

  // Compute tile placements
  const placements = computeTilePlacements(layout, terminals.length);

  // Resize handle positions: compute cumulative percentages for positioning
  const colHandlePositions = computeHandlePositions(resizeManager.columnRatios);
  const rowHandlePositions = computeHandlePositions(resizeManager.rowRatios);

  // Drag handlers
  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const handleDragOver = useCallback((id: string) => {
    setDragOverId(id);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const dm = createDragManager({ order: terminals.map((t) => t.id) });
    dm.startDrag(draggingId);
    dm.dropBefore(targetId);
    onReorder?.(dm.order);
    setDraggingId(null);
    setDragOverId(null);
  }, [draggingId, terminals, onReorder]);

  const isFocusedMode = !!focusedId;
  const nonFocusedTerminals = isFocusedMode
    ? terminals.filter((t) => t.id !== focusedId)
    : [];

  // Virtual sidebar scroll: wheel events control which 3 terminals are visible
  const [sidebarOffset, setSidebarOffset] = useState(0);
  useEffect(() => { setSidebarOffset(0); }, [focusedId]);

  const handleSidebarWheel = useCallback((e: React.WheelEvent) => {
    const maxOffset = Math.max(0, nonFocusedTerminals.length - MAX_SIDEBAR_VISIBLE);
    if (maxOffset === 0) return;
    if (e.deltaY > 0) setSidebarOffset((prev) => Math.min(prev + 1, maxOffset));
    else if (e.deltaY < 0) setSidebarOffset((prev) => Math.max(prev - 1, 0));
  }, [nonFocusedTerminals.length]);

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns,
    gridTemplateRows,
    gap: '6px',
    padding: '0',
    width: '100%',
    height: '100%',
    position: 'relative',
    cursor: isFocusedMode ? 'default' : resizeManager.cursor,
  };

  return (
    <div
      ref={containerRef}
      style={gridStyle}
      onMouseMove={isFocusedMode ? undefined : handleMouseMove}
      onMouseUp={isFocusedMode ? undefined : handleMouseUp}
    >
      {/* Single terminals.map() — mode switching only changes CSS, never unmounts */}
      {terminals.map((t, i) => {
        const isFocused = isFocusedMode && focusedId === t.id;
        const placement = placements[i];
        const ds: 'none' | 'dragging' | 'drag-over' =
          t.id === draggingId ? 'dragging' :
          t.id === dragOverId ? 'drag-over' : 'none';

        let cellStyle: React.CSSProperties;

        if (isFocusedMode && isFocused) {
          // Focused terminal: left 75% (or 100% if no sidebar)
          cellStyle = {
            position: 'absolute',
            top: 0,
            left: 0,
            right: nonFocusedTerminals.length > 0 ? '25%' : 0,
            bottom: 0,
            zIndex: 10,
            overflow: 'hidden',
          };
        } else if (isFocusedMode) {
          // Sidebar terminal: right 25%, virtual scroll controls visibility
          const sidebarIndex = nonFocusedTerminals.findIndex((s) => s.id === t.id);
          const isVisible = sidebarIndex >= sidebarOffset
            && sidebarIndex < sidebarOffset + MAX_SIDEBAR_VISIBLE;

          if (isVisible) {
            const visibleIndex = sidebarIndex - sidebarOffset;
            cellStyle = {
              position: 'absolute',
              right: 0,
              width: '25%',
              top: `${visibleIndex * (100 / MAX_SIDEBAR_VISIBLE)}%`,
              height: `${100 / MAX_SIDEBAR_VISIBLE}%`,
              zIndex: 11,
              overflow: 'hidden',
              borderLeft: '1px solid var(--border)',
            };
          } else {
            // Hidden but alive — no unmount, ResizeObserver guard prevents PTY resize
            cellStyle = {
              position: 'absolute',
              width: 0,
              height: 0,
              overflow: 'hidden',
              opacity: 0,
              pointerEvents: 'none',
            };
          }
        } else {
          // Tiling mode: normal grid placement
          cellStyle = {
            gridRow: placement?.gridRow,
            gridColumn: placement?.gridColumn,
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
          };
        }

        const hasChatSidebar = !isFocusedMode && chatSidebarTerminalId === t.id;

        // When chat sidebar is open, wrap tile + sidebar in a flex row container
        const outerStyle: React.CSSProperties = hasChatSidebar
          ? { ...cellStyle, display: 'flex', flexDirection: 'row' }
          : cellStyle;

        return (
          <div
            key={t.id}
            style={outerStyle}
            onClick={isFocusedMode && !isFocused ? () => onSidebarClick?.(t.id) : undefined}
            onWheel={isFocusedMode && !isFocused ? handleSidebarWheel : undefined}
          >
            <div style={hasChatSidebar
              ? { flex: '0 0 50%', minWidth: 0, overflow: 'hidden', height: '100%' }
              : { width: '100%', height: '100%' }
            }>
              <TerminalTile
                id={t.id}
                state={t.state}
                cwd={t.cwd}
                customName={t.customName}
                onRename={onRename}
                selected={!isFocusedMode && t.id === selectedId}
                focused={isFocused}
                compact={isFocusedMode && !isFocused}
                staggerIndex={i}
                draggable={!isFocusedMode}
                onDragStart={!isFocusedMode ? handleDragStart : undefined}
                onDragEnd={!isFocusedMode ? handleDragEnd : undefined}
                onDragOver={!isFocusedMode ? handleDragOver : undefined}
                onDrop={!isFocusedMode ? handleDrop : undefined}
                onDragLeave={!isFocusedMode ? handleDragLeave : undefined}
                dragState={!isFocusedMode ? ds : 'none'}
                onDoubleClick={() => onDoubleClick?.(t.id)}
                onClick={() => onClick?.(t.id)}
                onClose={onClose}
              />
            </div>
            {hasChatSidebar && (
              <div style={{ flex: '0 0 50%', minWidth: 0, overflow: 'hidden', height: '100%' }}>
                <TerminalChatSidebar
                  terminalId={t.id}
                  cwd={t.cwd}
                  onClose={() => onCloseChatSidebar?.()}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Column resize handles (tiling mode only) */}
      {!isFocusedMode && cols > 1 && colHandlePositions.map((pct, idx) => (
        <ResizeHandle
          key={`col-${idx}`}
          type="col"
          index={idx}
          style={{ left: `${pct}%` }}
          onMouseDown={(e) => {
            const containerWidth = containerRef.current?.clientWidth ?? 0;
            resizeManager.startColResize(idx, { clientX: e.clientX }, containerWidth);
            forceUpdate((n) => n + 1);
          }}
          onDoubleClick={() => {
            resizeManager.doubleClickColGap(idx);
            forceUpdate((n) => n + 1);
          }}
        />
      ))}

      {/* Row resize handles (tiling mode only) */}
      {!isFocusedMode && rows > 1 && rowHandlePositions.map((pct, idx) => (
        <ResizeHandle
          key={`row-${idx}`}
          type="row"
          index={idx}
          style={{ top: `${pct}%` }}
          onMouseDown={(e) => {
            const containerHeight = containerRef.current?.clientHeight ?? 0;
            resizeManager.startRowResize(idx, { clientY: e.clientY }, containerHeight);
            forceUpdate((n) => n + 1);
          }}
          onDoubleClick={() => {
            resizeManager.doubleClickRowGap(idx);
            forceUpdate((n) => n + 1);
          }}
        />
      ))}

      {/* FAB: Add terminal */}
      {onAddTerminal && (
        <button className="terminal-grid__fab" onClick={onAddTerminal} disabled={maxReached}>+</button>
      )}
    </div>
  );
}

/** Compute handle positions as percentages (between adjacent items) */
export function computeHandlePositions(ratios: number[]): number[] {
  const positions: number[] = [];
  const total = ratios.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  for (let i = 0; i < ratios.length - 1; i++) {
    cumulative += ratios[i];
    positions.push((cumulative / total) * 100);
  }
  return positions;
}
