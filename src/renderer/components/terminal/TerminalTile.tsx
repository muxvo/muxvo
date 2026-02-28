/**
 * TerminalTile — Single terminal tile with status indicator + xterm rendering area
 * DEV-PLAN A4: Terminal tile component
 * DEV-PLAN B2/B3: Focus mode interactions + visual effects
 * Module I: I1 Tile Header改造 + I4 自定义名称编辑
 *
 * Aligned with prototype-history-A.html tile design.
 */

import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';
import { XTermRenderer } from './XTermRenderer';
import { getTerminalProcessUI } from '@/renderer/stores/terminal-process-ui-map';
import { createNamingMachine } from '@/shared/machines/terminal-naming';
import { CwdPicker } from './CwdPicker';
import { usePanelDispatch } from '@/renderer/contexts/PanelContext';
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

/** File icon SVG (inline) */
function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/** Maximize icon SVG (inline) */
function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
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
  const { t } = useI18n();
  const ui = getTerminalProcessUI(state);
  const tileRef = useRef<HTMLDivElement>(null);
  const panelDispatch = usePanelDispatch();

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

  // Naming machine state
  const namingRef = useRef(createNamingMachine(customName));
  const [namingState, setNamingState] = useState(namingRef.current.state);
  const [namingContext, setNamingContext] = useState(namingRef.current.context);
  const [inputValue, setInputValue] = useState('');

  function sendNaming(event: string | { type: string; value?: string }) {
    namingRef.current.send(event);
    setNamingState(namingRef.current.state);
    setNamingContext(namingRef.current.context);
    // Report name changes to parent
    if (namingRef.current.state === 'DisplayNamed') {
      onRename?.(id, namingRef.current.context.displayText);
    } else if (namingRef.current.state === 'DisplayEmpty') {
      onRename?.(id, '');
    }
  }

  // Initialize input value when entering Editing state
  useEffect(() => {
    if (namingState === 'Editing') {
      setInputValue(namingContext.editValue);
    }
  }, [namingState, namingContext.editValue]);

  // Disable menu bar drag region during editing so blur fires on click
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (namingState === 'Editing') {
      document.body.classList.add('name-editing');
    } else {
      document.body.classList.remove('name-editing');
    }
    return () => document.body.classList.remove('name-editing');
  }, [namingState]);

  const classNames = [
    'tile',
    !compact && !entered ? 'tile-enter' : '',
    focused ? 'tile-focused' : '',
    selected ? 'tile-selected' : '',
    state === 'WaitingInput' ? 'tile--waiting' : '',
    dragState === 'dragging' ? 'dragging' : '',
    dragState === 'drag-over' ? 'drag-over' : '',
  ].filter(Boolean).join(' ');

  function shortenPath(path: string, truncate = true): string {
    const home = window.api.app.getHomePath();
    let short = path;
    if (home && home !== '/' && path.startsWith(home)) {
      short = '~' + path.slice(home.length);
    }
    if (truncate) {
      const parts = short.split('/');
      if (parts.length > 3) {
        // 空间有限，优先保证最后的文件夹名完整可见
        return parts[0] + '/\u2026/' + parts[parts.length - 1];
      }
    }
    return short;
  }

  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const cwdRef = useRef<HTMLSpanElement>(null);
  const [cwdAnchorRect, setCwdAnchorRect] = useState<{ top: number; left: number } | null>(null);

  const handleCwdClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!compact && cwdRef.current) {
      const rect = cwdRef.current.getBoundingClientRect();
      setCwdAnchorRect({ top: rect.bottom + 4, left: rect.left });
      setCwdPickerOpen(true);
    }
  };

  const handlePlaceholderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendNaming('CLICK_PLACEHOLDER');
  };

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendNaming('CLICK_NAME');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendNaming({ type: 'ENTER', value: inputValue });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      sendNaming('ESC');
    }
  };

  const handleInputBlur = () => {
    sendNaming({ type: 'BLUR', value: inputValue });
  };

  const handleFocusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.();
  };

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    panelDispatch({ type: 'OPEN_FILE_PANEL', terminalId: id });
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.(id);
  };

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
      {/* Header: [status-dot] [cwd · name-area] [spacer] [file-btn] [max-btn] */}
      <div
        className="tile-header"
        draggable={isDraggable}
        onDragStart={handleDragStart}
      >
        {/* Status dot */}
        <span
          className={`tile-status ${
            state === 'WaitingInput' ? 'tile-status--waiting' :
            state === 'Running' ? 'tile-status--running' :
            'tile-status--idle'
          }`}
        />

        {/* Tile name area */}
        <div className="tile-name">
          {/* Cwd path (clickable, cyan) */}
          <span className="tile-cwd" ref={cwdRef} onClick={handleCwdClick} title={shortenPath(cwd, false)}>
            {shortenPath(cwd)}
          </span>

          {/* Name area: compact mode only shows named, full mode shows all states */}
          {compact ? (
            namingState === 'DisplayNamed' && (
              <>
                <span className="tile-separator">·</span>
                <span className="tile-custom-name">{namingContext.displayText}</span>
              </>
            )
          ) : (
            <>
              {namingState === 'Editing' ? (
                <>
                  <span className="tile-separator">·</span>
                  <input
                    ref={inputRef}
                    type="text"
                    className="tile-custom-name-input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={handleInputBlur}
                    autoFocus
                  />
                </>
              ) : (
                <span
                  className="tile-name-clickable"
                  onClick={namingState === 'DisplayNamed' ? handleNameClick : handlePlaceholderClick}
                >
                  <span className="tile-separator">·</span>
                  {namingState === 'DisplayNamed' ? (
                    <span className="tile-custom-name">
                      {namingContext.displayText}
                    </span>
                  ) : (
                    <span className="tile-custom-name tile-custom-name--placeholder">
                      {t('terminal.namePlaceholder')}
                    </span>
                  )}
                </span>
              )}
            </>
          )}
        </div>

        {/* WaitingInput badge */}
        {state === 'WaitingInput' && (
          <span className="tile-waiting-badge">1</span>
        )}

        {/* Header action buttons */}
        {compact ? (
          onClose && (
            <button className="tile-close-btn" onClick={handleCloseClick}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )
        ) : (
          <>
            {/* File button (amber pill) */}
            <button className="tile-file-btn" onClick={handleFileClick}>
              <FileIcon />
              {t('terminal.file')}
            </button>

            {/* Maximize button (blue pill) */}
            <button className="tile-max-btn" onClick={handleFocusClick}>
              <MaximizeIcon />
            </button>

            {/* Close button (red pill) */}
            <button className="tile-close-btn" onClick={handleCloseClick}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* CwdPicker popup */}
      {!compact && (
        <CwdPicker
          terminalId={id}
          currentCwd={cwd}
          open={cwdPickerOpen}
          anchorRect={cwdAnchorRect}
          onClose={() => { setCwdPickerOpen(false); setCwdAnchorRect(null); }}
        />
      )}

      {/* Terminal content */}
      <div className="tile-terminal" onClick={compact ? (e) => e.stopPropagation() : undefined}>
        <XTermRenderer terminalId={id} suppressResize={compact} />
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
