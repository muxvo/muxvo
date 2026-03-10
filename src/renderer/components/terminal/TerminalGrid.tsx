/**
 * TerminalGrid — CSS Grid container for multiple terminals
 * DEV-PLAN A4: Uses calculateGridLayout for dynamic row/column calculation
 * DEV-PLAN B1: Focused mode layout (75% main + 25% sidebar)
 *
 * Supports:
 * - Tiling mode with nested row grids (per-row independent column widths)
 * - Resize handles between columns (per-row) and rows
 * - Drag & drop reordering via TerminalTile drag props
 * - Focused mode with sidebar (max 3 visible, scrollable)
 */

/** Sidebar shows at most this many terminals per screen; extras are scrollable */
const MAX_SIDEBAR_VISIBLE = 3;

import { useState, useRef, useCallback, useMemo } from 'react';
import { useI18n } from '@/renderer/i18n';
import { calculateGridLayout, GridLayoutResult } from '@/shared/utils/grid-layout';
import { createGridResizeManager } from '@/renderer/stores/grid-resize';
import { createDragManager } from '@/renderer/stores/drag-manager';
import { TerminalTile } from './TerminalTile';
import { ResizeHandle } from './ResizeHandle';
import { TerminalInfo } from '@/renderer/types/terminal';

interface Props {
  terminals: TerminalInfo[];
  viewMode?: 'Tiling' | 'Focused';
  focusedId?: string | null;
  selectedId?: string | null;
  activeSidebarId?: string | null;
  onDoubleClick?: (id: string) => void;
  onFocusTerminal?: (id: string) => void;
  onSidebarClick?: (id: string) => void;
  onSidebarActivate?: (id: string) => void;
  onSidebarDeactivate?: () => void;
  onClick?: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (newOrder: string[]) => void;
  onRename?: (id: string, name: string) => void;
  onAddTerminal?: () => void;
  maxReached?: boolean;
  onBackToTiling?: () => void;
}

export function TerminalGrid({ terminals, viewMode = 'Tiling', focusedId, selectedId, activeSidebarId, onDoubleClick, onFocusTerminal, onSidebarClick, onSidebarActivate, onSidebarDeactivate, onClick, onClose, onReorder, onRename, onAddTerminal, maxReached, onBackToTiling }: Props): JSX.Element {
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
      activeSidebarId={viewMode === 'Focused' ? activeSidebarId : null}
      onDoubleClick={onDoubleClick}
      onFocusTerminal={onFocusTerminal}
      onSidebarClick={onSidebarClick}
      onSidebarActivate={onSidebarActivate}
      onSidebarDeactivate={onSidebarDeactivate}
      onClick={onClick}
      onClose={onClose}
      onReorder={onReorder}
      onRename={onRename}
      onAddTerminal={onAddTerminal}
      maxReached={maxReached}
      onBackToTiling={onBackToTiling}
    />
  );
}

/** Split terminals into rows based on distribution */
function splitTerminalsIntoRows(terminals: TerminalInfo[], distribution: number[]): TerminalInfo[][] {
  const rows: TerminalInfo[][] = [];
  let offset = 0;
  for (const count of distribution) {
    rows.push(terminals.slice(offset, offset + count));
    offset += count;
  }
  return rows;
}

interface TilingGridProps {
  terminals: TerminalInfo[];
  selectedId?: string | null;
  focusedId?: string | null;
  activeSidebarId?: string | null;
  onDoubleClick?: (id: string) => void;
  onFocusTerminal?: (id: string) => void;
  onSidebarClick?: (id: string) => void;
  onSidebarActivate?: (id: string) => void;
  onSidebarDeactivate?: () => void;
  onClick?: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (newOrder: string[]) => void;
  onRename?: (id: string, name: string) => void;
  onAddTerminal?: () => void;
  maxReached?: boolean;
  onBackToTiling?: () => void;
}

