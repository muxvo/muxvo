/**
 * VERIFY: Search match navigation no longer causes DOM rebuild flash
 *
 * Root cause: isActiveMatch prop changes triggered MarkdownPreview re-render
 * via dangerouslySetInnerHTML, causing full DOM tree rebuild on every match switch.
 *
 * Fix: Active highlight is now applied via DOM class manipulation (classList.add/remove)
 * instead of React props, so switching matches causes 0 component re-renders.
 *
 * Verifies:
 * 1. highlightHtml never produces search-highlight--active class
 * 2. MarkdownPreview does not accept isActiveMatch prop
 * 3. MessageBubble uses data-msg-idx for DOM targeting
 * 4. Scroll effect uses DOM classList manipulation, not React props
 * 5. itemContent does not reference currentMatchIdx (no re-render trigger)
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { highlightHtml } from '@/renderer/components/markdown/MarkdownPreview';

const ROOT = resolve(__dirname, '../..');

describe('Search flash fix — active highlight via DOM manipulation', () => {
  // 1. highlightHtml function behavior
  test('highlightHtml produces only search-highlight class, never --active', () => {
    const html = '<p>hello world hello</p>';
    const result = highlightHtml(html, 'hello');
    expect(result).toContain('class="search-highlight"');
    expect(result).not.toContain('search-highlight--active');
  });

  test('highlightHtml signature has no active parameter', () => {
    // highlightHtml should accept exactly 2 params: html, query
    expect(highlightHtml.length).toBe(2);
  });

  // 2. MarkdownPreview does not accept isActiveMatch
  test('MarkdownPreview interface has no isActiveMatch prop', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/markdown/MarkdownPreview.tsx'), 'utf-8');
    expect(src).not.toContain('isActiveMatch');
  });

  // 3. MessageBubble uses data-msg-idx
  test('MessageBubble renders data-msg-idx attribute', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain('data-msg-idx={msgIdx}');
  });

  test('MessageBubble does not accept isActiveMatch prop', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // MessageBubbleProps should not contain isActiveMatch
    const propsMatch = src.match(/interface MessageBubbleProps \{[\s\S]*?\}/);
    expect(propsMatch).not.toBeNull();
    expect(propsMatch![0]).not.toContain('isActiveMatch');
  });

  // 4. Scroll effect uses DOM classList manipulation
  test('Scroll effect clears old active marks via classList.remove', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain("classList.remove('search-highlight--active')");
  });

  test('Scroll effect adds active class via classList.add', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain("classList.add('search-highlight--active')");
  });

  test('Scroll effect locates target bubble by data-msg-idx', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    expect(src).toContain('querySelector(`[data-msg-idx=');
  });

  // 5. itemContent does not reference currentMatchIdx
  test('Virtuoso itemContent does not compute isActiveMatch', () => {
    const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');
    // Extract the itemContent callback
    const itemContentMatch = src.match(/itemContent=\{[\s\S]*?\n\s*\}\}/);
    expect(itemContentMatch).not.toBeNull();
    expect(itemContentMatch![0]).not.toContain('isActiveMatch');
    expect(itemContentMatch![0]).not.toContain('currentMatchIdx');
  });
});

describe('Search scroll jump fix — fast path eliminates double scroll', () => {
  const src = readFileSync(resolve(ROOT, 'src/renderer/components/chat/SessionDetail.tsx'), 'utf-8');

  // 6. Fast path: try DOM-direct scroll first, before scrollToIndex
  test('scroll effect has activateAndScroll fast path before scrollToIndex', () => {
    const effectMatch = src.match(/useEffect\(\(\) => \{[\s\S]*?activateAndScroll[\s\S]*?scrollToIndex[\s\S]*?\}, \[currentMatchIdx/);
    expect(effectMatch).not.toBeNull();
  });

  test('fast path returns early if mark already in DOM', () => {
    expect(src).toContain('if (activateAndScroll()) return;');
  });

  // 7. Slow path: uses rAF polling instead of fixed setTimeout
  test('slow path uses requestAnimationFrame polling, not setTimeout', () => {
    // The scroll effect should use rAF polling
    expect(src).toContain('requestAnimationFrame(poll)');
    // Should NOT use setTimeout for scroll positioning
    // (extract just the scroll effect to check)
    const scrollEffect = src.match(/\/\/ DOM-based active highlight[\s\S]*?\}, \[currentMatchIdx, matchOccurrences, searchQuery\]\)/);
    expect(scrollEffect).not.toBeNull();
    expect(scrollEffect![0]).not.toContain('setTimeout');
  });

  // 8. Slow path uses align:'start' to reduce jump
  test('slow path scrollToIndex uses align start instead of center', () => {
    expect(src).toContain("scrollToIndex({ index: dataIndex, align: 'start'");
  });

  // 9. Only one scrollIntoView call in the helper (not two separate calls)
  test('scrollIntoView is called only through activateAndScroll helper', () => {
    const scrollEffect = src.match(/\/\/ DOM-based active highlight[\s\S]*?\}, \[currentMatchIdx, matchOccurrences, searchQuery\]\)/);
    expect(scrollEffect).not.toBeNull();
    // Count scrollIntoView occurrences — should be exactly 1 (in the helper)
    const scrollIntoViewCount = (scrollEffect![0].match(/scrollIntoView/g) || []).length;
    expect(scrollIntoViewCount).toBe(1);
  });
});
