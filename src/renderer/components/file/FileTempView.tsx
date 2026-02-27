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
import { TerminalTile } from '@/renderer/components/terminal/TerminalTile';
import { UnsavedPromptDialog } from './UnsavedPromptDialog';
import { FileItem } from './FileItem';
import { type TreeEntry, mapIpcToTree, insertAfter, removeChildren } from '@/renderer/utils/file-tree';
import type { FileEntry as IpcFileEntry } from '@/shared/types/fs.types';
import './FileTempView.css';

interface FileTempViewProps {
  projectCwd: string;
  filePath: string;
  content: string;
  fileType: 'markdown' | 'code' | 'text' | 'image';
  terminals: Array<{ id: string; state: string; cwd: string }>;
  sourceTerminalId: string;
  onClose: () => void;
  onSelectFile: (filePath: string, ext: string) => void;
  onSelectTerminal: (terminalId: string) => void;
}

const DEFAULT_LEFT_WIDTH = 280;
const DEFAULT_RIGHT_WIDTH = 280;
const MIN_WIDTH = 150;
const MAX_WIDTH = 500;

/** Extract display name from path */
function getDisplayName(path: string): string {
  return path.split('/').pop() || '~';
}

function getTagLabel(fileType: 'markdown' | 'code' | 'text' | 'image'): string {
  switch (fileType) {
    case 'markdown':
      return 'MD';
    case 'code':
      return 'CODE';
    case 'image':
      return 'IMG';
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
}: FileTempViewProps) {
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const draggingRef = useRef<'left' | 'right' | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Entrance animation state
  const [entered, setEntered] = useState(false);

  // File tree state
  const [treeFiles, setTreeFiles] = useState<TreeEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Editing state
  const { t } = useI18n();
  const [editContent, setEditContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [sourceMode, setSourceMode] = useState(false); // false=WYSIWYG, true=raw source textarea
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

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
    const result = await window.api.fs.writeFile(filePath, editContent);
    if (result?.success) {
      setIsDirty(false);
    }
  }, [filePath, editContent, isDirty]);

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

  // Load file tree
  useEffect(() => {
    setExpandedFolders(new Set());
    window.api.fs.readDir(projectCwd).then((result: { success: boolean; data?: IpcFileEntry[] }) => {
      if (result?.success && result.data) {
        setTreeFiles(mapIpcToTree(result.data, 0));
      }
    }).catch(() => {});
  }, [projectCwd]);

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
        if (draggingRef.current === 'left') {
          setLeftWidth(clamped);
        } else {
          setRightWidth(clamped);
        }
      }

      function handleMouseUp() {
        draggingRef.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
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
          const children = mapIpcToTree(result.data as IpcFileEntry[], entry.indent + 1);
          setTreeFiles(current => insertAfter(current, entry, children));
        }
      } catch {
        // Silently fail
      }
    }
  }, [expandedFolders]);

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
  const sidebarTerminals = terminals.filter(t => t.id !== sourceTerminalId);
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
          <button className="file-temp-view__close" onClick={handleCloseRequest}>
            &#x2715;
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

      {/* Right resize handle */}
      <div
        className="file-temp-view__resize-handle"
        onMouseDown={(e) => handleMouseDown('right', e)}
      />

      {/* Right column: terminal sidebar */}
      <div
        className="file-temp-view__sidebar"
        style={{ width: rightWidth }}
      >
        {sidebarTerminals.map((t) => (
          <div
            key={t.id}
            className="file-temp-view__sidebar-item"
            onClick={() => onSelectTerminal(t.id)}
          >
            <TerminalTile id={t.id} state={t.state} cwd={t.cwd} compact />
          </div>
        ))}
      </div>

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
