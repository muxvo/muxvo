/**
 * VERIFY-codex-resume — Unit test for Codex resume chat support
 *
 * Tests two changes:
 * 1. canResume logic allows codex source sessions (not just claude-code)
 * 2. resumeCmd builds correct CLI command per source
 */

import { describe, test, expect } from 'vitest';

/**
 * Extracted canResume logic from ChatHistoryPanel.tsx
 * Mirrors the inline function at line 375-383
 */
function canResume(session: { source?: string; cwd?: string } | undefined): boolean {
  if (!session) return false;
  const source = session.source || 'claude-code';
  if (source !== 'claude-code' && source !== 'codex') return false;
  const hasCwd = !!session.cwd;
  return hasCwd;
}

/**
 * Extracted resumeCmd logic from App.tsx
 * Mirrors the inline construction at line 257
 */
function buildResumeCmd(source: string, sessionId: string): string {
  return source === 'codex'
    ? `codex resume ${sessionId}`
    : `claude --resume ${sessionId}`;
}

describe('VERIFY: Codex resume chat support', () => {
  const SESSION_ID = '019c8e9c-cc82-71c2-a514-6cb11ffc0e47';

  describe('canResume logic', () => {
    test('allows claude-code sessions with cwd', () => {
      expect(canResume({ source: 'claude-code', cwd: '/some/path' })).toBe(true);
    });

    test('allows codex sessions with cwd', () => {
      expect(canResume({ source: 'codex', cwd: '/some/path' })).toBe(true);
    });

    test('allows sessions with no source (defaults to claude-code)', () => {
      expect(canResume({ cwd: '/some/path' })).toBe(true);
    });

    test('rejects gemini sessions', () => {
      expect(canResume({ source: 'gemini', cwd: '/some/path' })).toBe(false);
    });

    test('rejects sessions without cwd', () => {
      expect(canResume({ source: 'codex' })).toBe(false);
    });

    test('rejects undefined session', () => {
      expect(canResume(undefined)).toBe(false);
    });
  });

  describe('buildResumeCmd logic', () => {
    test('codex source builds codex resume command', () => {
      expect(buildResumeCmd('codex', SESSION_ID)).toBe(`codex resume ${SESSION_ID}`);
    });

    test('claude-code source builds claude --resume command', () => {
      expect(buildResumeCmd('claude-code', SESSION_ID)).toBe(`claude --resume ${SESSION_ID}`);
    });

    test('unknown source defaults to claude --resume', () => {
      expect(buildResumeCmd('other', SESSION_ID)).toBe(`claude --resume ${SESSION_ID}`);
    });
  });
});
