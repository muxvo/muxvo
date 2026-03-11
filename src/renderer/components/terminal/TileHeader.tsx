/**
 * TileHeader — Terminal tile header bar with status indicator, cwd, naming, and action buttons.
 * Extracted from TerminalTile for single-responsibility.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';
import { CwdPicker } from './CwdPicker';
import { WorktreePopover } from './WorktreePopover';
import { usePanelDispatch } from '@/renderer/contexts/PanelContext';
import { shortenPath } from '@/renderer/utils/path-display';
import type { UseNamingResult } from '@/renderer/hooks/useNaming';

/** Folder icon SVG (inline, with translucent fill) */
function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" fillOpacity="0.2" />
      <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" fill="none" strokeWidth="1.5" />
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

/** Git branch icon SVG */
function BranchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** Small branch icon for worktree badge */
function SmallBranchIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** Extract worktree project info from cwd path */
function getWorktreeInfo(cwd: string): { projectName: string } | null {
  const marker = '/.worktrees/';
  const idx = cwd.indexOf(marker);
  if (idx < 0) return null;
  const projectPath = cwd.substring(0, idx);
  const projectName = projectPath.split('/').pop() || '';
  return projectName ? { projectName } : null;
}

/** Fallback: extract worktree project info from custom name (format: "project/worktree-N") */
function getWorktreeInfoFromName(name?: string): { projectName: string } | null {
  if (!name) return null;
  const match = name.match(/^(.+)\/(worktree-\d+)$/);
  return match ? { projectName: match[1] } : null;
}

/** Grid/tiling icon SVG (4-square grid) */
function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
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
  onFocus?: () => void;
  onClose?: (id: string) => void;
  onBackToTiling?: () => void;
  onSidebarSwitch?: () => void;
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
  onFocus,
  onClose,
  onBackToTiling,
  onSidebarSwitch,
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

  // Worktree badge: detect from CWD path, fallback to custom name pattern
  const worktreeInfo = getWorktreeInfo(cwd)
    || getWorktreeInfoFromName(namingState === 'DisplayNamed' ? namingContext.displayText : undefined);

  // CwdPicker state
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const cwdRef = useRef<HTMLSpanElement>(null);
  const [cwdAnchorRect, setCwdAnchorRect] = useState<{ top: number; left: number } | null>(null);

  // Worktree popover state
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const worktreeBtnRef = useRef<HTMLButtonElement>(null);
  const [worktreeAnchorRect, setWorktreeAnchorRect] = useState<{ top: number; left: number } | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(false);

  // Detect if cwd is inside a git repo (debounced on cwd change)
  useEffect(() => {
    let cancelled = false;
    window.api.worktree.detectRepo(cwd).then((res: any) => {
      if (!cancelled) setIsGitRepo(res.success && res.data?.isRepo);
    }).catch(() => {
      if (!cancelled) setIsGitRepo(false);
    });
    return () => { cancelled = true; };
  }, [cwd]);

  const handleWorktreeClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (worktreeBtnRef.current) {
      const rect = worktreeBtnRef.current.getBoundingClientRect();
      setWorktreeAnchorRect({ top: rect.bottom + 4, left: rect.left });
      setWorktreeOpen(true);
    }
  }, []);

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
    onFocus?.();
  };

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    panelDispatch({ type: 'OPEN_FILE_PANEL', terminalId: id });
  };

  const handleFileContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.api.fs.showFileMenu(cwd, true, e.clientX, e.clientY);
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

        {/* Worktree project badge (green, only for worktree terminals) */}
        {worktreeInfo && (
          <span className="tile-worktree-badge">
            <SmallBranchIcon />
            {worktreeInfo.projectName}
          </span>
        )}

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
          <>
            {onSidebarSwitch && (
              <button className="tile-max-btn" onClick={(e) => { e.stopPropagation(); onSidebarSwitch(); }}>
                <MaximizeIcon />
              </button>
            )}
            {onClose && (
              <button className="tile-close-btn" onClick={handleCloseClick}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </>
        ) : (
          <>
            {/* Worktree button (only in git repos) */}
            {isGitRepo && (
              <button
                ref={worktreeBtnRef}
                className="tile-worktree-btn"
                onClick={handleWorktreeClick}
                title="Worktree"
              >
                <BranchIcon />
              </button>
            )}

            {/* File button (amber pill) */}
            <button className="tile-file-btn" onClick={handleFileClick} onContextMenu={handleFileContextMenu} title={t('terminal.file')}>
              <FolderIcon />
            </button>

            {/* Maximize / Back-to-tiling toggle */}
            {focused ? (
              <button className="tile-tiling-btn" onClick={(e) => { e.stopPropagation(); onBackToTiling?.(); }} title={t('app.backToTiling')}>
                <GridIcon />
              </button>
            ) : (
              <button className="tile-max-btn" onClick={handleFocusClick}>
                <MaximizeIcon />
              </button>
            )}

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

      {/* Worktree popover */}
      {!compact && isGitRepo && (
        <WorktreePopover
          terminalCwd={cwd}
          open={worktreeOpen}
          anchorRect={worktreeAnchorRect}
          onClose={() => { setWorktreeOpen(false); setWorktreeAnchorRect(null); }}
        />
      )}
    </>
  );
}
