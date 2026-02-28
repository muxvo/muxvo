/**
 * VERIFY: Search nav buttons persist even when matchTotal is 0
 *
 * Bug: showNav = value && matchTotal > 0 → nav disappears when switching to a
 *      session with 0 matches.
 * Fix: showNav = Boolean(value?.trim()) → nav stays as long as there's a query.
 *
 * Also fixes: onMatchInfoChange reported (1, 0) when no matches → should be (0, 0).
 *
 * Approach: Since SearchInput is a React component and we can't render it in
 * node environment without React Testing Library, we verify the source code
 * contains the correct conditions AND test the logic independently.
 *
 * Run: npx vitest run tests/verify/VERIFY-search-nav-persist.spec.ts --config tests/verify/vitest.verify.config.ts
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../..');

describe('Search nav button persistence — source code verification', () => {
  test('SearchInput.tsx: showNav uses Boolean(value?.trim()), not matchTotal > 0', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/SearchInput.tsx'), 'utf-8');
    // The fix: showNav should NOT depend on matchTotal
    expect(src).toContain('Boolean(value?.trim())');
    expect(src).not.toMatch(/showNav\s*=\s*value\s*&&\s*matchTotal/);
  });

  test('SearchInput.tsx: prev/next buttons disabled when matchTotal is 0', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/SearchInput.tsx'), 'utf-8');
    // The fix: buttons should have !matchTotal in their disabled condition
    expect(src).toContain('!matchTotal');
  });

  test('SessionDetail.tsx: matchInfo reports 0 (not 1) when no matches', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // The fix: should check matchOccurrences.length > 0 before adding 1
    expect(src).toContain('matchOccurrences.length > 0 ? currentMatchIdx + 1 : 0');
    expect(src).not.toMatch(/onMatchInfoChange\?\.\(currentMatchIdx \+ 1,/);
  });

  test('SessionDetail.tsx: uses occurrence-level counting (not message-level)', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // Should use matchOccurrences with indexOf loop, not matchIndices with includes check
    expect(src).toContain('matchOccurrences');
    expect(src).toContain('lower.indexOf(q, pos)');
    expect(src).not.toMatch(/const matchIndices/);
  });
});

describe('Search nav button persistence — logic verification', () => {
  // These test the actual logic that drives user-visible behavior

  test('showNav: query with 0 matches → nav visible', () => {
    // Simulates: user typed "keyword", session has 0 matches
    const value = 'keyword';
    const showNav = Boolean(value?.trim());
    expect(showNav).toBe(true);
  });

  test('showNav: empty query → nav hidden', () => {
    const showNav = Boolean(''.trim());
    expect(showNav).toBe(false);
  });

  test('showNav: whitespace-only query → nav hidden', () => {
    const showNav = Boolean('   '.trim());
    expect(showNav).toBe(false);
  });

  test('matchInfo: 0 matches → reports (0, 0)', () => {
    const currentMatchIdx = 0;
    const matchCount = 0;
    const current = matchCount > 0 ? currentMatchIdx + 1 : 0;
    expect(current).toBe(0);
    expect(matchCount).toBe(0);
  });

  test('matchInfo: 5 matches at index 2 → reports (3, 5)', () => {
    const currentMatchIdx = 2;
    const matchCount = 5;
    const current = matchCount > 0 ? currentMatchIdx + 1 : 0;
    expect(current).toBe(3);
    expect(matchCount).toBe(5);
  });

  test('prev/next disabled when matchTotal is 0', () => {
    const matchTotal = 0;
    const matchCurrent = 0;
    const prevDisabled = !matchTotal || (matchCurrent != null && matchCurrent <= 1);
    const nextDisabled = !matchTotal || (matchCurrent != null && matchCurrent >= (matchTotal ?? 0));
    expect(prevDisabled).toBe(true);
    expect(nextDisabled).toBe(true);
  });

  test('prev disabled at first match, next enabled', () => {
    const matchTotal = 5;
    const matchCurrent = 1;
    const prevDisabled = !matchTotal || (matchCurrent != null && matchCurrent <= 1);
    const nextDisabled = !matchTotal || (matchCurrent != null && matchCurrent >= (matchTotal ?? 0));
    expect(prevDisabled).toBe(true);
    expect(nextDisabled).toBe(false);
  });

  test('next disabled at last match, prev enabled', () => {
    const matchTotal = 5;
    const matchCurrent = 5;
    const prevDisabled = !matchTotal || (matchCurrent != null && matchCurrent <= 1);
    const nextDisabled = !matchTotal || (matchCurrent != null && matchCurrent >= (matchTotal ?? 0));
    expect(prevDisabled).toBe(false);
    expect(nextDisabled).toBe(true);
  });
});
