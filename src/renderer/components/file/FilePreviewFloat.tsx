/**
 * FilePreviewFloat Component
 *
 * Floating file preview window, positioned at top-right.
 */

import React, { useEffect } from 'react';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
import './FilePreviewFloat.css';

interface FilePreviewFloatProps {
  filePath: string;
  fileName: string;
  content: string;
  fileType: 'markdown' | 'code' | 'text';
  onClose: () => void;
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
    <div className="file-preview-float__code">
      {lines.map((line, i) => (
        <div key={i} className="file-preview-float__code-line">
          <span className="file-preview-float__code-num">{i + 1}</span>
          <span className="file-preview-float__code-text">{line}</span>
        </div>
      ))}
    </div>
  );
}

export function FilePreviewFloat({
  filePath,
  fileName,
  content,
  fileType,
  onClose,
}: FilePreviewFloatProps) {
  // Esc to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="file-preview-float">
      {/* Header */}
      <div className="file-preview-float__header">
        <span className="file-preview-float__filename">{fileName}</span>
        <span
          className={`file-preview-float__tag file-preview-float__tag--${fileType}`}
        >
          {getTagLabel(fileType)}
        </span>
        <button className="file-preview-float__close" onClick={onClose}>
          &#x2715;
        </button>
      </div>

      {/* Content */}
      <div className="file-preview-float__content">
        {fileType === 'markdown' && <MarkdownPreview content={content} />}
        {fileType === 'code' && <CodeView content={content} />}
        {fileType === 'text' && (
          <div className="file-preview-float__text">{content}</div>
        )}
      </div>
    </div>
  );
}
