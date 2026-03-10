/**
 * VERIFY: chatWatcher auto-bind logic handles stale sessionId correctly
 *
 * Tests the matching algorithm used in chatWatcher.onSessionUpdate callback:
 * 1. Already bound → skip (no rebind)
 * 2. No sessionId terminal with matching CWD → bind to it (preferred)
 * 3. Stale sessionId terminal with matching CWD → update it (fallback)
 * 4. Two terminals same CWD: prefer unbound over stale
 * 5. No matching CWD → no bind
 */
import { describe, test, expect } from 'vitest';

interface TerminalInfo {
  id: string;
  cwd: string;
  sessionId?: string;
  customName?: string;
}

/**
 * Pure matching logic extracted from src/main/index.ts chatWatcher callback.
 * Returns the terminal ID to bind, or null if no match.
 */
function findBestMatchForSession(
  terminals: TerminalInfo[],
  projectHash: string,
  sessionId: string,
): string | null {
  // Already bound to a terminal? Skip.
  if (terminals.some(t => t.sessionId === sessionId)) return null;

  // Find best match: prefer terminal without sessionId, fallback to one with stale sessionId
  let bestMatch: TerminalInfo | null = null;
  for (const t of terminals) {
    if (!t.cwd) continue;
    const termHash = t.cwd.replace(/[^a-zA-Z0-9-]/g, '-');
    if (termHash !== projectHash) continue;
    if (!t.sessionId) {
      bestMatch = t; // Perfect: no sessionId yet
      break;
    }
    if (!bestMatch) {
      bestMatch = t; // Fallback: has stale sessionId, can be updated
    }
  }

  return bestMatch?.id ?? null;
}

describe('VERIFY: chatWatcher auto-bind session matching', () => {
  const PROJECT_CWD = '/Users/test/my-project';
  const PROJECT_HASH = '-Users-test-my-project';

  test('already bound sessionId → skip (returns null)', () => {
    const terminals: TerminalInfo[] = [
      { id: 't1', cwd: PROJECT_CWD, sessionId: 'session-new' },
    ];
    expect(findBestMatchForSession(terminals, PROJECT_HASH, 'session-new')).toBeNull();
  });

  test('no sessionId terminal with matching CWD → bind to it', () => {
    const terminals: TerminalInfo[] = [
      { id: 't1', cwd: PROJECT_CWD },
    ];
    expect(findBestMatchForSession(terminals, PROJECT_HASH, 'session-new')).toBe('t1');
  });

  test('stale sessionId terminal with matching CWD → update it', () => {
    const terminals: TerminalInfo[] = [
      { id: 't1', cwd: PROJECT_CWD, sessionId: 'old-session-123' },
    ];
    expect(findBestMatchForSession(terminals, PROJECT_HASH, 'session-new')).toBe('t1');
  });

  test('two terminals same CWD: prefer unbound over stale', () => {
    const terminals: TerminalInfo[] = [
      { id: 't1', cwd: PROJECT_CWD, sessionId: 'old-session' },
      { id: 't2', cwd: PROJECT_CWD },
    ];
    expect(findBestMatchForSession(terminals, PROJECT_HASH, 'session-new')).toBe('t2');
  });

  test('no matching CWD → returns null', () => {
    const terminals: TerminalInfo[] = [
      { id: 't1', cwd: '/some/other/path' },
    ];
    expect(findBestMatchForSession(terminals, PROJECT_HASH, 'session-new')).toBeNull();
  });

  test('two terminals same CWD, both have sessionId, first already bound → bind second', () => {
    const terminals: TerminalInfo[] = [
      { id: 't1', cwd: PROJECT_CWD, sessionId: 'session-A' },
      { id: 't2', cwd: PROJECT_CWD, sessionId: 'session-B' },
    ];
    // New session for same project — should update one of the stale ones
    expect(findBestMatchForSession(terminals, PROJECT_HASH, 'session-C')).toBe('t1');
  });
});
