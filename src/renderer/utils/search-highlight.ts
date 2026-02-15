/**
 * Search Highlighter
 *
 * Highlights search query matches in text with <mark> tags.
 */

interface HighlightOpts {
  text: string;
  query: string;
  contextChars: number;
}

interface HighlightResult {
  highlighted: string;
  context: string;
}

export function createSearchHighlighter() {
  return {
    highlight(opts: HighlightOpts): HighlightResult {
      const { text, query, contextChars } = opts;

      // Find the query position
      const index = text.toLowerCase().indexOf(query.toLowerCase());
      if (index === -1) {
        return {
          highlighted: text,
          context: text.slice(0, contextChars * 2),
        };
      }

      // Extract context around the match
      const start = Math.max(0, index - contextChars);
      const end = Math.min(text.length, index + query.length + contextChars);
      const context = text.slice(start, end);

      // Build highlighted version
      const highlighted = text.replace(
        new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        `<mark>${query}</mark>`,
      );

      return {
        highlighted,
        context,
      };
    },
  };
}
