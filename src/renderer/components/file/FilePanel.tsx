/**
 * FilePanel Component
 *
 * Right slide-out file sidebar showing project file tree.
 * Loads real files from the terminal's working directory via IPC readDir.
 * Supports lazy folder expansion/collapse.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FileItem } from './FileItem';
import type { FileEntry as IpcFileEntry } from '@/shared/types/fs.types';
import { trackEvent } from '@/renderer/hooks/useAnalytics';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import './FilePanel.css';

interface FileEntry {
  name: string;
  type: 'file' | 'folder';
  ext?: string;
  meta?: string;
  indent: number;
  isNew?: boolean;
  path?: string;
}

interface FilePanelProps {
  projectCwd: string;
  onClose: () => void;
  onOpenFile: (filePath: string, ext: string) => void;
}

/** Extract project display name from cwd path */
function getProjectName(cwd: string): string {
  return cwd.split('/').pop() || '~';
}

/** Format file size for display */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Map IPC FileEntry[] to UI FileEntry[] */
function mapIpcEntries(entries: IpcFileEntry[], indent: number): FileEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return sorted
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => {
      const ext = entry.isDirectory
        ? undefined
        : entry.name.includes('.') ? entry.name.split('.').pop() : undefined;
      const meta = entry.size != null ? formatFileSize(entry.size) : undefined;
      return {
        name: entry.name,
        type: (entry.isDirectory ? 'folder' : 'file') as 'file' | 'folder',
        ext,
        meta,
        indent,
        path: entry.path,
      };
    });
}

/** Insert children after a parent entry in the flat list */
function insertAfter(list: FileEntry[], parent: FileEntry, children: FileEntry[]): FileEntry[] {
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
function removeChildren(list: FileEntry[], parentPath: string, parentIndent: number): FileEntry[] {
  const parentIdx = list.findIndex(f => f.path === parentPath);
  if (parentIdx === -1) return list;

  let endIdx = parentIdx + 1;
  while (endIdx < list.length && list[endIdx].indent > parentIndent) {
    endIdx++;
  }
  return [...list.slice(0, parentIdx + 1), ...list.slice(endIdx)];
}

export function FilePanel({ projectCwd, onClose, onOpenFile }: FilePanelProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);

  // Trigger slide-in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Load root file list
  useEffect(() => {
    setExpandedFolders(new Set());
    window.api.fs
      .readDir(projectCwd)
      .then((result: { success: boolean; data?: IpcFileEntry[] }) => {
        if (result?.success && result.data) {
          setFiles(mapIpcEntries(result.data, 0));
        }
      })
      .catch(() => {
        // Silently fail — panel shows empty
      });
  }, [projectCwd]);

  // Esc to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleFolderToggle = useCallback(async (entry: FileEntry) => {
    const folderPath = entry.path;
    if (!folderPath) return;

    if (expandedFolders.has(folderPath)) {
      // Collapse
      setExpandedFolders(prev => {
        const next = new Set(prev);
        // Also remove any children folders that were expanded
        for (const p of prev) {
          if (p.startsWith(folderPath + '/')) next.delete(p);
        }
        next.delete(folderPath);
        return next;
      });
      setFiles(current => removeChildren(current, folderPath, entry.indent));
    } else {
      // Expand
      setExpandedFolders(prev => new Set(prev).add(folderPath));
      try {
        const result = await window.api.fs.readDir(folderPath);
        if (result?.success && result.data) {
          const children = mapIpcEntries(result.data as IpcFileEntry[], entry.indent + 1);
          setFiles(current => insertAfter(current, entry, children));
        }
      } catch {
        // Silently fail — folder stays in expanded set but shows no children
      }
    }
  }, [expandedFolders]);

  const handleContextMenu = useCallback((entry: FileEntry, e: React.MouseEvent) => {
    e.preventDefault();
    if (!entry.path) return;
    window.api.fs.showFileMenu(entry.path, entry.type === 'folder', e.clientX, e.clientY);
  }, []);

  const handleFileClick = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'folder') {
        handleFolderToggle(entry);
      } else {
        const filePath = entry.path || `${projectCwd}/${entry.name}`;
        const ext = entry.ext || entry.name.split('.').pop() || '';
        trackEvent(ANALYTICS_EVENTS.FILE.PREVIEW, { file_type: ext });
        onOpenFile(filePath, ext);
      }
    },
    [projectCwd, onOpenFile, handleFolderToggle]
  );

  return (
    <>
      {/* Click-outside overlay */}
      <div className="file-panel-overlay" onClick={onClose} />

      <div className={`file-panel ${isOpen ? 'file-panel--open' : ''}`}>
        {/* Header */}
        <div className="file-panel__header">
          <div className="file-panel__title">
            <span className="file-panel__title-name">
              {getProjectName(projectCwd)}
            </span>
          </div>
          <button className="file-panel__close" onClick={onClose}>
            &#x2715;
          </button>
        </div>

        {/* File tree */}
        <div className="file-panel__content">
          {files.map((entry) => (
            <FileItem
              key={entry.path || `${entry.indent}-${entry.name}`}
              name={entry.name}
              type={entry.type}
              indent={entry.indent}
              ext={entry.ext}
              meta={entry.meta}
              isNew={entry.isNew}
              isActive={false}
              expanded={entry.type === 'folder' && entry.path ? expandedFolders.has(entry.path) : undefined}
              onClick={() => handleFileClick(entry)}
              onContextMenu={(e) => handleContextMenu(entry, e)}
              filePath={entry.path}
            />
          ))}
        </div>
      </div>
    </>
  );
}
