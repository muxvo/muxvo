/**
 * FileTempView Component
 *
 * Three-column temporary view: file tree | file content | terminal sidebar.
 * Overlays the terminal grid when a file is opened for viewing.
 * Supports editing with Cmd+S save and unsaved changes confirmation.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n';
import { MarkdownWysiwyg } from '@/renderer/components/markdown/MarkdownWysiwyg';
import { TerminalSidebar } from '@/renderer/components/terminal/TerminalSidebar';
import { UnsavedPromptDialog } from './UnsavedPromptDialog';
import { FileItem } from './FileItem';
import { SpreadsheetView, type SpreadsheetHandle } from './SpreadsheetView';
import { PdfPreview } from './PdfPreview';
import { type TreeEntry, mapIpcToTree, insertAfter, removeChildren } from '@/renderer/utils/file-tree';
import type { FileEntry as IpcFileEntry } from '@/shared/types/fs.types';
import './FileTempView.css';

interface FileTempViewProps {
  projectCwd: string;
  filePath: string;
  content: string;
  fileType: 'markdown' | 'code' | 'text' | 'image' | 'spreadsheet' | 'pdf';
  terminals: Array<{ id: string; state: string; cwd: string }>;
  sourceTerminalId: string;
  onClose: () => void;
  onSelectFile: (filePath: string, ext: string) => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal?: (id: string) => void;
}

const DEFAULT_LEFT_WIDTH = 200;
const DEFAULT_RIGHT_WIDTH = 280;
const MIN_WIDTH = 80;
const MAX_WIDTH = 700;

/** Extract display name from path */
function getDisplayName(path: string): string {
  return path.split('/').pop() || '~';
}

function getTagLabel(fileType: 'markdown' | 'code' | 'text' | 'image' | 'spreadsheet' | 'pdf'): string {
  switch (fileType) {
    case 'markdown':
      return 'MD';
    case 'code':
      return 'CODE';
    case 'image':
      return 'IMG';
    case 'spreadsheet':
      return 'XLS';
    case 'pdf':
      return 'PDF';
    case 'text':
      return 'TXT';
  }
}

function CodeView({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="file-temp-view__code">
      {lines.map((line, i) => (
        <div key={i} className="file-temp-view__code-line">
          <span className="file-temp-view__code-num">{i + 1}</span>
          <span className="file-temp-view__code-text">{line}</span>
        </div>
      ))}
    </div>
  );
}

