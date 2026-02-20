/**
 * FileTempView Component
 *
 * Three-column temporary view: terminal list | file content | file tree.
 * Overlays the terminal grid when a file is opened for viewing.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
import { FileItem } from './FileItem';
import type { FileEntry as IpcFileEntry } from '@/shared/types/fs.types';
import './FileTempView.css';

interface FileTempViewProps {
  projectCwd: string;
  filePath: string;
  content: string;
  fileType: 'markdown' | 'code' | 'text' | 'image';
  terminals: Array<{ id: string; cwd: string }>;
  onClose: () => void;
  onSelectFile: (filePath: string, ext: string) => void;
  onSelectTerminal: (terminalId: string) => void;
}

interface TreeEntry {
  name: string;
  type: 'file' | 'folder';
  ext?: string;
  indent: number;
  path?: string;
}

const DEFAULT_LEFT_WIDTH = 250;
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

/** Map IPC entries to tree entries */
function mapIpcToTree(entries: IpcFileEntry[], indent: number): TreeEntry[] {
  return [...entries]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .filter(e => !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      type: (e.isDirectory ? 'folder' : 'file') as 'file' | 'folder',
      ext: e.isDirectory ? undefined : (e.name.includes('.') ? e.name.split('.').pop() : undefined),
      indent,
      path: e.path,
    }));
}

/** Insert children after a parent entry in the flat list */
function insertAfter(list: TreeEntry[], parent: TreeEntry, children: TreeEntry[]): TreeEntry[] {
  const idx = list.findIndex(f => f.path === parent.path);
  if (idx === -1) return list;
  const cleaned = removeChildren(list, parent.path!, parent.indent);
  const insertIdx = cleaned.findIndex(f => f.path === parent.path);
  return [
    ...cleaned.slice(0, insertIdx + 1),
    ...children,
    ...cleaned.slice(insertIdx + 1),
  ];
}

/** Remove all entries that are children of the given parent (deeper indent) */
function removeChildren(list: TreeEntry[], parentPath: string, parentIndent: number): TreeEntry[] {
  const parentIdx = list.findIndex(f => f.path === parentPath);
  if (parentIdx === -1) return list;
  let endIdx = parentIdx + 1;
  while (endIdx < list.length && list[endIdx].indent > parentIndent) {
    endIdx++;
  }
  return [...list.slice(0, parentIdx + 1), ...list.slice(endIdx)];
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
  onClose,
  onSelectFile,
  onSelectTerminal,
}: FileTempViewProps) {
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [activeTerminal, setActiveTerminal] = useState<string | null>(
    terminals.length > 0 ? terminals[0].id : null
  );
  const draggingRef = useRef<'left' | 'right' | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // File tree state
  const [treeFiles, setTreeFiles] = useState<TreeEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Load file tree
  useEffect(() => {
    setExpandedFolders(new Set());
    window.api.fs.readDir(projectCwd).then((result: { success: boolean; data?: IpcFileEntry[] }) => {
      if (result?.success && result.data) {
        setTreeFiles(mapIpcToTree(result.data, 0));
      }
    }).catch(() => {});
  }, [projectCwd]);

  // Esc to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  const handleTerminalClick = useCallback(
    (terminalId: string) => {
      setActiveTerminal(terminalId);
      onSelectTerminal(terminalId);
    },
    [onSelectTerminal]
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

  const handleTreeFileClick = useCallback(
    (entry: TreeEntry) => {
      if (entry.type === 'folder') {
        handleFolderToggle(entry);
      } else {
        const path = entry.path || `${projectCwd}/${entry.name}`;
        onSelectFile(path, entry.ext || entry.name.split('.').pop() || '');
      }
    },
    [projectCwd, onSelectFile, handleFolderToggle]
  );

  const fileName = getDisplayName(filePath);

  return (
    <div className="file-temp-view">
      {/* Close button */}
      <button className="file-temp-view__close" onClick={onClose}>
        &#x2715;
      </button>

      {/* Left column: terminal list */}
      <div
        className="file-temp-view__terminals"
        style={{ width: leftWidth }}
      >
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`file-temp-view__terminal-item ${
              activeTerminal === t.id
                ? 'file-temp-view__terminal-item--active'
                : ''
            }`}
            onClick={() => handleTerminalClick(t.id)}
          >
            <div className="file-temp-view__terminal-header">
              <span className="file-temp-view__terminal-status" />
              <span className="file-temp-view__terminal-cwd">
                {getDisplayName(t.cwd)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Left resize handle */}
      <div
        className="file-temp-view__resize-handle"
        onMouseDown={(e) => handleMouseDown('left', e)}
      />

      {/* Middle column: file content */}
      <div className="file-temp-view__content">
        <div className="file-temp-view__content-header">
          <span className="file-temp-view__content-filename">{fileName}</span>
          <span
            className={`file-temp-view__content-tag file-temp-view__content-tag--${fileType}`}
          >
            {getTagLabel(fileType)}
          </span>
        </div>
        <div className="file-temp-view__content-body">
          {fileType === 'markdown' && <MarkdownPreview content={content} />}
          {fileType === 'code' && <CodeView content={content} />}
          {fileType === 'image' && content && (
            <div className="file-temp-view__image">
              <img src={content} alt={fileName} />
            </div>
          )}
          {fileType === 'text' && (
            <div className="file-temp-view__text">{content}</div>
          )}
        </div>
      </div>

      {/* Right resize handle */}
      <div
        className="file-temp-view__resize-handle"
        onMouseDown={(e) => handleMouseDown('right', e)}
      />

      {/* Right column: file tree */}
      <div
        className="file-temp-view__files"
        style={{ width: rightWidth }}
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}
