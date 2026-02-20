/**
 * TerminalGrid — CSS Grid container for multiple terminals
 * DEV-PLAN A4: Uses calculateGridLayout for dynamic row/column calculation
 * DEV-PLAN B1: Focused mode layout (75% main + 25% sidebar)
 *
 * Supports:
 * - Tiling mode with dynamic grid layout (rowPattern/spanRow for centering)
 * - Resize handles between columns/rows via grid-resize manager
 * - Drag & drop reordering via TerminalTile drag props
 * - Focused mode with sidebar (unchanged)
 */

import { useState, useRef, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';
import { calculateGridLayout, GridLayoutResult } from '@/shared/utils/grid-layout';
import { createGridResizeManager } from '@/renderer/stores/grid-resize';
import { createDragManager } from '@/renderer/stores/drag-manager';
import { TerminalTile } from './TerminalTile';
import { ResizeHandle } from './ResizeHandle';

interface TerminalInfo {
  id: string;
  state: string;
  cwd: string;
}

interface Props {
  terminals: TerminalInfo[];
  viewMode?: 'Tiling' | 'Focused';
  focusedId?: string | null;
  selectedId?: string | null;
  onDoubleClick?: (id: string) => void;
  onSidebarClick?: (id: string) => void;
  onClick?: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (newOrder: string[]) => void;
}

export function TerminalGrid({ terminals, viewMode = 'Tiling', focusedId, selectedId, onDoubleClick, onSidebarClick, onClick, onClose, onReorder }: Props): JSX.Element {
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
      }}>
        {t('terminal.noTerminals')}
      </div>
    );
  }

  // Focused mode layout
  if (viewMode === 'Focused' && focusedId) {
    const focusedTerminal = terminals.find((t) => t.id === focusedId);
    const sidebarTerminals = terminals.filter((t) => t.id !== focusedId);

    if (!focusedTerminal) {
      // Fallback to tiling if focused terminal not found
      return (
        <TilingGrid
          terminals={terminals}
          selectedId={selectedId}
          onDoubleClick={onDoubleClick}
          onClick={onClick}
          onClose={onClose}
          onReorder={onReorder}
        />
      );
    }

    return (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* Left: focused terminal 75% */}
        <div style={{ width: '75%', height: '100%' }}>
          <TerminalTile key={focusedId} id={focusedId} state={focusedTerminal.state} cwd={focusedTerminal.cwd} focused onClose={onClose} />
        </div>
        {/* Right: sidebar 25% */}
        <div style={{
          width: '25%',
          height: '100%',
          overflowY: 'auto',
          borderLeft: '1px solid var(--border)',
        }}>
          {sidebarTerminals.map((t) => (
            <div
              key={t.id}
              style={{
                height: `${100 / Math.min(sidebarTerminals.length, 3)}%`,
                minHeight: '150px',
                cursor: 'pointer',
              }}
              onClick={() => onSidebarClick?.(t.id)}
            >
              <TerminalTile id={t.id} state={t.state} cwd={t.cwd} compact />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Tiling mode (default)
  return (
    <TilingGrid
      terminals={terminals}
      selectedId={selectedId}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      onClose={onClose}
      onReorder={onReorder}
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
  onDoubleClick?: (id: string) => void;
  onClick?: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (newOrder: string[]) => void;
}

function TilingGrid({ terminals, selectedId, onDoubleClick, onClick, onClose, onReorder }: TilingGridProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const layout = calculateGridLayout(terminals.length);
  const { cols, rows } = layout;

  // Resize manager — recreate when grid shape changes
  const resizeRef = useRef<ReturnType<typeof createGridResizeManager> | null>(null);
  const prevShapeRef = useRef<string>('');
  const shapeKey = `${cols}x${rows}`;

  if (shapeKey !== prevShapeRef.current) {
    resizeRef.current = createGridResizeManager({ cols, rows });
    prevShapeRef.current = shapeKey;
  }

  const resizeManager = resizeRef.current!;

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

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns,
    gridTemplateRows,
    gap: '6px',
    padding: '6px',
    width: '100%',
    height: '100%',
    perspective: '1200px',
    position: 'relative',
    cursor: resizeManager.cursor,
  };

  return (
    <div
      ref={containerRef}
      style={gridStyle}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {terminals.map((t, i) => {
        const placement = placements[i];
        const ds: 'none' | 'dragging' | 'drag-over' =
          t.id === draggingId ? 'dragging' :
          t.id === dragOverId ? 'drag-over' : 'none';

        return (
          <div
            key={t.id}
            style={{
              gridRow: placement?.gridRow,
              gridColumn: placement?.gridColumn,
              minWidth: 0,
              minHeight: 0,
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <TerminalTile
              id={t.id}
              state={t.state}
              cwd={t.cwd}
              selected={t.id === selectedId}
              staggerIndex={i}
              draggable
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragLeave={handleDragLeave}
              dragState={ds}
              onDoubleClick={() => onDoubleClick?.(t.id)}
              onClick={() => onClick?.(t.id)}
              onClose={onClose}
            />
          </div>
        );
      })}

      {/* Column resize handles */}
      {cols > 1 && colHandlePositions.map((pct, idx) => (
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

      {/* Row resize handles */}
      {rows > 1 && rowHandlePositions.map((pct, idx) => (
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
