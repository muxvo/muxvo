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
import { detectWaitingInput, resetInputDetector, shouldExitWaiting, detectBellSignal, detectOscNotification } from '@/main/services/terminal/input-detector';

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

  // ---------------------------------------------------------------------------
  // shouldExitWaiting (auto-recovery from WaitingInput)
  // ---------------------------------------------------------------------------
  describe('shouldExitWaiting (auto-recovery)', () => {
    test('returns false when buffer is empty (just cleared by positive detection)', () => {
      // Trigger a positive detection → buffer is deleted
      detectWaitingInput('Esc to cancel\n', 'term-1');
      expect(shouldExitWaiting('term-1')).toBe(false);
    });

    test('returns false when buffer has less than 2000 bytes', () => {
      // After positive detection, feed small output
      detectWaitingInput('Esc to cancel\n', 'term-1'); // triggers, clears buffer
      detectWaitingInput('⠋ Sketching...\n', 'term-1'); // small new output
      expect(shouldExitWaiting('term-1')).toBe(false);
    });

    test('returns true when buffer has >= 2000 bytes of new output', () => {
      // After positive detection, feed substantial output
      detectWaitingInput('Esc to cancel\n', 'term-1'); // triggers, clears buffer
      const largeOutput = 'x'.repeat(2000);
      detectWaitingInput(largeOutput, 'term-1');
      expect(shouldExitWaiting('term-1')).toBe(true);
    });

    test('returns false for unknown terminal id', () => {
      expect(shouldExitWaiting('nonexistent')).toBe(false);
    });

    test('returns false after resetInputDetector clears buffer', () => {
      // Accumulate enough data
      detectWaitingInput('x'.repeat(2100), 'term-1');
      expect(shouldExitWaiting('term-1')).toBe(true);
      // Reset clears buffer
      resetInputDetector('term-1');
      expect(shouldExitWaiting('term-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // detectBellSignal (terminal bell detection)
  // ---------------------------------------------------------------------------
  describe('detectBellSignal', () => {
    test('standalone BEL character → true', () => {
      expect(detectBellSignal('\x07')).toBe(true);
    });

    test('BEL within normal text → true', () => {
      expect(detectBellSignal('some output\x07more output')).toBe(true);
    });

    test('BEL as OSC terminator (OSC 7 cwd) → false', () => {
      // OSC 7: \x1b]7;file://host/path\x07
      expect(detectBellSignal('\x1b]7;file://localhost/Users/test\x07')).toBe(false);
    });

    test('BEL as OSC 0 title terminator → false', () => {
      expect(detectBellSignal('\x1b]0;terminal title\x07')).toBe(false);
    });

    test('OSC terminated BEL + standalone BEL → true', () => {
      // Has both an OSC sequence (BEL as terminator) and a standalone BEL
      expect(detectBellSignal('\x1b]0;title\x07\x07')).toBe(true);
    });

    test('no BEL at all → false', () => {
      expect(detectBellSignal('normal output without bell')).toBe(false);
    });

    test('ANSI escape sequences without BEL → false', () => {
      expect(detectBellSignal('\x1b[32mgreen text\x1b[0m')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // detectOscNotification (OSC 9 / OSC 777 parsing)
  // ---------------------------------------------------------------------------
  describe('detectOscNotification', () => {
    test('OSC 9 notification → parsed correctly', () => {
      const result = detectOscNotification('\x1b]9;Task completed\x07');
      expect(result).toEqual({ type: 9, message: 'Task completed' });
    });

    test('OSC 777 notification → parsed correctly', () => {
      const result = detectOscNotification('\x1b]777;notify;Claude Code;Permission needed\x07');
      expect(result).toEqual({ type: 777, message: 'Claude Code: Permission needed' });
    });

    test('no OSC notification → null', () => {
      expect(detectOscNotification('regular terminal output')).toBeNull();
    });

    test('OSC 7 (cwd change) is NOT a notification → null', () => {
      expect(detectOscNotification('\x1b]7;file://localhost/path\x07')).toBeNull();
    });

    test('OSC 0 (title) is NOT a notification → null', () => {
      expect(detectOscNotification('\x1b]0;window title\x07')).toBeNull();
    });

    test('OSC 9 embedded in other output → parsed', () => {
      const result = detectOscNotification('prefix\x1b]9;bell message\x07suffix');
      expect(result).toEqual({ type: 9, message: 'bell message' });
    });
  });
});
