/**
 * Search navigation pure utility functions.
 * Extracted from SessionDetail to enable unit testing.
 */

import type { SessionMessage, AssistantContentBlock } from '@/shared/types/chat.types';

/** Extract searchable plain text from a message */
export function extractMessageText(msg: SessionMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as AssistantContentBlock[])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }
  return '';
}

/** Compute indices of messages that contain the search query (case-insensitive) */
export function computeMatchIndices(messages: SessionMessage[], query: string): number[] {
  if (!query?.trim()) return [];
  const q = query.toLowerCase();
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const text = extractMessageText(messages[i]);
    if (text.toLowerCase().includes(q)) {
      indices.push(i);
    }
  }
  return indices;
}

/** Compute the Virtuoso scrollToIndex target */
export function getScrollTarget(
  matchIndices: number[],
  currentMatchIdx: number,
  firstItemIndex: number
): number | null {
  if (matchIndices.length === 0 || currentMatchIdx < 0 || currentMatchIdx >= matchIndices.length) {
    return null;
  }
  return firstItemIndex + matchIndices[currentMatchIdx];
}
