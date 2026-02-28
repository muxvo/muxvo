/**
 * MarkdownPreview Component
 *
 * Displays rendered Markdown content with syntax highlighting.
 * Supports Mermaid diagram rendering via post-processing.
 */

import React, { useEffect, useRef } from 'react';
import { getMarkdownRenderer } from '@/renderer/features/file-viewer/markdown';
import { runMermaidInContainer } from '@/renderer/utils/mermaid-init';
import './MarkdownPreview.css';
import './MarkdownPreviewHighlight.css';

interface MarkdownPreviewProps {
  content: string;
  searchQuery?: string;
}

/** Highlight matching text in HTML string, only modifying text nodes (not tag attributes) */
export function highlightHtml(html: string, query: string): string {
  if (!query) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
    if (tag) return tag;
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="search-highlight">$1</mark>');
  });
}

export const MarkdownPreview = React.memo(function MarkdownPreview({ content, searchQuery }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderer = getMarkdownRenderer();
  let html = renderer.render(content);
  if (searchQuery) {
    html = highlightHtml(html, searchQuery);
  }

  // Render mermaid diagrams after HTML is injected
  useEffect(() => {
    if (containerRef.current) {
      runMermaidInContainer(containerRef.current);
    }
  }, [content]);

  return (
    <div
      ref={containerRef}
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
