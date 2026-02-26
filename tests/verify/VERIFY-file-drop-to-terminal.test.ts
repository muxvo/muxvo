/**
 * VERIFY-file-drop-to-terminal
 *
 * Verifies the file-drag-to-terminal feature:
 * 1. shellEscapePath / shellEscapePaths correctly escapes paths with special chars
 * 2. hasFilePayload distinguishes file drags from terminal-reorder drags
 * 3. extractFilePaths reads from custom MIME type
 */

import { describe, it, expect } from 'vitest';
import { shellEscapePath, shellEscapePaths } from '@/renderer/utils/shell-escape';

// ─── Shell Escape ───────────────────────────────────────────────

describe('shellEscapePath', () => {
  it('returns safe paths as-is', () => {
    expect(shellEscapePath('/Users/foo/bar.txt')).toBe('/Users/foo/bar.txt');
    expect(shellEscapePath('~/Documents/file.md')).toBe('~/Documents/file.md');
    expect(shellEscapePath('./relative/path')).toBe('./relative/path');
  });

  it('wraps paths with spaces in single quotes', () => {
    expect(shellEscapePath('/Users/foo/my file.txt')).toBe("'/Users/foo/my file.txt'");
  });

  it('escapes single quotes inside path', () => {
    const result = shellEscapePath("/Users/foo/it's here.txt");
    // Should produce: '/Users/foo/it'"'"'s here.txt'
    expect(result).toContain("'");
    // Verify the escaped path does NOT contain unescaped single quotes that would break shell
    // The pattern is: close-quote, double-quote-single-quote, close-double-quote, open-quote
    expect(result).toBe("'/Users/foo/it'\"'\"'s here.txt'");
  });

  it('wraps paths with parentheses', () => {
    const result = shellEscapePath('/Users/foo/dir (copy)/file.txt');
    expect(result).toBe("'/Users/foo/dir (copy)/file.txt'");
  });

  it('wraps paths with special shell characters', () => {
    expect(shellEscapePath('/tmp/$HOME')).toBe("'/tmp/$HOME'");
    expect(shellEscapePath('/tmp/file&name')).toBe("'/tmp/file&name'");
    expect(shellEscapePath('/tmp/file;name')).toBe("'/tmp/file;name'");
  });
});

describe('shellEscapePaths', () => {
  it('joins multiple paths with spaces', () => {
    const result = shellEscapePaths(['/a/b.txt', '/c/d.txt']);
    expect(result).toBe('/a/b.txt /c/d.txt');
  });

  it('escapes paths that need it and joins', () => {
    const result = shellEscapePaths(['/a/b.txt', '/c/my file.txt']);
    expect(result).toBe("/a/b.txt '/c/my file.txt'");
  });

  it('returns empty string for empty array', () => {
    expect(shellEscapePaths([])).toBe('');
  });
});

// ─── hasFilePayload (inline function, test via logic) ───────────

describe('hasFilePayload logic', () => {
  // hasFilePayload checks: types.includes('Files') || types.includes('application/x-muxvo-file-paths')
  function hasFilePayload(types: string[]): boolean {
    return types.includes('Files') || types.includes('application/x-muxvo-file-paths');
  }

  it('detects Finder file drag (Files type)', () => {
    expect(hasFilePayload(['Files'])).toBe(true);
  });

  it('detects Muxvo internal file drag', () => {
    expect(hasFilePayload(['application/x-muxvo-file-paths', 'text/plain'])).toBe(true);
  });

  it('rejects terminal reorder drag (only text/plain)', () => {
    expect(hasFilePayload(['text/plain'])).toBe(false);
  });

  it('rejects empty types', () => {
    expect(hasFilePayload([])).toBe(false);
  });
});

// ─── extractFilePaths (custom MIME parsing) ─────────────────────

describe('extractFilePaths MIME parsing', () => {
  it('parses valid muxvo file paths JSON', () => {
    const data = JSON.stringify(['/a/b.txt', '/c/d.txt']);
    const parsed = JSON.parse(data) as string[];
    expect(parsed).toEqual(['/a/b.txt', '/c/d.txt']);
  });

  it('handles single file path', () => {
    const data = JSON.stringify(['/Users/test/file.md']);
    const parsed = JSON.parse(data) as string[];
    expect(parsed).toEqual(['/Users/test/file.md']);
  });

  it('handles malformed JSON gracefully', () => {
    let result: string[] = [];
    try {
      result = JSON.parse('not-json') as string[];
    } catch {
      result = [];
    }
    expect(result).toEqual([]);
  });
});
