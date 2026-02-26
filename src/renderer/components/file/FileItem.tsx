/**
 * FileItem Component
 *
 * Reusable file/folder row for file trees (FilePanel, FileTempView).
 */

import React from 'react';
import { useI18n } from '@/renderer/i18n';

interface FileItemProps {
  name: string;
  type: 'file' | 'folder';
  indent?: number;
  ext?: string;
  meta?: string;
  isNew?: boolean;
  isActive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
  filePath?: string;
}

function getFileIcon(type: 'file' | 'folder', ext?: string, expanded?: boolean): string {
  if (type === 'folder') return expanded ? '\u{1F4C2}' : '\u{1F4C1}';
  switch (ext) {
    case 'md':
      return '\u{1F4DD}';
    case 'json':
      return '\u2699\uFE0F';
    default:
      return '\u{1F4C4}';
  }
}

export function FileItem({
  name,
  type,
  indent = 0,
  ext,
  meta,
  isNew,
  isActive,
  expanded,
  onClick,
  filePath,
}: FileItemProps) {
  const { t } = useI18n();
  const isDraggable = type === 'file' && !!filePath;

  const handleDragStart = (e: React.DragEvent) => {
    if (!filePath) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-muxvo-file-paths', JSON.stringify([filePath]));
    e.dataTransfer.setData('text/plain', filePath);
    document.body.classList.add('dragging-file');
  };

  const handleDragEnd = () => {
    document.body.classList.remove('dragging-file');
  };

  const classList = [
    'file-item',
    type === 'folder' ? 'file-item--folder' : '',
    isNew ? 'file-item--new' : '',
    isActive ? 'file-item--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classList}
      style={{ paddingLeft: 8 + indent * 20 }}
      onClick={onClick}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
    >
      <span className="file-item__icon">{getFileIcon(type, ext, expanded)}</span>
      <span className="file-item__name">{name}</span>
      {meta && <span className="file-item__meta">{meta}</span>}
      {isNew && <span className="file-item__badge">{t('file.new')}</span>}
    </div>
  );
}
