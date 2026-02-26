/**
 * Input Detector L2 Tests
 *
 * Tests the interactive prompt detection logic used to trigger
 * the WaitingInput state transition in terminals.
 *
 * Covers: per-terminal buffer isolation, combo detection (question + selector),
 * Esc-to-cancel signal, ANSI stripping, carriage return normalization,
 * and exclusion rules.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { detectWaitingInput, resetInputDetector } from '@/main/services/terminal/input-detector';

describe('Input Detector L2', () => {
  beforeEach(() => {
    resetInputDetector(); // Clear all buffers between tests
  });

  // ---------------------------------------------------------------------------
  // Per-terminal buffer isolation (Bug 1 fix)
  // ---------------------------------------------------------------------------
  describe('Per-terminal buffer isolation', () => {
    test('two terminals interleaving output: prompt split across chunks detected', () => {
      // Terminal A sends first chunk (question only)
      detectWaitingInput('Do you want to make this edit to foo.ts?\n', 'term-A');
      // Terminal B sends unrelated output — should NOT corrupt A's buffer
      detectWaitingInput('npm install completed\n', 'term-B');
      // Terminal A sends second chunk (numbered options)
      const result = detectWaitingInput('❯ 1. Yes\n  2. No\n', 'term-A');
      expect(result).toBe(true);
    });

    test('resetInputDetector(id) only clears that terminal buffer', () => {
      // Both terminals accumulate data
      detectWaitingInput('Do you want to proceed?\n', 'term-A');
      detectWaitingInput('Would you like to continue?\n', 'term-B');
      // Reset only A
      resetInputDetector('term-A');
      // B's data should still be intact — feed selector to trigger combo
      const resultB = detectWaitingInput('❯ 1. Yes\n', 'term-B');
      expect(resultB).toBe(true);
      // A lost its data — question alone won't trigger
      const resultA = detectWaitingInput('❯ 1. Yes\n', 'term-A');
      // A only has "❯ 1. Yes" without question — should NOT trigger combo
      expect(resultA).toBe(false);
    });

    test('resetInputDetector() without args clears all buffers', () => {
      detectWaitingInput('Esc to cancel\n', 'term-A');
      // Don't consume — reset all
      resetInputDetector();
      // Now feed just selector, no question — should not match
      const result = detectWaitingInput('❯ 1. Yes\n', 'term-A');
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Combo detection: question + ❯ numbered option
  // ---------------------------------------------------------------------------
  describe('Combo detection (question + numbered selector)', () => {
    test('question line + ❯ selector → triggers', () => {
      const output = 'Do you want to make this edit to TerminalTitle.tsx?\n❯ 1. Yes\n  2. No\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('question only, no ❯ selector → does NOT trigger', () => {
      const output = 'Do you want to make this edit to foo.ts?\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(false);
    });

    test('❯ selector only, no question → does NOT trigger', () => {
      const output = '❯ 1. Yes\n  2. No\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(false);
    });

    test('Claude Code "create" variant → triggers', () => {
      const output = 'Do you want to create auth-frontend-design.md?\n❯ 1. Yes\n  2. Yes, allow all edits\n  3. No\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('Claude Code "allow" variant → triggers', () => {
      const output = 'Do you want to allow Claude to fetch this content?\n❯ 1. Yes\n  2. Yes, and don\'t ask again\n  3. No\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('Claude Code "run" variant → triggers', () => {
      const output = 'Do you want to run this bash command?\n❯ 1. Yes\n  2. No\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('Would you like to proceed? + selector → triggers', () => {
      const output = 'Would you like to proceed?\n❯ 1. Yes, clear context\n  2. Yes, auto-accept\n  3. No\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Esc to cancel (independent precise signal)
  // ---------------------------------------------------------------------------
  describe('Esc to cancel signal', () => {
    test('"Esc to cancel" alone → triggers', () => {
      const output = 'Esc to cancel · Tab to amend\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('"Esc to cancel" with ANSI styling → triggers', () => {
      const output = '\x1b[2mEsc to cancel\x1b[0m · Tab to amend\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Generic patterns (preserved from original)
  // ---------------------------------------------------------------------------
  describe('Generic interactive patterns', () => {
    test('(y/n) confirmation → triggers', () => {
      expect(detectWaitingInput('Continue? (y/n) ', 'term-1')).toBe(true);
    });

    test('[y/N] confirmation → triggers', () => {
      expect(detectWaitingInput('Overwrite? [y/N] ', 'term-1')).toBe(true);
    });

    test('Press any key → triggers', () => {
      expect(detectWaitingInput('Press any key to continue...', 'term-1')).toBe(true);
    });

    test('Enter to continue → triggers', () => {
      expect(detectWaitingInput('Enter to continue', 'term-1')).toBe(true);
    });

    test('inquirer "? question:" style → triggers', () => {
      expect(detectWaitingInput('? Select an option:\n', 'term-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // ANSI stripping and \r normalization
  // ---------------------------------------------------------------------------
  describe('ANSI stripping and \\r normalization', () => {
    test('ANSI color codes stripped before matching', () => {
      const output = '\x1b[36m❯ 1. Yes\x1b[0m\n\x1b[2m  2. No\x1b[0m\nDo you want to proceed?\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('carriage return line overwrite handled correctly', () => {
      // Simulate ink redraw: old content overwritten by \r
      const output = 'old selection\r❯ 1. Yes\nDo you want to proceed?\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('OSC sequences stripped without affecting content', () => {
      const output = '\x1b]0;terminal title\x07Do you want to proceed?\n❯ 1. Yes\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // ink bare-\r rendering (Bug A fix: \r no longer strips content)
  // ---------------------------------------------------------------------------
  describe('ink bare-\\r rendering', () => {
    test('ink erase-line + bare \\r pattern → triggers ESC_CANCEL', () => {
      // ink renders: ESC[2K + content + \r (per line)
      const inkOutput = '\x1b[2KDo you want to edit foo.ts?\r\x1b[2K❯ 1. Yes\r\x1b[2K  2. No\r\x1b[2KEsc to cancel\r';
      expect(detectWaitingInput(inkOutput, 'term-1')).toBe(true);
    });

    test('ink erase-line pattern preserves combo detection (question + selector)', () => {
      // ink renders each line with ESC[2K (clear line) + content + \r\n or cursor move
      const inkOutput = '\x1b[2KDo you want to proceed?\r\n\x1b[2K❯ 1. Yes\r\n\x1b[2K  2. No\r\n';
      expect(detectWaitingInput(inkOutput, 'term-1')).toBe(true);
    });

    test('overwrite semantics: \\r followed by new content keeps new content', () => {
      // "old text\rnew text" → should keep "new text"
      const output = 'old stuff\rEsc to cancel · Tab\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // ESC_CANCEL bypasses exclusion rules (Bug B fix)
  // ---------------------------------------------------------------------------
  describe('ESC_CANCEL bypasses exclusion rules', () => {
    test('Esc to cancel survives [n/m] exclusion in tail', () => {
      // Buffer has both "Esc to cancel" and a [n/m] progress pattern in tail
      const output = 'Esc to cancel\nprocessing [1/3]\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });

    test('Esc to cancel survives percentage exclusion in tail', () => {
      const output = 'Esc to cancel\n50% done\n';
      expect(detectWaitingInput(output, 'term-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Exclusion rules (no false positives)
  // ---------------------------------------------------------------------------
  describe('Exclusion rules', () => {
    test('progress bar "50%" → does NOT trigger', () => {
      expect(detectWaitingInput('50% complete\n', 'term-1')).toBe(false);
    });

    test('progress "[3/10]" → does NOT trigger', () => {
      expect(detectWaitingInput('Building [3/10] modules\n', 'term-1')).toBe(false);
    });

    test('log line "INFO ..." → does NOT trigger', () => {
      expect(detectWaitingInput('INFO starting server\n', 'term-1')).toBe(false);
    });

    test('fish shell ❯ prompt without question → does NOT trigger', () => {
      expect(detectWaitingInput('❯ ', 'term-1')).toBe(false);
    });

    test('normal git output with ? in diff → does NOT trigger', () => {
      // Has "?" in content but no ❯ selector, no inquirer format
      expect(detectWaitingInput('diff --git a/file.ts\n+  // TODO: what is this?\n', 'term-1')).toBe(false);
    });
  });
});
