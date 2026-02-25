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
  searchQuery?: string;
  isActiveMatch?: boolean;
}

/** Highlight matching text in HTML string, only modifying text nodes (not tag attributes) */
function highlightHtml(html: string, query: string, active?: boolean): string {
  if (!query) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cls = `search-highlight${active ? ' search-highlight--active' : ''}`;
  return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
    if (tag) return tag;
    return text.replace(new RegExp(`(${escaped})`, 'gi'), `<mark class="${cls}">$1</mark>`);
  });
}

export const MarkdownPreview = React.memo(function MarkdownPreview({ content, searchQuery, isActiveMatch }: MarkdownPreviewProps) {
  const renderer = getMarkdownRenderer();
  let html = renderer.render(content);
  if (searchQuery) {
    html = highlightHtml(html, searchQuery, isActiveMatch);
  }

  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
