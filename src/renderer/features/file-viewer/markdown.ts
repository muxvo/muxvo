/**
 * Markdown Renderer
 *
 * Provides a markdown renderer that supports CommonMark + GFM with syntax highlighting.
 */

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

export interface MarkdownRenderer {
  supportsCommonMark(): boolean;
  supportsGFM(): boolean;
  hasSyntaxHighlighting(): boolean;
  render(content: string): string;
}

// Initialize markdown-it with syntax highlighting
const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight: (str: string, lang: string): string => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs"><code>' + hljs.highlight(str, { language: lang }).value + '</code></pre>';
      } catch {
        // Fallback to plain text
      }
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
  },
});

// Enable GFM features
// Tables are enabled by default in markdown-it
// Strikethrough: simple regex post-processing for ~~text~~
// Task lists: simple regex post-processing for - [ ] and - [x]

function processGFMExtensions(html: string): string {
  // Process strikethrough: ~~text~~ -> <del>text</del>
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Process task lists: - [ ] and - [x]
  html = html.replace(
    /<li>\s*\[ \]\s*/g,
    '<li class="task-list-item"><input type="checkbox" disabled> '
  );
  html = html.replace(
    /<li>\s*\[x\]\s*/gi,
    '<li class="task-list-item"><input type="checkbox" checked disabled> '
  );

  return html;
}

export function getMarkdownRenderer(): MarkdownRenderer {
  return {
    supportsCommonMark() {
      return true;
    },
    supportsGFM() {
      return true;
    },
    hasSyntaxHighlighting() {
      return true;
    },
    render(content: string) {
      let html = md.render(content);
      html = processGFMExtensions(html);
      return html;
    },
  };
}
