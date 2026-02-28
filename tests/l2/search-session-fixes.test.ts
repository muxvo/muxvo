/**
 * VERIFY: Three search fixes in this session
 *
 * Fix 1: projectFilteredResults — filter search results by selected project
 * Fix 2: visibleCount expansion — add visibleCount to search expansion effect deps
 * Fix 3: keyword-level scroll — two-step scrollToIndex + scrollIntoView
 *
 * Run: npx vitest run tests/verify/VERIFY-search-session-fixes.test.ts --config tests/verify/vitest.verify.config.ts
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../..');

// ===== Fix 1: projectFilteredResults =====

describe('Fix 1: projectFilteredResults — source code verification', () => {
  test('ChatHistoryPanel.tsx: declares projectFilteredResults useMemo', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/ChatHistoryPanel.tsx'), 'utf-8');
    expect(src).toContain('const projectFilteredResults = useMemo(');
  });

  test('ChatHistoryPanel.tsx: projectFilteredResults filters by selectedProjectHash', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/ChatHistoryPanel.tsx'), 'utf-8');
    expect(src).toContain("searchResults.filter(r => r.projectHash === selectedProjectHash)");
  });

  test('ChatHistoryPanel.tsx: projectFilteredResults returns all when no project selected', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/ChatHistoryPanel.tsx'), 'utf-8');
    expect(src).toContain('if (!selectedProjectHash) return searchResults;');
  });

  test('ChatHistoryPanel.tsx: searchSnippets uses projectFilteredResults (not searchResults)', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/ChatHistoryPanel.tsx'), 'utf-8');
    expect(src).toContain('for (const r of projectFilteredResults)');
    expect(src).toContain('}, [projectFilteredResults]);');
  });

  test('ChatHistoryPanel.tsx: contentMatchedSessions depends on projectFilteredResults', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/ChatHistoryPanel.tsx'), 'utf-8');
    // Project filtering flows through contentMatchedSessions (which uses projectFilteredResults)
    expect(src).toContain('}, [searchQuery, titleMatchedSessions, sessions, projectFilteredResults]);');
  });
});

describe('Fix 1: projectFilteredResults — logic verification', () => {
  interface SearchResult {
    projectHash: string;
    sessionId: string;
    snippet: string;
  }

  function filterByProject(results: SearchResult[], selectedProjectHash: string | null): SearchResult[] {
    if (!selectedProjectHash) return results;
    return results.filter(r => r.projectHash === selectedProjectHash);
  }

  const allResults: SearchResult[] = [
    { projectHash: 'proj-a', sessionId: 's1', snippet: '系统A' },
    { projectHash: 'proj-b', sessionId: 's2', snippet: '系统B' },
    { projectHash: 'proj-a', sessionId: 's3', snippet: '系统A2' },
    { projectHash: 'proj-c', sessionId: 's4', snippet: '系统C' },
  ];

  test('null project (全部项目) → returns all results', () => {
    const filtered = filterByProject(allResults, null);
    expect(filtered).toEqual(allResults);
    expect(filtered.length).toBe(4);
  });

  test('specific project → returns only that project results', () => {
    const filtered = filterByProject(allResults, 'proj-a');
    expect(filtered.length).toBe(2);
    expect(filtered.every(r => r.projectHash === 'proj-a')).toBe(true);
  });

  test('project with no results → empty array', () => {
    const filtered = filterByProject(allResults, 'proj-x');
    expect(filtered.length).toBe(0);
  });
});

// ===== Fix 2: visibleCount expansion effect deps =====

describe('Fix 2: visibleCount in search expansion effect — source code verification', () => {
  test('SessionDetail.tsx: search expansion effect includes visibleCount in deps', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // The expansion effect should include visibleCount in its dependency array
    expect(src).toContain('[isSearching, messages.length, visibleCount]');
  });

  test('SessionDetail.tsx: expansion effect still checks isSearching && visibleCount < messages.length', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain('if (isSearching && visibleCount < messages.length)');
  });
});

describe('Fix 2: visibleCount expansion — logic verification', () => {
  // Simulate the expansion logic
  function shouldExpand(isSearching: boolean, visibleCount: number, messagesLength: number): boolean {
    return isSearching && visibleCount < messagesLength;
  }

  test('searching + visibleCount < messages.length → should expand', () => {
    expect(shouldExpand(true, 50, 100)).toBe(true);
  });

  test('searching + visibleCount === messages.length → no expansion needed', () => {
    expect(shouldExpand(true, 100, 100)).toBe(false);
  });

  test('not searching → no expansion', () => {
    expect(shouldExpand(false, 50, 100)).toBe(false);
  });

  test('the bug scenario: after messageKey reset, visibleCount=50 with same messages.length', () => {
    // Session A: 100 messages, expanded to 100
    const expandedA = shouldExpand(true, 100, 100);
    expect(expandedA).toBe(false); // already expanded

    // Switch to Session B: messageKey resets visibleCount to 50, messages.length still 100
    // With the fix (visibleCount in deps), effect re-runs and detects:
    const afterReset = shouldExpand(true, 50, 100);
    expect(afterReset).toBe(true); // should expand again!
  });
});

// ===== Fix 3: keyword-level scroll positioning =====

describe('Fix 3: keyword-level scroll — source code verification', () => {
  test('SessionDetail.tsx: scroll effect uses match.nthInMsg for mark selection', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain('marks[match.nthInMsg]');
  });

  test('SessionDetail.tsx: queries mark.search-highlight--active elements', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain("document.querySelectorAll('mark.search-highlight--active')");
  });

  test('SessionDetail.tsx: calls scrollIntoView with block center', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain("scrollIntoView({ block: 'center', behavior: 'auto' })");
  });

  test('SessionDetail.tsx: fast path + slow path scroll positioning with rAF polling', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // Fast path: direct scrollIntoView when mark is already in DOM
    expect(src).toContain('activateAndScroll()');
    // Slow path: scrollToIndex + rAF polling
    expect(src).toContain('scrollToIndex({ index: dataIndex');
    expect(src).toContain('requestAnimationFrame(poll)');
    expect(src).toContain('scrollIntoView');
    // Active highlight is applied via DOM manipulation, not React props
    expect(src).toContain('data-msg-idx');
  });
});
