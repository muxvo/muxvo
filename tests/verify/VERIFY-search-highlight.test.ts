/**
 * VERIFY: Search keyword highlighting in assistant/system messages
 *
 * Verifies that:
 * 1. highlightHtml wraps matching text in <mark> tags
 * 2. highlightHtml does NOT modify HTML tag attributes
 * 3. Active match gets the --active class
 * 4. Case-insensitive matching works
 * 5. Empty/missing query returns original HTML
 * 6. Special regex characters in query are escaped
 */

import { describe, test, expect } from 'vitest';
import { highlightHtml } from '@/renderer/components/markdown/MarkdownPreview';

describe('highlightHtml — search highlighting in markdown content', () => {
  test('wraps matching text in <mark> with search-highlight class', () => {
    const html = '<p>hello world</p>';
    const result = highlightHtml(html, 'hello');
    expect(result).toBe('<p><mark class="search-highlight">hello</mark> world</p>');
  });

  test('does NOT modify HTML tag attributes containing the query', () => {
    const html = '<a href="hello-link">click hello</a>';
    const result = highlightHtml(html, 'hello');
    // The href attribute must stay unchanged, only text content gets highlighted
    expect(result).toBe('<a href="hello-link">click <mark class="search-highlight">hello</mark></a>');
  });

  test('active class is not baked into HTML (applied via DOM manipulation)', () => {
    const html = '<p>test word</p>';
    const result = highlightHtml(html, 'test');
    expect(result).toBe('<p><mark class="search-highlight">test</mark> word</p>');
    expect(result).not.toContain('search-highlight--active');
  });

  test('case-insensitive matching', () => {
    const html = '<p>Hello HELLO hello</p>';
    const result = highlightHtml(html, 'hello');
    // All three variants should be highlighted, each preserving original case
    expect(result).toContain('<mark class="search-highlight">Hello</mark>');
    expect(result).toContain('<mark class="search-highlight">HELLO</mark>');
    expect(result).toContain('<mark class="search-highlight">hello</mark>');
  });

  test('returns original HTML when query is empty', () => {
    const html = '<p>some content</p>';
    expect(highlightHtml(html, '')).toBe(html);
  });

  test('escapes special regex characters in query', () => {
    const html = '<p>price is $100 (USD)</p>';
    const result = highlightHtml(html, '$100');
    expect(result).toContain('<mark class="search-highlight">$100</mark>');
  });

  test('handles multiple text nodes across tags', () => {
    const html = '<p>first match</p><p>second match</p>';
    const result = highlightHtml(html, 'match');
    expect(result).toBe(
      '<p>first <mark class="search-highlight">match</mark></p>' +
      '<p>second <mark class="search-highlight">match</mark></p>'
    );
  });

  test('does not break with nested HTML tags', () => {
    const html = '<div><strong>bold query</strong> and normal query</div>';
    const result = highlightHtml(html, 'query');
    expect(result).toBe(
      '<div><strong>bold <mark class="search-highlight">query</mark></strong> and normal <mark class="search-highlight">query</mark></div>'
    );
  });

  test('handles code blocks without breaking', () => {
    const html = '<pre><code class="language-ts">const x = "hello";</code></pre>';
    const result = highlightHtml(html, 'hello');
    // Should highlight "hello" inside code text but not touch class attribute
    expect(result).toContain('class="language-ts"');
    expect(result).toContain('<mark class="search-highlight">hello</mark>');
  });
});
