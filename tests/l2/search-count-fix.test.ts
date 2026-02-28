/**
 * VERIFY: Search count bugs — two fixes
 *
 * Bug 1: showNav condition gap — selecting session with 0 matches shows nothing.
 *   Old: showNav = hasQuery && matchTotal != null && matchTotal > 0
 *   Fix: showNav = hasQuery && matchTotal != null
 *
 * Bug 2: Count shows "1/1" but many keyword highlights visible.
 *   Old: matchIndices counted messages containing keyword (1 msg = 1 match)
 *   Fix: matchOccurrences counts each keyword occurrence via indexOf loop
 *
 * Run: npx vitest run tests/verify/VERIFY-search-count-fix.test.ts --config tests/verify/vitest.verify.config.ts
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../..');

describe('Bug 1: showNav condition — source code verification', () => {
  test('SearchInput.tsx: showNav does NOT require matchTotal > 0', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/SearchInput.tsx'), 'utf-8');
    // showNav should be: hasQuery && matchTotal != null (no > 0)
    expect(src).toMatch(/showNav\s*=\s*hasQuery\s*&&\s*matchTotal\s*!=\s*null\s*;/);
    // Must NOT have the old pattern with > 0
    expect(src).not.toMatch(/showNav.*matchTotal\s*>\s*0/);
  });
});

describe('Bug 1: showNav condition — logic verification', () => {
  // Simulate the showNav logic for different matchTotal values
  function computeShowNav(value: string, matchTotal: number | null | undefined): boolean {
    const hasQuery = Boolean(value?.trim());
    // NEW logic: hasQuery && matchTotal != null
    return hasQuery && matchTotal != null;
  }

  test('matchTotal=0 → nav visible (the bug case)', () => {
    expect(computeShowNav('keyword', 0)).toBe(true);
  });

  test('matchTotal=5 → nav visible', () => {
    expect(computeShowNav('keyword', 5)).toBe(true);
  });

  test('matchTotal=null → nav hidden (no session selected)', () => {
    expect(computeShowNav('keyword', null)).toBe(false);
  });

  test('matchTotal=undefined → nav hidden', () => {
    expect(computeShowNav('keyword', undefined)).toBe(false);
  });

  test('empty query → nav hidden regardless of matchTotal', () => {
    expect(computeShowNav('', 5)).toBe(false);
    expect(computeShowNav('   ', 0)).toBe(false);
  });
});

describe('Bug 2: occurrence-level counting — source code verification', () => {
  test('SessionDetail.tsx: uses matchOccurrences (not matchIndices)', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // Must use matchOccurrences
    expect(src).toContain('matchOccurrences');
    // Must NOT have the old matchIndices variable declaration
    expect(src).not.toMatch(/const matchIndices\s*=/);
  });

  test('SessionDetail.tsx: uses indexOf loop for counting', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // Must use indexOf-based counting (not .includes())
    expect(src).toContain('lower.indexOf(q, pos)');
    // Must track position with { msgIdx, nthInMsg }
    expect(src).toContain('msgIdx');
    expect(src).toContain('nthInMsg');
  });

  test('SessionDetail.tsx: scrolls to occurrence msgIdx', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // Scroll target should use .msgIdx property
    expect(src).toContain('matchOccurrences[currentMatchIdx].msgIdx');
  });
});

describe('Bug 2: occurrence-level counting — logic verification', () => {
  // Reproduce the exact counting algorithm from the fixed code
  interface MatchOccurrence { msgIdx: number; nthInMsg: number; }

  function countOccurrences(messages: string[], query: string): MatchOccurrence[] {
    if (!query?.trim()) return [];
    const q = query.toLowerCase();
    const results: MatchOccurrence[] = [];
    for (let i = 0; i < messages.length; i++) {
      const lower = messages[i].toLowerCase();
      let pos = 0;
      let nth = 0;
      while ((pos = lower.indexOf(q, pos)) !== -1) {
        results.push({ msgIdx: i, nthInMsg: nth });
        nth++;
        pos += q.length;
      }
    }
    return results;
  }

  test('single message with 8 occurrences → 8 matches (not 1)', () => {
    const messages = ['系统设置中的系统参数由系统管理员在系统控制台配置，系统日志记录系统状态，系统监控系统性能'];
    const result = countOccurrences(messages, '系统');
    expect(result.length).toBe(8);
    expect(result.every(r => r.msgIdx === 0)).toBe(true);
    expect(result.map(r => r.nthInMsg)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('3 messages, keyword in 2 of them → total = sum of occurrences', () => {
    const messages = [
      '系统初始化系统配置',   // 2 occurrences
      '无关内容',              // 0
      '系统检查系统状态系统日志', // 3 occurrences
    ];
    const result = countOccurrences(messages, '系统');
    expect(result.length).toBe(5);
    // First message: indices 0-1
    expect(result.filter(r => r.msgIdx === 0).length).toBe(2);
    // Third message: indices 2-4
    expect(result.filter(r => r.msgIdx === 2).length).toBe(3);
  });

  test('no matches → empty array', () => {
    const messages = ['hello world', 'foo bar'];
    const result = countOccurrences(messages, '系统');
    expect(result.length).toBe(0);
  });

  test('empty query → empty array', () => {
    const messages = ['系统'];
    expect(countOccurrences(messages, '').length).toBe(0);
    expect(countOccurrences(messages, '   ').length).toBe(0);
  });

  test('matchInfo reports correct current/total', () => {
    // When matchOccurrences.length > 0, current = currentMatchIdx + 1
    const matchOccurrences = [
      { msgIdx: 0, nthInMsg: 0 },
      { msgIdx: 0, nthInMsg: 1 },
      { msgIdx: 2, nthInMsg: 0 },
    ];
    const currentMatchIdx = 1; // second occurrence
    const current = matchOccurrences.length > 0 ? currentMatchIdx + 1 : 0;
    const total = matchOccurrences.length;
    expect(current).toBe(2);
    expect(total).toBe(3);
  });

  test('matchInfo reports 0/0 when no occurrences', () => {
    const matchOccurrences: MatchOccurrence[] = [];
    const currentMatchIdx = 0;
    const current = matchOccurrences.length > 0 ? currentMatchIdx + 1 : 0;
    expect(current).toBe(0);
    expect(matchOccurrences.length).toBe(0);
  });
});
