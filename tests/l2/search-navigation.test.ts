/**
 * L2 Tests: Search Navigation Pure Logic
 *
 * Tests for extracted search navigation utilities:
 * - extractMessageText: extract searchable text from SessionMessage
 * - computeMatchIndices: find which messages match a query
 * - getScrollTarget: compute Virtuoso scroll target index
 */

import { describe, test, expect } from 'vitest';
import {
  extractMessageText,
  computeMatchIndices,
  getScrollTarget,
} from '@/shared/utils/search-navigation';
import type { SessionMessage } from '@/shared/types/chat.types';

/** Helper to create a minimal user message */
function userMsg(content: string, uuid = 'u1'): SessionMessage {
  return { uuid, type: 'user', sessionId: 's1', cwd: '/', timestamp: '2025-01-01T00:00:00Z', content };
}

/** Helper to create an assistant message with text blocks */
function assistantMsg(texts: string[], uuid = 'a1'): SessionMessage {
  return {
    uuid, type: 'assistant', sessionId: 's1', cwd: '/', timestamp: '2025-01-01T00:00:00Z',
    content: texts.map(t => ({ type: 'text' as const, text: t })),
  };
}

/** Helper to create an assistant message with tool_use blocks only */
function toolOnlyMsg(uuid = 't1'): SessionMessage {
  return {
    uuid, type: 'assistant', sessionId: 's1', cwd: '/', timestamp: '2025-01-01T00:00:00Z',
    content: [{ type: 'tool_use' as const, name: 'Read', input: { path: '/foo' } }],
  };
}

// ─── extractMessageText ───────────────────────────────────────────────

describe('extractMessageText', () => {
  test('returns string content for user messages', () => {
    expect(extractMessageText(userMsg('hello world'))).toBe('hello world');
  });

  test('joins text blocks for assistant messages', () => {
    expect(extractMessageText(assistantMsg(['part1', 'part2']))).toBe('part1\npart2');
  });

  test('ignores tool_use blocks', () => {
    expect(extractMessageText(toolOnlyMsg())).toBe('');
  });

  test('extracts text from mixed content (text + tool_use)', () => {
    const msg: SessionMessage = {
      uuid: 'm1', type: 'assistant', sessionId: 's1', cwd: '/', timestamp: '2025-01-01T00:00:00Z',
      content: [
        { type: 'text' as const, text: 'Hello' },
        { type: 'tool_use' as const, name: 'Bash', input: {} },
        { type: 'text' as const, text: 'World' },
      ],
    };
    expect(extractMessageText(msg)).toBe('Hello\nWorld');
  });

  test('returns empty string for empty array content', () => {
    const msg: SessionMessage = {
      uuid: 'e1', type: 'assistant', sessionId: 's1', cwd: '/', timestamp: '2025-01-01T00:00:00Z',
      content: [],
    };
    expect(extractMessageText(msg)).toBe('');
  });
});

// ─── computeMatchIndices ──────────────────────────────────────────────

describe('computeMatchIndices', () => {
  test('returns empty array for empty query', () => {
    expect(computeMatchIndices([userMsg('hello')], '')).toEqual([]);
  });

  test('returns empty array for whitespace-only query', () => {
    expect(computeMatchIndices([userMsg('hello')], '   ')).toEqual([]);
  });

  test('finds matching user messages', () => {
    const msgs = [userMsg('hello', 'u1'), userMsg('world', 'u2'), userMsg('hello world', 'u3')];
    expect(computeMatchIndices(msgs, 'hello')).toEqual([0, 2]);
  });

  test('matches are case-insensitive', () => {
    const msgs = [userMsg('Hello World'), userMsg('HELLO'), userMsg('goodbye')];
    expect(computeMatchIndices(msgs, 'hello')).toEqual([0, 1]);
  });

  test('finds matches in assistant text blocks', () => {
    const msgs = [
      userMsg('no match here', 'u1'),
      assistantMsg(['this has keyword hello in it'], 'a1'),
      assistantMsg(['nothing here'], 'a2'),
    ];
    expect(computeMatchIndices(msgs, 'hello')).toEqual([1]);
  });

  test('does not match tool_use-only messages', () => {
    const msgs = [toolOnlyMsg('t1'), userMsg('hello', 'u1')];
    expect(computeMatchIndices(msgs, 'Read')).toEqual([]);
  });

  test('returns empty array for no matches', () => {
    const msgs = [userMsg('hello'), assistantMsg(['world'])];
    expect(computeMatchIndices(msgs, 'xyz')).toEqual([]);
  });
});

// ─── getScrollTarget ──────────────────────────────────────────────────

describe('getScrollTarget', () => {
  test('returns null for empty matchIndices', () => {
    expect(getScrollTarget([], 0, 100000)).toBeNull();
  });

  test('returns null for negative currentMatchIdx', () => {
    expect(getScrollTarget([3, 7], -1, 100000)).toBeNull();
  });

  test('returns null for out-of-bounds currentMatchIdx', () => {
    expect(getScrollTarget([3, 7], 2, 100000)).toBeNull();
  });

  test('computes correct target with firstItemIndex offset', () => {
    const matchIndices = [3, 7, 15];
    expect(getScrollTarget(matchIndices, 0, 99950)).toBe(99953);
    expect(getScrollTarget(matchIndices, 1, 99950)).toBe(99957);
    expect(getScrollTarget(matchIndices, 2, 99950)).toBe(99965);
  });

  test('works with standard FIRST_ITEM_INDEX = 100000', () => {
    expect(getScrollTarget([0], 0, 100000)).toBe(100000);
    expect(getScrollTarget([42], 0, 100000)).toBe(100042);
  });
});
