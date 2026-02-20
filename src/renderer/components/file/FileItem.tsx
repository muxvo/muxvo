/**
 * FileItem Component
 *
 * Reusable file/folder row for file trees (FilePanel, FileTempView).
 */

import React from 'react';

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
}: FileItemProps) {
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
    >
      <span className="file-item__icon">{getFileIcon(type, ext, expanded)}</span>
      <span className="file-item__name">{name}</span>
      {meta && <span className="file-item__meta">{meta}</span>}
      {isNew && <span className="file-item__badge">NEW</span>}
    </div>
  );
}
