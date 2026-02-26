/**
 * VERIFY: WaitingInput detection fixes
 *
 * Bug A: stripAnsi() \r handling deleted ink-rendered content entirely
 * Bug B: Exclusion rules blocked ESC_CANCEL high-precision signal
 *
 * Tests simulate real Claude Code ink output patterns.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { detectWaitingInput, resetInputDetector } from '@/main/services/terminal/input-detector';

describe('VERIFY: WaitingInput detection fixes', () => {
  beforeEach(() => {
    resetInputDetector();
  });

  // -----------------------------------------------------------------------
  // Bug A: ink bare-\r rendering must not strip content
  // -----------------------------------------------------------------------
  describe('Bug A: ink bare-\\r content preservation', () => {
    test('real CC permission prompt with ESC[2K + bare \\r → detects ESC_CANCEL', () => {
      // This is the actual pattern ink produces for CC approval prompts:
      // Each line: ESC[2K (clear line) + styled content + \r (cursor to col 0)
      const inkOutput = [
        '\x1b[2K\x1b[1m  Do you want to run this bash command?\x1b[0m\r',
        '\x1b[2K\x1b[36m❯ 1. Yes\x1b[0m\r',
        '\x1b[2K    2. Yes, and don\'t ask again for this tool\r',
        '\x1b[2K    3. No\r',
        '\x1b[2K\x1b[2mEsc to cancel · Tab to amend\x1b[0m\r',
      ].join('');
      expect(detectWaitingInput(inkOutput, 'verify-1')).toBe(true);
    });

    test('CC prompt split across two output chunks → detects on second chunk', () => {
      // First chunk: question + options
      const chunk1 = [
        '\x1b[2K\x1b[1m  Do you want to edit foo.ts?\x1b[0m\r',
        '\x1b[2K\x1b[36m❯ 1. Yes\x1b[0m\r',
      ].join('');
      // Second chunk: more options + Esc to cancel
      const chunk2 = [
        '\x1b[2K    2. No\r',
        '\x1b[2K\x1b[2mEsc to cancel\x1b[0m\r',
      ].join('');

      const result1 = detectWaitingInput(chunk1, 'verify-2');
      // Might or might not detect on first chunk (no Esc to cancel yet)
      const result2 = detectWaitingInput(chunk2, 'verify-2');
      // Must detect on second chunk when buffer has full prompt
      expect(result2).toBe(true);
    });

    test('bare \\r at end of single-line content is preserved (not deleted)', () => {
      // "Esc to cancel\r" — the \r should be removed but content kept
      const output = 'Esc to cancel\r';
      expect(detectWaitingInput(output, 'verify-3')).toBe(true);
    });

    test('overwrite semantics still work: old\\rnew keeps new', () => {
      // "garbage\rEsc to cancel" — \r means overwrite, keep "Esc to cancel"
      const output = 'some old text\rEsc to cancel · Tab\n';
      expect(detectWaitingInput(output, 'verify-4')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Bug B: ESC_CANCEL must bypass exclusion rules
  // -----------------------------------------------------------------------
  describe('Bug B: ESC_CANCEL bypasses exclusion rules', () => {
    test('Esc to cancel NOT blocked by [n/m] progress pattern in tail', () => {
      // Buffer contains both "Esc to cancel" AND "[1/3]" in last 300 chars
      const output = 'Esc to cancel · Tab to amend\nStep [1/3] completed\n';
      expect(detectWaitingInput(output, 'verify-5')).toBe(true);
    });

    test('Esc to cancel NOT blocked by percentage pattern in tail', () => {
      const output = 'Esc to cancel\n75% complete\n';
      expect(detectWaitingInput(output, 'verify-6')).toBe(true);
    });

    test('Esc to cancel NOT blocked by log line pattern in tail', () => {
      const output = 'Esc to cancel\nINFO server started\n';
      expect(detectWaitingInput(output, 'verify-7')).toBe(true);
    });

    test('exclusion rules still work for non-ESC_CANCEL patterns', () => {
      // Generic (y/n) prompt should still be blocked by [n/m] exclusion
      const output = 'Continue? (y/n) \nBuilding [2/5] modules\n';
      expect(detectWaitingInput(output, 'verify-8')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Combined: real-world CC scenarios
  // -----------------------------------------------------------------------
  describe('Real-world CC scenarios', () => {
    test('CC bash command approval with full ink rendering', () => {
      // Simulates what CC actually sends when asking to run a command
      const fullOutput = [
        '\x1b[?25l',  // hide cursor
        '\x1b[2K\x1b[1m  Claude wants to run:\x1b[0m\r\n',
        '\x1b[2K\x1b[90m  ls -la /tmp\x1b[0m\r\n',
        '\x1b[2K\r\n',
        '\x1b[2K\x1b[36m  ❯ 1. Yes\x1b[0m\r\n',
        '\x1b[2K    2. Yes, and don\'t ask again\r\n',
        '\x1b[2K    3. No\r\n',
        '\x1b[2K\r\n',
        '\x1b[2K\x1b[2m  Esc to cancel · Tab to amend\x1b[0m\r\n',
        '\x1b[?25h',  // show cursor
      ].join('');
      expect(detectWaitingInput(fullOutput, 'verify-9')).toBe(true);
    });

    test('CC file edit approval', () => {
      const output = [
        '\x1b[2K  Do you want to create src/utils/helper.ts?\r\n',
        '\x1b[2K  ❯ 1. Yes\r\n',
        '\x1b[2K    2. Yes, allow all edits\r\n',
        '\x1b[2K    3. No\r\n',
        '\x1b[2K  Esc to cancel\r\n',
      ].join('');
      expect(detectWaitingInput(output, 'verify-10')).toBe(true);
    });
  });
});
