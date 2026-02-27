/**
 * VERIFY: stripPromptEolMark Phase 2 — CR-based overwrite collapse.
 *
 * When a terminal is resized (SIGWINCH), zsh redraws the prompt using \r (CR)
 * to return to column 0. The buffer captures ALL redraws. When replayed at a
 * narrower width, the previous prompt wraps and \r lands on a different visual
 * line, producing duplicate prompt lines instead of overwriting.
 *
 * Phase 2 collapses each logical line to only the content after the last bare \r.
 */

import { describe, test, expect } from 'vitest';
import { stripPromptEolMark } from '@/shared/utils/strip-prompt-eol-mark';

describe('stripPromptEolMark Phase 2: CR-collapse', () => {
  const ESC = '\x1b';
  const PROMPT = 'rl@MacBook-Pro-de-RaoLi 520-program % ';

  test('Collapses multiple CR-based prompt redraws into one', () => {
    // Simulate: zsh draws prompt, then 3 SIGWINCH cause 3 redraws via \r
    const buffer = `${PROMPT}\r${PROMPT}\r${PROMPT}\r${PROMPT}`;
    const result = stripPromptEolMark(buffer);
    // Should contain exactly one prompt, not four
    expect(result).toBe(PROMPT);
  });

  test('Collapses prompt redraws with escape codes', () => {
    // Real zsh prompt includes color codes; each redraw includes them
    const colorPrompt = `${ESC}[1m${ESC}[32mrl@MacBook${ESC}[0m 520-program % `;
    const buffer = `${colorPrompt}\r${colorPrompt}\r${colorPrompt}`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe(colorPrompt);
  });

  test('Preserves \\r\\n line endings (does not collapse across lines)', () => {
    const output = `line1\r\nline2\r\nline3\r\n`;
    const result = stripPromptEolMark(output);
    expect(result).toBe('line1\nline2\nline3\n');
  });

  test('Handles mixed: PROMPT_EOL_MARK + CR redraws', () => {
    // Full sequence: PROMPT_EOL_MARK → erase → prompt redraws from resize
    const mark = `${ESC}[7m%${ESC}[27m`;
    const spaces = ' '.repeat(40);
    const eolSeq = `${mark}${spaces}\r${spaces}\r${ESC}[0m${ESC}[J`;
    // After EOL mark cleanup, zsh draws prompt, then resize causes redraw
    const buffer = `${eolSeq}${PROMPT}\r${PROMPT}\r${PROMPT}`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe(PROMPT);
  });

  test('Does not affect lines without bare \\r', () => {
    const normalOutput = `ls -la\ntotal 42\ndrwxr-xr-x  5 user group\n${PROMPT}`;
    const result = stripPromptEolMark(normalOutput);
    expect(result).toBe(normalOutput);
  });

  test('Handles progress-bar style \\r (keeps last state)', () => {
    // Progress bars use \r to update the same line
    const buffer = `Downloading... 10%\rDownloading... 50%\rDownloading... 100%`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe('Downloading... 100%');
  });

  test('Handles \\r at end of line (from \\r\\n split)', () => {
    // \r\n → split by \n gives ["...\r", "..."], trailing \r should be stripped
    const buffer = `hello\r\nworld`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe('hello\nworld');
  });

  test('5 prompt redraws (matches real sidebar scenario)', () => {
    // Real case: 5 fit() calls during XTermRenderer init = 5 prompt draws
    const redraws = Array(5).fill(PROMPT).join('\r');
    const buffer = `Restored session: Fri Feb 27 15:02:14 +08 2026\n${redraws}`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe(
      `Restored session: Fri Feb 27 15:02:14 +08 2026\n${PROMPT}`
    );
  });
});
