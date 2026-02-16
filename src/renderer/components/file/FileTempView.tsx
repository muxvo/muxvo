/**
 * FileTempView Component
 *
 * Three-column temporary view: terminal list | file content | file tree.
 * Overlays the terminal grid when a file is opened for viewing.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
import { FileItem } from './FileItem';
import './FileTempView.css';

interface FileTempViewProps {
  projectCwd: string;
  filePath: string;
  content: string;
  fileType: 'markdown' | 'code' | 'text';
  terminals: Array<{ id: string; cwd: string }>;
  onClose: () => void;
  onSelectFile: (filePath: string, ext: string) => void;
  onSelectTerminal: (terminalId: string) => void;
}

const DEFAULT_LEFT_WIDTH = 250;
const DEFAULT_RIGHT_WIDTH = 280;
const MIN_WIDTH = 150;
const MAX_WIDTH = 500;

/** Extract display name from path */
function getDisplayName(path: string): string {
  return path.split('/').pop() || '~';
}

function getTagLabel(fileType: 'markdown' | 'code' | 'text'): string {
  switch (fileType) {
    case 'markdown':
      return 'MD';
    case 'code':
      return 'CODE';
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

  // Mock file tree entries (same as FilePanel)
  const mockFiles = [
    { name: 'src', type: 'folder' as const, indent: 0 },
    { name: 'index.ts', type: 'file' as const, ext: 'ts', indent: 1 },
    { name: 'app.tsx', type: 'file' as const, ext: 'tsx', indent: 1 },
    { name: 'README.md', type: 'file' as const, ext: 'md', indent: 0 },
    { name: 'package.json', type: 'file' as const, ext: 'json', indent: 0 },
  ];

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
          {mockFiles.map((entry) => (
            <FileItem
              key={`${entry.indent}-${entry.name}`}
              name={entry.name}
              type={entry.type}
              indent={entry.indent}
              ext={entry.ext}
              isActive={entry.name === fileName}
              onClick={() => {
                if (entry.type === 'file') {
                  onSelectFile(
                    `${projectCwd}/${entry.name}`,
                    entry.ext || ''
                  );
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
