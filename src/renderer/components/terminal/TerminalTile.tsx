/**
 * TerminalTile — Single terminal tile with status indicator + xterm rendering area
 * DEV-PLAN A4: Terminal tile component
 * DEV-PLAN B2/B3: Focus mode interactions + visual effects
 * Module I: I1 Tile Header改造 + I4 自定义名称编辑
 *
 * Aligned with prototype-history-A.html tile design.
 */

import { useState, useRef, useEffect } from 'react';
import { XTermRenderer } from './XTermRenderer';
import { getTerminalProcessUI } from '@/renderer/stores/terminal-process-ui-map';
import { createNamingMachine } from '@/shared/machines/terminal-naming';
import { CwdPicker } from './CwdPicker';
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

export function TerminalTile({
  id,
  state,
  cwd,
  onDoubleClick,
  onClick,
  onClose,
  compact,
  focused,
  selected,
  staggerIndex
}: Props): JSX.Element {
  const ui = getTerminalProcessUI(state);
  const tileRef = useRef<HTMLDivElement>(null);

  // Mouse tracking for gloss effect
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!tileRef.current || compact) return;
    const rect = tileRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    tileRef.current.style.setProperty('--mx', `${x}%`);
    tileRef.current.style.setProperty('--my', `${y}%`);
  };

  // Naming machine state
  const namingRef = useRef(createNamingMachine());
  const [namingState, setNamingState] = useState(namingRef.current.state);
  const [namingContext, setNamingContext] = useState(namingRef.current.context);
  const [inputValue, setInputValue] = useState('');

  function sendNaming(event: string | { type: string; value?: string }) {
    namingRef.current.send(event);
    setNamingState(namingRef.current.state);
    setNamingContext(namingRef.current.context);
  }

  // Initialize input value when entering Editing state
  useEffect(() => {
    if (namingState === 'Editing') {
      setInputValue(namingContext.editValue);
    }
  }, [namingState, namingContext.editValue]);

  const classNames = [
    'tile',
    !compact ? 'tile-enter' : '',
    focused ? 'tile-focused' : '',
    selected ? 'tile-selected' : '',
  ].filter(Boolean).join(' ');

  function shortenPath(path: string, truncate = true): string {
    const home = window.api.app.getHomePath();
    let short = path;
    if (home && home !== '/' && path.startsWith(home)) {
      short = '~' + path.slice(home.length);
    }
    if (truncate) {
      const parts = short.split('/');
      if (parts.length > 4) {
        return parts[0] + '/\u2026/' + parts.slice(-3).join('/');
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
    // TODO: open file panel
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
      onClick={onClick}
      onMouseMove={handleMouseMove}
    >
      {/* Header: [status-dot] [cwd · name-area] [spacer] [file-btn] [max-btn] */}
      <div className="tile-header">
        {/* Status dot */}
        <span
          className={`tile-status ${state === 'Running' ? 'tile-status--running' : 'tile-status--idle'}`}
        />

        {/* Tile name area */}
        <div className="tile-name">
          {/* Cwd path (clickable, cyan) */}
          <span className="tile-cwd" ref={cwdRef} onClick={handleCwdClick} title={shortenPath(cwd, false)}>
            {shortenPath(cwd)}
          </span>

          {/* Name area (only in non-compact mode) */}
          {!compact && (
            <>
              {namingState === 'Editing' ? (
                <>
                  <span className="tile-separator">·</span>
                  <input
                    type="text"
                    className="tile-custom-name-input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={handleInputBlur}
                    autoFocus
                  />
                </>
              ) : namingState === 'DisplayNamed' ? (
                <>
                  <span className="tile-separator">·</span>
                  <span className="tile-custom-name" onClick={handleNameClick}>
                    {namingContext.displayText}
                  </span>
                </>
              ) : (
                <>
                  <span className="tile-separator">·</span>
                  <span
                    className="tile-custom-name tile-custom-name--placeholder"
                    onClick={handlePlaceholderClick}
                  >
                    命名...
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Header action buttons (non-compact only) */}
        {!compact && (
          <>
            {/* File button (amber pill) */}
            <button className="tile-file-btn" onClick={handleFileClick}>
              <FileIcon />
              文件
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
      <div className="tile-terminal">
        <XTermRenderer terminalId={id} />
      </div>
    </div>
  );
}