export function FileTempView({
  projectCwd,
  filePath,
  content,
  fileType,
  terminals,
  sourceTerminalId,
  onClose,
  onSelectFile,
  onSelectTerminal,
  onCloseTerminal,
}: FileTempViewProps) {
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const draggingRef = useRef<'left' | 'right' | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Load persisted widths from config
  useEffect(() => {
    window.api.app.getConfig().then((result: any) => {
      if (result?.data?.ftvLeftWidth) setLeftWidth(result.data.ftvLeftWidth);
      if (result?.data?.ftvRightWidth) setRightWidth(result.data.ftvRightWidth);
      if (result?.data?.showHiddenFiles) setShowHidden(true);
    }).catch(() => {});
  }, []);

  // Entrance animation state
  const [entered, setEntered] = useState(false);

  // File tree state
  const [treeFiles, setTreeFiles] = useState<TreeEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const handleToggleHidden = useCallback(() => {
    setShowHidden(prev => {
      const next = !prev;
      window.api.app.getConfig().then((result: any) => {
        window.api.app.saveConfig({ ...result?.data, showHiddenFiles: next });
      }).catch(() => {});
      return next;
    });
  }, []);

  // Editing state
  const { t } = useI18n();
  const [editContent, setEditContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [sourceMode, setSourceMode] = useState(false); // false=WYSIWYG, true=raw source textarea
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const spreadsheetRef = useRef<SpreadsheetHandle>(null);

  // Sync content prop to editContent when file changes
  useEffect(() => {
    setEditContent(content);
    setIsDirty(false);
    setSourceMode(false); // reset to WYSIWYG mode
  }, [filePath]);

  // Also sync when content prop updates (initial load)
  useEffect(() => {
    if (!isDirty) {
      setEditContent(content);
    }
  }, [content]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    let result;
    if (fileType === 'spreadsheet' && spreadsheetRef.current) {
      const base64 = spreadsheetRef.current.getBase64();
      result = await window.api.fs.writeFile(filePath, base64, 'base64');
    } else {
      result = await window.api.fs.writeFile(filePath, editContent);
    }
    if (result?.success) {
      setIsDirty(false);
    }
  }, [filePath, editContent, isDirty, fileType]);

  // Close with unsaved check
  const handleCloseRequest = useCallback(() => {
    if (isDirty) {
      pendingActionRef.current = onClose;
      setShowUnsavedPrompt(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  // Entrance animation trigger
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
  }, []);

  // Force all tiling terminals to re-sync PTY size after this overlay closes
  useEffect(() => {
    return () => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('muxvo:terminal-refit'));
      });
    };
  }, []);

  // Load file tree
  useEffect(() => {
    setExpandedFolders(new Set());
    window.api.fs.readDir(projectCwd).then((result: { success: boolean; data?: IpcFileEntry[] }) => {
      if (result?.success && result.data) {
        setTreeFiles(mapIpcToTree(result.data, 0, showHidden));
      }
    }).catch(() => {});
  }, [projectCwd, showHidden]);

  // Keyboard shortcuts: Cmd+S save, Cmd+/ toggle markdown preview, Esc close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        if (fileType === 'markdown') {
          setSourceMode(prev => !prev);
        }
        return;
      }
      if (e.key === 'Escape' && !showUnsavedPrompt) {
        handleCloseRequest();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleCloseRequest, showUnsavedPrompt, fileType]);

  // Resize handle logic
  const latestWidthRef = useRef(0);
  const handleMouseDown = useCallback(
    (side: 'left' | 'right', e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = side;
      startXRef.current = e.clientX;
      startWidthRef.current = side === 'left' ? leftWidth : rightWidth;

      function handleMouseMove(ev: MouseEvent) {
        if (!draggingRef.current) return;
        const delta = ev.clientX - startXRef.current;
        const newWidth =
          draggingRef.current === 'left'
            ? startWidthRef.current + delta
            : startWidthRef.current - delta;
        const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        latestWidthRef.current = clamped;
        if (draggingRef.current === 'left') {
          setLeftWidth(clamped);
        } else {
          setRightWidth(clamped);
        }
      }

      function handleMouseUp() {
        const finalSide = draggingRef.current;
        draggingRef.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        // Persist width to config
        if (finalSide) {
          const key = finalSide === 'left' ? 'ftvLeftWidth' : 'ftvRightWidth';
          window.api.app.saveConfig({ [key]: latestWidthRef.current }).catch(() => {});
        }
      }

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [leftWidth, rightWidth]
  );

  // Folder toggle (expand/collapse)
  const handleFolderToggle = useCallback(async (entry: TreeEntry) => {
    const folderPath = entry.path;
    if (!folderPath) return;

    if (expandedFolders.has(folderPath)) {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        for (const p of prev) {
          if (p.startsWith(folderPath + '/')) next.delete(p);
        }
        next.delete(folderPath);
        return next;
      });
      setTreeFiles(current => removeChildren(current, folderPath, entry.indent));
    } else {
      setExpandedFolders(prev => new Set(prev).add(folderPath));
      try {
        const result = await window.api.fs.readDir(folderPath);
        if (result?.success && result.data) {
          const children = mapIpcToTree(result.data as IpcFileEntry[], entry.indent + 1, showHidden);
          setTreeFiles(current => insertAfter(current, entry, children));
        }
      } catch {
        // Silently fail
      }
    }
  }, [expandedFolders]);

  const handleContextMenu = useCallback((entry: TreeEntry, e: React.MouseEvent) => {
    e.preventDefault();
    if (!entry.path) return;
    window.api.fs.showFileMenu(entry.path, entry.type === 'folder', e.clientX, e.clientY);
  }, []);

  // File click with unsaved check
  const handleTreeFileClick = useCallback(
    (entry: TreeEntry) => {
      if (entry.type === 'folder') {
        handleFolderToggle(entry);
        return;
      }
      const path = entry.path || `${projectCwd}/${entry.name}`;
      const ext = entry.ext || entry.name.split('.').pop() || '';
      if (isDirty) {
        pendingActionRef.current = () => onSelectFile(path, ext);
        setShowUnsavedPrompt(true);
      } else {
        onSelectFile(path, ext);
      }
    },
    [projectCwd, onSelectFile, handleFolderToggle, isDirty]
  );

  // Unsaved prompt handlers
  const handlePromptSave = useCallback(async () => {
    await handleSave();
    setShowUnsavedPrompt(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  }, [handleSave]);

  const handlePromptDiscard = useCallback(() => {
    setIsDirty(false);
    setShowUnsavedPrompt(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  }, []);

  const handlePromptCancel = useCallback(() => {
    setShowUnsavedPrompt(false);
    pendingActionRef.current = null;
  }, []);

  const fileName = getDisplayName(filePath);
  const sidebarTerminals = terminals.filter(t => t.id === sourceTerminalId);
  const displayContent = isDirty ? editContent : content;

  return (
    <div className={`file-temp-view ${entered ? 'file-temp-view--entered' : ''}`}>
      {/* Left column: file tree */}
      <div
        className={`file-temp-view__files ${entered ? 'file-temp-view__files--entered' : ''}`}
        style={{ width: leftWidth }}
      >
        <div className="file-temp-view__files-header">
          <span className="file-temp-view__files-title">
            {getDisplayName(projectCwd)}
          </span>
          <button
            className={`file-temp-view__toggle-hidden ${showHidden ? 'file-temp-view__toggle-hidden--active' : ''}`}
            onClick={handleToggleHidden}
            title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
          >
            {showHidden ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        </div>
        <div className="file-temp-view__files-content">
          {treeFiles.map((entry) => (
            <FileItem
              key={entry.path || `${entry.indent}-${entry.name}`}
              name={entry.name}
              type={entry.type}
              indent={entry.indent}
              ext={entry.ext}
              isActive={entry.path === filePath || entry.name === fileName}
              expanded={entry.type === 'folder' && entry.path ? expandedFolders.has(entry.path) : undefined}
              onClick={() => handleTreeFileClick(entry)}
              onContextMenu={(e) => handleContextMenu(entry, e)}
              filePath={entry.path}
            />
          ))}
        </div>
      </div>

      {/* Left resize handle */}
      <div
        className="file-temp-view__resize-handle"
        onMouseDown={(e) => handleMouseDown('left', e)}
      />

      {/* Middle column: file content */}
      <div className="file-temp-view__content">
        <div className="file-temp-view__content-header">
          <span className="file-temp-view__content-filename">
            {isDirty && <span className="file-temp-view__dirty-dot" />}
            {fileName}
          </span>
          {fileType === 'markdown' && (
            <button
              className={`file-temp-view__mode-btn ${sourceMode ? 'file-temp-view__mode-btn--active' : ''}`}
              onClick={() => setSourceMode(prev => !prev)}
              title="⌘/"
            >
              {sourceMode ? t('file.wysiwyg') : t('file.source')}
            </button>
          )}
          <span
            className={`file-temp-view__content-tag file-temp-view__content-tag--${fileType}`}
          >
            {getTagLabel(fileType)}
          </span>
          <button className="file-temp-view__back" onClick={handleCloseRequest} title="Esc">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>
        <div className="file-temp-view__content-body">
          {fileType === 'image' && content && (
            <div className="file-temp-view__image">
              <img src={content} alt={fileName} />
            </div>
          )}
          {fileType === 'markdown' && (
            sourceMode ? (
              <textarea
                className="file-temp-view__editor"
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  setIsDirty(true);
                }}
                spellCheck={false}
              />
            ) : (
              <MarkdownWysiwyg
                content={editContent}
                onChange={(md) => {
                  setEditContent(md);
                  setIsDirty(true);
                }}
              />
            )
          )}
          {fileType === 'spreadsheet' && content && (
            <SpreadsheetView ref={spreadsheetRef} content={content} onChange={() => setIsDirty(true)} />
          )}
          {fileType === 'pdf' && content && (
            <PdfPreview filePath={content} />
          )}
          {(fileType === 'code' || fileType === 'text') && (
            <textarea
              className="file-temp-view__editor"
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setIsDirty(true);
              }}
              spellCheck={false}
            />
          )}
        </div>
      </div>

      {/* Right resize handle + terminal sidebar (only when other terminals exist) */}
      {sidebarTerminals.length > 0 && (
        <>
          <div
            className="file-temp-view__resize-handle"
            onMouseDown={(e) => handleMouseDown('right', e)}
          />
          <TerminalSidebar
            terminals={sidebarTerminals}
            onSelect={onSelectTerminal}
            onClose={onCloseTerminal}
            style={{ width: rightWidth, flexShrink: 0, opacity: 0, transition: 'opacity 0.3s ease 0.15s' }}
            className={entered ? 'file-temp-view__sidebar--entered' : ''}
          />
        </>
      )}

      {/* Unsaved changes dialog */}
      {showUnsavedPrompt && (
        <UnsavedPromptDialog
          fileName={fileName}
          onSave={handlePromptSave}
          onDiscard={handlePromptDiscard}
          onCancel={handlePromptCancel}
        />
      )}
    </div>
  );
}