function TilingGrid({ terminals, selectedId, focusedId, activeSidebarId, onDoubleClick, onFocusTerminal, onSidebarClick, onSidebarActivate, onSidebarDeactivate, onClick, onClose, onReorder, onRename, onAddTerminal, maxReached, onBackToTiling }: TilingGridProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const layout = calculateGridLayout(terminals.length);
  const { rows } = layout;

  // Build distribution: how many terminals per row
  const distribution = useMemo(() => {
    if (layout.distribution) return layout.distribution;
    if (layout.rowPattern) return layout.rowPattern;
    // Single row
    return [terminals.length];
  }, [layout, terminals.length]);

  // Resize manager — recreate when grid shape changes
  const resizeManager = useMemo(
    () => createGridResizeManager({ cols: Math.max(...distribution), rows, distribution }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, distribution.join(',')],
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

  // Split terminals into rows
  const terminalRows = useMemo(
    () => splitTerminalsIntoRows(terminals, distribution),
    [terminals, distribution],
  );

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

  const isMultiRow = rows > 1;

  // Row resize handle positions
  const rowHandlePositions = computeHandlePositions(resizeManager.rowRatios);

  // --- Single row layout (1-3 terminals) ---
  if (!isMultiRow) {
    const gridTemplateColumns = resizeManager.perRowColumnRatios[0]?.map((r) => `${r}fr`).join(' ') || '1fr';
    const colHandlePositions = computeHandlePositions(resizeManager.perRowColumnRatios[0] || []);

    const gridStyle: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns,
      gridTemplateRows: '1fr',
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
        {terminals.map((t, i) => {
          const isFocused = isFocusedMode && focusedId === t.id;
          const ds: 'none' | 'dragging' | 'drag-over' =
            t.id === draggingId ? 'dragging' :
            t.id === dragOverId ? 'drag-over' : 'none';

          const cellStyle: React.CSSProperties = isFocusedMode
            ? (isFocused
              ? { position: 'absolute', top: 0, left: 0, right: nonFocusedTerminals.length > 0 ? '25%' : 0, bottom: 0, zIndex: 10, overflow: 'hidden' }
              : { position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' })
            : { gridColumn: `${i + 1}`, minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' };

          return (
            <div key={t.id} style={cellStyle} onClick={isFocused ? () => onSidebarDeactivate?.() : undefined}>
              <TerminalTile
                id={t.id} state={t.state} cwd={t.cwd} customName={t.customName}
                onRename={onRename} selected={!isFocusedMode && t.id === selectedId}
                focused={isFocused} compact={isFocusedMode && !isFocused} staggerIndex={i}
                draggable={!isFocusedMode}
                onDragStart={!isFocusedMode ? handleDragStart : undefined}
                onDragEnd={!isFocusedMode ? handleDragEnd : undefined}
                onDragOver={!isFocusedMode ? handleDragOver : undefined}
                onDrop={!isFocusedMode ? handleDrop : undefined}
                onDragLeave={!isFocusedMode ? handleDragLeave : undefined}
                dragState={!isFocusedMode ? ds : 'none'}
                onDoubleClick={() => onDoubleClick?.(t.id)}
                onFocus={() => onFocusTerminal?.(t.id)}
                onClick={() => onClick?.(t.id)}
                onClose={onClose}
                onBackToTiling={isFocused ? onBackToTiling : undefined}
              />
            </div>
          );
        })}

        {/* Column resize handles */}
        {!isFocusedMode && distribution[0] > 1 && colHandlePositions.map((pct, idx) => (
          <ResizeHandle
            key={`col-0-${idx}`}
            type="col"
            index={idx}
            style={{ left: `${pct}%` }}
            onMouseDown={(e) => {
              const containerWidth = containerRef.current?.clientWidth ?? 0;
              resizeManager.startColResize(0, idx, { clientX: e.clientX }, containerWidth);
              forceUpdate((n) => n + 1);
            }}
            onDoubleClick={() => {
              resizeManager.doubleClickColGap(0, idx);
              forceUpdate((n) => n + 1);
            }}
          />
        ))}

        {/* Focused mode sidebar */}
        {renderFocusedSidebar(isFocusedMode, nonFocusedTerminals, activeSidebarId, onSidebarClick, onSidebarActivate, onSidebarDeactivate, onClose)}

        {/* FAB */}
        {onAddTerminal && (
          <button className="terminal-grid__fab" onClick={onAddTerminal} disabled={maxReached}>+</button>
        )}
      </div>
    );
  }

  // --- Multi-row layout (4+ terminals): nested flex-column + per-row grids ---
  const outerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
    height: '100%',
    position: 'relative',
    cursor: isFocusedMode ? 'default' : resizeManager.cursor,
  };

  // Track cumulative terminal index for staggerIndex
  let globalTileIdx = 0;

  return (
    <div
      ref={containerRef}
      style={outerStyle}
      onMouseMove={isFocusedMode ? undefined : handleMouseMove}
      onMouseUp={isFocusedMode ? undefined : handleMouseUp}
    >
      {terminalRows.map((rowTerminals, rowIdx) => {
        const rowRatios = resizeManager.perRowColumnRatios[rowIdx] || [];
        const gridTemplateColumns = rowRatios.map((r) => `${r}fr`).join(' ') || '1fr';
        const colHandlePositions = computeHandlePositions(rowRatios);
        const rowFlex = resizeManager.rowRatios[rowIdx] ?? 1;

        const rowStyle: React.CSSProperties = {
          display: 'grid',
          gridTemplateColumns,
          gap: '6px',
          flex: rowFlex,
          // In focused mode, use 'static' so that children with position: absolute
          // resolve relative to the outer container (which has position: relative),
          // not the row div. Resize handles (the only reason for 'relative') are
          // hidden in focused mode anyway.
          position: isFocusedMode ? 'static' : 'relative',
          minHeight: 0,
        };

        const startIdx = globalTileIdx;
        globalTileIdx += rowTerminals.length;

        return (
          <div key={`row-${rowIdx}`} style={rowStyle}>
            {rowTerminals.map((t, colIdx) => {
              const tileIdx = startIdx + colIdx;
              const isFocused = isFocusedMode && focusedId === t.id;
              const ds: 'none' | 'dragging' | 'drag-over' =
                t.id === draggingId ? 'dragging' :
                t.id === dragOverId ? 'drag-over' : 'none';

              const cellStyle: React.CSSProperties = isFocusedMode
                ? (isFocused
                  ? { position: 'absolute', top: 0, left: 0, right: nonFocusedTerminals.length > 0 ? '25%' : 0, bottom: 0, zIndex: 10, overflow: 'hidden' }
                  : { position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' })
                : { gridColumn: `${colIdx + 1}`, minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' };

              return (
                <div key={t.id} style={cellStyle} onClick={isFocused ? () => onSidebarDeactivate?.() : undefined}>
                  <TerminalTile
                    id={t.id} state={t.state} cwd={t.cwd} customName={t.customName}
                    onRename={onRename} selected={!isFocusedMode && t.id === selectedId}
                    focused={isFocused} compact={isFocusedMode && !isFocused} staggerIndex={tileIdx}
                    draggable={!isFocusedMode}
                    onDragStart={!isFocusedMode ? handleDragStart : undefined}
                    onDragEnd={!isFocusedMode ? handleDragEnd : undefined}
                    onDragOver={!isFocusedMode ? handleDragOver : undefined}
                    onDrop={!isFocusedMode ? handleDrop : undefined}
                    onDragLeave={!isFocusedMode ? handleDragLeave : undefined}
                    dragState={!isFocusedMode ? ds : 'none'}
                    onDoubleClick={() => onDoubleClick?.(t.id)}
                    onFocus={() => onFocusTerminal?.(t.id)}
                    onClick={() => onClick?.(t.id)}
                    onClose={onClose}
                    onBackToTiling={isFocused ? onBackToTiling : undefined}
                  />
                </div>
              );
            })}

            {/* Per-row column resize handles */}
            {!isFocusedMode && rowTerminals.length > 1 && colHandlePositions.map((pct, idx) => (
              <ResizeHandle
                key={`col-${rowIdx}-${idx}`}
                type="col"
                index={idx}
                style={{ left: `${pct}%` }}
                onMouseDown={(e) => {
                  const rowEl = e.currentTarget.parentElement;
                  const containerWidth = rowEl?.clientWidth ?? 0;
                  resizeManager.startColResize(rowIdx, idx, { clientX: e.clientX }, containerWidth);
                  forceUpdate((n) => n + 1);
                }}
                onDoubleClick={() => {
                  resizeManager.doubleClickColGap(rowIdx, idx);
                  forceUpdate((n) => n + 1);
                }}
              />
            ))}
          </div>
        );
      })}

      {/* Row resize handles (between rows) */}
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

      {/* Focused mode sidebar */}
      {renderFocusedSidebar(isFocusedMode, nonFocusedTerminals, activeSidebarId, onSidebarClick, onSidebarActivate, onSidebarDeactivate, onClose)}

      {/* FAB */}
      {onAddTerminal && (
        <button className="terminal-grid__fab" onClick={onAddTerminal} disabled={maxReached}>+</button>
      )}
    </div>
  );
}

/** Render focused mode sidebar (shared between single-row and multi-row) */
function renderFocusedSidebar(
  isFocusedMode: boolean,
  nonFocusedTerminals: TerminalInfo[],
  activeSidebarId: string | null | undefined,
  onSidebarClick?: (id: string) => void,
  onSidebarActivate?: (id: string) => void,
  onSidebarDeactivate?: () => void,
  onClose?: (id: string) => void,
): JSX.Element | null {
  if (!isFocusedMode || nonFocusedTerminals.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        width: '25%',
        top: 0,
        bottom: 0,
        overflowY: 'auto',
        zIndex: 11,
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSidebarDeactivate?.();
      }}
    >
      {nonFocusedTerminals.map((t) => {
        const isActivated = activeSidebarId === t.id;
        const visibleCount = Math.min(nonFocusedTerminals.length, MAX_SIDEBAR_VISIBLE);
        return (
          <div
            key={t.id}
            className={isActivated ? 'sidebar-tile--active' : undefined}
            style={{
              height: `${100 / visibleCount}%`,
              minHeight: '150px',
              flexShrink: 0,
              position: 'relative',
              borderLeft: isActivated ? '2px solid var(--accent)' : '1px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <TerminalTile
              id={t.id}
              state={t.state}
              cwd={t.cwd}
              customName={t.customName}
              compact
              onClose={onClose}
              onSidebarSwitch={() => onSidebarClick?.(t.id)}
            />
            {/* Smart overlay: always present, behavior varies by activation state */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                pointerEvents: 'auto',
                cursor: isActivated ? 'text' : 'default',
                background: isActivated ? 'transparent' : 'rgba(0,0,0,0.03)',
                transition: 'background 150ms ease',
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (isActivated) {
                  window.dispatchEvent(new CustomEvent('muxvo:terminal-focus', { detail: t.id }));
                } else {
                  onSidebarActivate?.(t.id);
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onSidebarClick?.(t.id);
              }}
              onWheel={(e) => {
                if (isActivated) {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('muxvo:terminal-scroll', {
                    detail: { id: t.id, deltaY: e.deltaY },
                  }));
                }
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Compute grid placement for each tile based on layout result (kept for test compatibility) */
export function computeTilePlacements(layout: GridLayoutResult, count: number): Array<{ gridRow: string; gridColumn: string }> {
  const { cols, rowPattern, spanRow, distribution, lastRowCentered } = layout;
  const placements: Array<{ gridRow: string; gridColumn: string }> = [];

  if (rowPattern && spanRow) {
    let tileIdx = 0;
    for (let rowIdx = 0; rowIdx < rowPattern.length; rowIdx++) {
      const rowCount = rowPattern[rowIdx];
      const span = spanRow[rowIdx] || 1;
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
    let tileIdx = 0;
    for (let rowIdx = 0; rowIdx < distribution.length; rowIdx++) {
      const rowCount = distribution[rowIdx];
      const isLastRow = rowIdx === distribution.length - 1;
      for (let colIdx = 0; colIdx < rowCount; colIdx++) {
        if (isLastRow && lastRowCentered && rowCount < cols) {
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
