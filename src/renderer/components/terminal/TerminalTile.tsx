/**
 * TerminalTile — Single terminal tile with status indicator + xterm rendering area
 * DEV-PLAN A4: Terminal tile component
 * DEV-PLAN B2/B3: Focus mode interactions + visual effects
 * Module I: I1 Tile Header改造 + I4 自定义名称编辑
 *
 * Aligned with prototype-history-A.html tile design.
 */

import { useState, useRef, memo, useCallback } from 'react';
import { XTermRenderer } from './XTermRenderer';
import { TileHeader } from './TileHeader';
import { useNaming } from '@/renderer/hooks/useNaming';
import './TileEffects.css';

interface Props {
  id: string;
  state: string;
  cwd: string;
  onDoubleClick?: () => void;
  onClick?: () => void;
  onClose?: (id: string) => void;
  compact?: boolean;
  focused?: boolean;
  selected?: boolean;
  staggerIndex?: number;
  draggable?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (id: string) => void;
  onDrop?: (id: string) => void;
  onDragLeave?: () => void;
  dragState?: 'none' | 'dragging' | 'drag-over';
  customName?: string;
  onRename?: (id: string, name: string) => void;
}

function TerminalTileInner({
  id,
  state,
  cwd,
  onDoubleClick,
  onClick,
  onClose,
  compact,
  focused,
  selected,
  staggerIndex,
  draggable: draggableProp,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDragLeave,
  dragState = 'none',
  customName,
  onRename
}: Props): JSX.Element {
  const tileRef = useRef<HTMLDivElement>(null);
  const naming = useNaming(id, customName, onRename);

  // Remove tile-enter class after entrance animation completes.
  // tile-enter's animation (tileEnter 0.6s + stagger delay) permanently overrides
  // tile--waiting's borderGlow animation due to CSS cascade order (same specificity,
  // tile-enter appears later in stylesheet). Removing it allows borderGlow to work.
  const [entered, setEntered] = useState(compact ?? false);
  const handleAnimationEnd = useCallback((e: React.AnimationEvent) => {
    if (e.animationName === 'tileEnter') setEntered(true);
  }, []);

  // Mouse tracking for gloss effect
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!tileRef.current || compact) return;
    const rect = tileRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    tileRef.current.style.setProperty('--mx', `${x}%`);
    tileRef.current.style.setProperty('--my', `${y}%`);
  };

  // Drag: disable in focused/compact mode
  const isDraggable = draggableProp && !focused && !compact;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    onDragStart?.(id);
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  const handleDragOver = (e: React.DragEvent) => {
    // Skip file drags — let XTermRenderer handle them
    if (e.dataTransfer.types.includes('Files') ||
        e.dataTransfer.types.includes('application/x-muxvo-file-paths')) {
      return;
    }
    e.preventDefault();
    onDragOver?.(id);
  };

  const handleDrop = (e: React.DragEvent) => {
    // Skip file drags — let XTermRenderer handle them
    if (e.dataTransfer.types.includes('Files') ||
        e.dataTransfer.types.includes('application/x-muxvo-file-paths')) {
      return;
    }
    e.preventDefault();
    onDrop?.(id);
  };

  const handleDragLeave = () => {
    onDragLeave?.();
  };

  const classNames = [
    'tile',
    !compact && !entered ? 'tile-enter' : '',
    focused ? 'tile-focused' : '',
    selected ? 'tile-selected' : '',
    state === 'WaitingInput' ? 'tile--waiting' : '',
    dragState === 'dragging' ? 'dragging' : '',
    dragState === 'drag-over' ? 'drag-over' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={tileRef}
      className={classNames}
      style={{
        '--stagger-index': staggerIndex ?? 0,
      } as React.CSSProperties}
      onDoubleClick={onDoubleClick}
      onMouseDown={onClick}
      onAnimationEnd={handleAnimationEnd}
      onMouseMove={handleMouseMove}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={handleDragLeave}
    >
      <TileHeader
        id={id}
        state={state}
        cwd={cwd}
        compact={compact}
        focused={focused}
        isDraggable={!!isDraggable}
        naming={naming}
        onDragStart={handleDragStart}
        onDoubleClick={onDoubleClick}
        onClose={onClose}
      />

      {/* Terminal content */}
      <div className="tile-terminal" onClick={compact ? (e) => e.stopPropagation() : undefined}>
        <XTermRenderer terminalId={id} />
      </div>
    </div>
  );
}

export const TerminalTile = memo(TerminalTileInner, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.state === next.state &&
    prev.cwd === next.cwd &&
    prev.compact === next.compact &&
    prev.focused === next.focused &&
    prev.selected === next.selected &&
    prev.staggerIndex === next.staggerIndex &&
    prev.draggable === next.draggable &&
    prev.dragState === next.dragState &&
    prev.customName === next.customName
  );
});
