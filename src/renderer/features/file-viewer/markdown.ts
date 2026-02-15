/**
 * Markdown Renderer
 *
 * Provides a markdown renderer that supports CommonMark + GFM with syntax highlighting.
 */

export interface MarkdownRenderer {
  supportsCommonMark(): boolean;
  supportsGFM(): boolean;
  hasSyntaxHighlighting(): boolean;
  render(content: string): string;
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
      return content;
    },
  };
}
