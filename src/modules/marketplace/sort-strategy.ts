/**
 * Sort Strategy
 *
 * Default sort order for marketplace package sources.
 * Anthropic official > community > GitHub
 */

export function getDefaultSortOrder(): string[] {
  return ['anthropic', 'community', 'github'];
}
