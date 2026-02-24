/**
 * MarkdownPreview Component
 *
 * Displays rendered Markdown content with syntax highlighting.
 */

import React from 'react';
import { getMarkdownRenderer } from '@/renderer/features/file-viewer/markdown';
import './MarkdownPreview.css';
import './MarkdownPreviewHighlight.css';

interface MarkdownPreviewProps {
  content: string;
}

export const MarkdownPreview = React.memo(function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const renderer = getMarkdownRenderer();
  const html = renderer.render(content);

  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
