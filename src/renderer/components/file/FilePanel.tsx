/**
 * FilePanel Component
 *
 * Right slide-out file sidebar showing project file tree.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FileItem } from './FileItem';
import './FilePanel.css';

interface FileEntry {
  name: string;
  type: 'file' | 'folder';
  ext?: string;
  meta?: string;
  indent: number;
  isNew?: boolean;
  children?: FileEntry[];
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

/** Mock file tree for when API is unavailable */
const MOCK_FILES: FileEntry[] = [
  { name: 'src', type: 'folder', indent: 0 },
  { name: 'index.ts', type: 'file', ext: 'ts', indent: 1 },
  { name: 'app.tsx', type: 'file', ext: 'tsx', indent: 1 },
  { name: 'README.md', type: 'file', ext: 'md', indent: 0, meta: '2.1KB' },
  { name: 'package.json', type: 'file', ext: 'json', indent: 0, meta: '1.4KB' },
];

export function FilePanel({ projectCwd, onClose, onOpenFile }: FilePanelProps) {
  const [files, setFiles] = useState<FileEntry[]>(MOCK_FILES);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);

  // Trigger slide-in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Load file list
  useEffect(() => {
    // Use window.api.fs if available, otherwise fall back to mock
    if (typeof window !== 'undefined' && (window as any).api?.fs?.readDir) {
      (window as any).api.fs
        .readDir(projectCwd)
        .then((entries: FileEntry[]) => {
          if (entries && entries.length > 0) {
            setFiles(entries);
          }
        })
        .catch(() => {
          // Keep mock data on error
        });
    }
  }, [projectCwd]);

  // Esc to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleFolderToggle = useCallback((folderName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'folder') {
        handleFolderToggle(entry.name);
      } else {
        onOpenFile(
          `${projectCwd}/${entry.name}`,
          entry.ext || entry.name.split('.').pop() || ''
        );
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
              key={`${entry.indent}-${entry.name}`}
              name={entry.name}
              type={entry.type}
              indent={entry.indent}
              ext={entry.ext}
              meta={entry.meta}
              isNew={entry.isNew}
              isActive={false}
              onClick={() => handleFileClick(entry)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
