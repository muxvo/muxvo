/**
 * TileHeader — Terminal tile header bar with status indicator, cwd, naming, and action buttons.
 * Extracted from TerminalTile for single-responsibility.
 */

import { useState, useRef } from 'react';
import { useI18n } from '@/renderer/i18n';
import { CwdPicker } from './CwdPicker';
import { usePanelDispatch } from '@/renderer/contexts/PanelContext';
import { shortenPath } from '@/renderer/utils/path-display';
import type { UseNamingResult } from '@/renderer/hooks/useNaming';

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

export interface TileHeaderProps {
  id: string;
  state: string;
  cwd: string;
  compact?: boolean;
  focused?: boolean;
  isDraggable: boolean;
  naming: UseNamingResult;
  onDragStart?: (e: React.DragEvent) => void;
  onDoubleClick?: () => void;
  onClose?: (id: string) => void;
}

export function TileHeader({
  id,
  state,
  cwd,
  compact,
  focused,
  isDraggable,
  naming,
  onDragStart,
  onDoubleClick,
  onClose,
}: TileHeaderProps): JSX.Element {
  const { t } = useI18n();
  const panelDispatch = usePanelDispatch();

  const {
    namingState,
    namingContext,
    inputValue,
    setInputValue,
    inputRef,
    handlePlaceholderClick,
    handleNameClick,
    handleInputKeyDown,
    handleInputBlur,
  } = naming;

  // CwdPicker state
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
    <>
      {/* Header: [status-dot] [cwd . name-area] [spacer] [file-btn] [max-btn] */}
      <div
        className="tile-header"
        draggable={isDraggable}
        onDragStart={onDragStart}
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
    </>
  );
}
