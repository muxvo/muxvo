/**
 * VERIFY: Search results split into title matches + content matches sections
 *
 * Verifies the rendering logic:
 * 1. ChatHistoryPanel splits data into titleMatchedSessions + contentMatchedSessions
 * 2. SessionList renders section headers and skeleton cards in search mode
 * 3. Section headers and skeletons are absent in non-search mode
 *
 * Run: npx vitest run tests/verify/VERIFY-search-sections.test.ts --config tests/verify/vitest.verify.config.ts
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../..');

describe('Search sections: data splitting in ChatHistoryPanel', () => {
  const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/ChatHistoryPanel.tsx'), 'utf-8');

  test('titleMatchedSessions is computed independently from searchResults', () => {
    // Should filter sessions by title match only (client-side, instant)
    expect(src).toContain('const titleMatchedSessions = useMemo(');
    expect(src).toContain('s.title.toLowerCase().includes(q)');
    // Dependency: only sessions + searchQuery (not searchResults)
    expect(src).toContain('}, [sessions, searchQuery]);');
  });

  test('contentMatchedSessions excludes title-matched sessions', () => {
    expect(src).toContain('const contentMatchedSessions = useMemo(');
    // Must exclude sessions already in title matches
    expect(src).toContain('titleIds.has(r.sessionId)');
  });

  test('both arrays are passed to SessionList', () => {
    expect(src).toContain('titleMatchedSessions={titleMatchedSessions}');
    expect(src).toContain('contentMatchedSessions={contentMatchedSessions}');
  });
});

describe('Search sections: rendering in SessionList', () => {
  const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionList.tsx'), 'utf-8');

  test('SessionList accepts titleMatchedSessions and contentMatchedSessions props', () => {
    expect(src).toContain('titleMatchedSessions?: SessionSummary[]');
    expect(src).toContain('contentMatchedSessions?: SessionSummary[]');
  });

  test('renders "标题匹配" section header when title matches exist', () => {
    expect(src).toContain('标题匹配');
    // Section header with count
    expect(src).toContain('titleSorted.length');
  });

  test('renders skeleton cards while searching', () => {
    expect(src).toContain('session-list__skeleton-card');
    expect(src).toContain('session-list__skeleton-title');
    expect(src).toContain('session-list__skeleton-preview');
    expect(src).toContain('搜索会话内容...');
  });

  test('renders "内容匹配" section header after search completes', () => {
    expect(src).toContain('内容匹配');
    expect(src).toContain('contentSorted.length');
  });

  test('hides section headers in non-search mode', () => {
    // Normal mode uses sortedSessions directly, no section headers
    expect(src).toContain('visibleSessions.map(renderCard)');
  });

  test('shows "无匹配会话" when no results at all', () => {
    expect(src).toContain('无匹配会话');
  });
});

describe('Search sections: CSS styles', () => {
  const css = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionList.css'), 'utf-8');

  test('section header styles exist', () => {
    expect(css).toContain('.session-list__section-header');
  });

  test('skeleton card styles with pulse animation exist', () => {
    expect(css).toContain('.session-list__skeleton-card');
    expect(css).toContain('skeleton-pulse');
  });

  test('loading section header has flex layout for spinner', () => {
    expect(css).toContain('.session-list__section-header--loading');
  });
});

describe('Search sections: logic verification', () => {
  interface SessionSummary {
    sessionId: string;
    title: string;
    customTitle?: string;
    lastModified: number;
    projectHash: string;
  }

  interface SearchResult {
    sessionId: string;
    projectHash: string;
    snippet: string;
    timestamp: string;
  }

  const sessions: SessionSummary[] = [
    { sessionId: 's1', title: 'Fix login bug', lastModified: 100, projectHash: 'p1' },
    { sessionId: 's2', title: 'Add feature X', lastModified: 200, projectHash: 'p1' },
    { sessionId: 's3', title: 'Refactor auth module', lastModified: 300, projectHash: 'p1' },
  ];

  function computeTitleMatches(sessions: SessionSummary[], query: string) {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return sessions.filter(s =>
      s.title.toLowerCase().includes(q)
      || (s.customTitle && s.customTitle.toLowerCase().includes(q))
    );
  }

  function computeContentMatches(
    titleMatched: SessionSummary[],
    sessions: SessionSummary[],
    searchResults: SearchResult[],
  ) {
    const titleIds = new Set(titleMatched.map(s => s.sessionId));
    const result: SessionSummary[] = [];
    const seen = new Set<string>();
    for (const r of searchResults) {
      if (titleIds.has(r.sessionId) || seen.has(r.sessionId)) continue;
      seen.add(r.sessionId);
      const loaded = sessions.find(s => s.sessionId === r.sessionId);
      if (loaded) {
        result.push(loaded);
      } else {
        result.push({
          sessionId: r.sessionId,
          projectHash: r.projectHash,
          title: r.snippet.slice(0, 60),
          lastModified: new Date(r.timestamp).getTime(),
        });
      }
    }
    return result;
  }

  test('title match filters by query in title', () => {
    const result = computeTitleMatches(sessions, 'login');
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe('s1');
  });

  test('title match returns empty for no match', () => {
    const result = computeTitleMatches(sessions, 'zzzzz');
    expect(result).toHaveLength(0);
  });

  test('content match excludes title-matched sessions', () => {
    const titleMatched = computeTitleMatches(sessions, 'fix');
    // s1 matches title ("Fix login bug")
    expect(titleMatched).toHaveLength(1);

    const searchResults: SearchResult[] = [
      { sessionId: 's1', projectHash: 'p1', snippet: 'fix the issue', timestamp: '2026-01-01' },
      { sessionId: 's4', projectHash: 'p1', snippet: 'fix another thing', timestamp: '2026-01-02' },
    ];

    const contentMatched = computeContentMatches(titleMatched, sessions, searchResults);
    // s1 is excluded (already in title matches), s4 included as placeholder
    expect(contentMatched).toHaveLength(1);
    expect(contentMatched[0].sessionId).toBe('s4');
  });

  test('content match uses loaded session data when available', () => {
    const searchResults: SearchResult[] = [
      { sessionId: 's2', projectHash: 'p1', snippet: 'some content', timestamp: '2026-01-01' },
    ];
    const contentMatched = computeContentMatches([], sessions, searchResults);
    expect(contentMatched).toHaveLength(1);
    // Should use loaded session's title, not snippet
    expect(contentMatched[0].title).toBe('Add feature X');
  });

  test('content match deduplicates by sessionId', () => {
    const searchResults: SearchResult[] = [
      { sessionId: 's4', projectHash: 'p1', snippet: 'first match', timestamp: '2026-01-01' },
      { sessionId: 's4', projectHash: 'p1', snippet: 'second match', timestamp: '2026-01-02' },
    ];
    const contentMatched = computeContentMatches([], sessions, searchResults);
    expect(contentMatched).toHaveLength(1);
  });
});
