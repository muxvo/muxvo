/**
 * VERIFY: stripPromptEolMark strips zsh PROMPT_EOL_MARK sequences from buffer data.
 *
 * zsh outputs a PROMPT_EOL_MARK (\e[7m%\e[27m + spaces + \r sequences + \e[J)
 * at terminal startup. When the buffer is replayed at a different (narrower) width,
 * this sequence causes visible `%` artifacts and duplicate prompt lines.
 */

import { describe, test, expect } from 'vitest';
import { stripPromptEolMark } from '@/shared/utils/strip-prompt-eol-mark';

describe('stripPromptEolMark', () => {
  // ESC helper
  const ESC = '\x1b';

  test('Primary path: strips PROMPT_EOL_MARK through \\e[J (erase display)', () => {
    // Simulate: \e[7m%\e[27m + spaces + \r + spaces + \r + escape codes + \e[J + prompt
    const mark = `${ESC}[7m%${ESC}[27m`;
    const spaces80 = ' '.repeat(78);
    const cleanup = `\r${' '.repeat(78)}\r\r${ESC}[0m\r${ESC}[27m${ESC}[24m`;
    const eraseDisplay = `${ESC}[J`;
    const prompt = `rl@MacBook 520-program % `;

    const buffer = `${mark}${spaces80}${cleanup}${eraseDisplay}${prompt}`;
    const result = stripPromptEolMark(buffer);

    // The mark through \e[J should be stripped, leaving only the prompt
    expect(result).toBe(prompt);
    // Must NOT contain the reversed % sequence
    expect(result).not.toContain(`${ESC}[7m%${ESC}[27m`);
  });

  test('Primary path: handles \\e[0J variant', () => {
    const mark = `${ESC}[7m%${ESC}[27m`;
    const filler = `${'x'.repeat(10)}\r${'y'.repeat(10)}\r${ESC}[0m`;
    const eraseDisplay = `${ESC}[0J`;
    const prompt = `user@host ~ % `;

    const buffer = `${mark}${filler}${eraseDisplay}${prompt}`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe(prompt);
  });

  test('Primary path: handles \\e[2J variant', () => {
    const mark = `${ESC}[7m%${ESC}[27m`;
    const filler = `${' '.repeat(30)}\r${ESC}[K`;
    const eraseDisplay = `${ESC}[2J`;
    const prompt = `$ `;

    const buffer = `${mark}${filler}${eraseDisplay}${prompt}`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe(prompt);
  });

  test('Fallback path: strips mark + double-CR when \\e[J is absent', () => {
    // Some zsh configs may not emit \e[J
    const mark = `${ESC}[7m%${ESC}[27m`;
    const spaces = ' '.repeat(40);
    const buffer = `${mark}${spaces}\r${spaces}\rprompt % `;

    const result = stripPromptEolMark(buffer);
    expect(result).toBe('prompt % ');
    expect(result).not.toContain(`${ESC}[7m%${ESC}[27m`);
  });

  test('Does not strip legitimate content without PROMPT_EOL_MARK', () => {
    const normalOutput = `ls -la\ntotal 42\ndrwxr-xr-x  5 user group\nuser@host % `;
    const result = stripPromptEolMark(normalOutput);
    expect(result).toBe(normalOutput); // Unchanged
  });

  test('Does not strip across newline boundaries', () => {
    // If there's a newline between the mark and \e[J, the primary regex should NOT match
    const mark = `${ESC}[7m%${ESC}[27m`;
    const buffer = `${mark} some text\nmore text ${ESC}[J prompt`;
    const result = stripPromptEolMark(buffer);
    // Primary won't match (newline in between), fallback also won't match (no double \r)
    expect(result).toBe(buffer); // Unchanged
  });

  test('Preserves command output after the prompt', () => {
    const mark = `${ESC}[7m%${ESC}[27m`;
    const cleanup = `${' '.repeat(20)}\r${' '.repeat(20)}\r${ESC}[0m${ESC}[J`;
    const prompt = `user@host ~ % `;
    const commandOutput = `ls\nfile1.txt\nfile2.txt\nuser@host ~ % `;

    const buffer = `${mark}${cleanup}${prompt}${commandOutput}`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe(`${prompt}${commandOutput}`);
  });

  test('Handles multiple PROMPT_EOL_MARK sequences (e.g. after clear)', () => {
    const mark = `${ESC}[7m%${ESC}[27m`;
    const seq = `${mark}${' '.repeat(10)}\r${' '.repeat(10)}\r${ESC}[J`;
    const prompt = `user@host % `;

    // Two marks (e.g., user ran `clear` which triggers a new prompt)
    const buffer = `${seq}${prompt}some output\n${seq}${prompt}`;
    const result = stripPromptEolMark(buffer);
    expect(result).toBe(`${prompt}some output\n${prompt}`);
  });

  test('Empty string returns empty string', () => {
    expect(stripPromptEolMark('')).toBe('');
  });
});
