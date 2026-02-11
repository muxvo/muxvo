/**
 * Escape special regex characters in a string.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search for a pattern in file content and return all matches with line numbers.
 */
export function searchInContent(
  content: string,
  pattern: RegExp,
): Array<{ match: string; line: number; groups: string[] }> {
  const results: Array<{ match: string; line: number; groups: string[] }> = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i];
    const matches = [...lineContent.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
    for (const m of matches) {
      results.push({
        match: m[0],
        line: i + 1,
        groups: m.slice(1),
      });
    }
  }

  return results;
}

/**
 * Check if content contains a string (case-insensitive option).
 */
export function contentContains(content: string, search: string, caseInsensitive = false): boolean {
  if (caseInsensitive) {
    return content.toLowerCase().includes(search.toLowerCase());
  }
  return content.includes(search);
}

/**
 * Convert a camelCase or PascalCase string to kebab-case.
 */
export function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Convert a kebab-case string to camelCase.
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
