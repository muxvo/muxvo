/**
 * VERIFY: WaitingInput state auto-recovers when process continues producing output.
 *
 * Root cause: detectWaitingInput() triggers WaitingInput on "Esc to cancel",
 * but when CC finishes the tool and continues (Envisioning, Sketching, etc.),
 * there was no mechanism to transition back to Running. The terminal tile
 * kept flashing its red border indefinitely.
 *
 * Fix: Added AUTO_RESUME event to state machine + shouldExitWaiting() check
 * in manager's onData callback. When WaitingInput + no pattern match +
 * buffer >= 500 bytes of new output → auto-recover to Running.
 *
 * Verifies:
 * 1. State machine accepts AUTO_RESUME in WaitingInput → Running
 * 2. shouldExitWaiting returns true after 500+ bytes accumulate post-detection
 * 3. shouldExitWaiting returns false with insufficient new output
 * 4. Integrated scenario: "Esc to cancel" → WaitingInput → substantial output → auto-recover
 * 5. Real prompt scenario: "Esc to cancel" → WaitingInput → no further output → stays waiting
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { detectWaitingInput, resetInputDetector, shouldExitWaiting } from '@/main/services/terminal/input-detector';
import { createTerminalMachine } from '@/shared/machines/terminal-process';

describe('VERIFY: WaitingInput auto-resume on continued output', () => {
  beforeEach(() => {
    resetInputDetector();
  });

  // --- State machine level ---

  test('AUTO_RESUME transitions WaitingInput → Running', () => {
    const machine = createTerminalMachine();
    machine.send('SPAWN');
    machine.send('SPAWN_SUCCESS');
    machine.send('WAIT_INPUT');
    expect(machine.state).toBe('WaitingInput');

    machine.send('AUTO_RESUME');
    expect(machine.state).toBe('Running');
  });

  test('AUTO_RESUME is ignored in states other than WaitingInput', () => {
    const machine = createTerminalMachine();
    machine.send('SPAWN');
    machine.send('SPAWN_SUCCESS');
    expect(machine.state).toBe('Running');

    machine.send('AUTO_RESUME');
    expect(machine.state).toBe('Running'); // no-op, stays Running
  });

  // --- shouldExitWaiting threshold ---

  test('shouldExitWaiting = false immediately after positive detection (buffer cleared)', () => {
    detectWaitingInput('Esc to cancel\n', 'term-auto');
    // Buffer was deleted by positive detection
    expect(shouldExitWaiting('term-auto')).toBe(false);
  });

  test('shouldExitWaiting = false with < 500 bytes of new output', () => {
    detectWaitingInput('Esc to cancel\n', 'term-auto'); // triggers, clears buffer
    // Simulate small output chunks (spinner updates)
    detectWaitingInput('\x1b[2K⠋ Sketching...\r', 'term-auto');
    detectWaitingInput('\x1b[2K⠙ Sketching...\r', 'term-auto');
    expect(shouldExitWaiting('term-auto')).toBe(false);
  });

  test('shouldExitWaiting = true with >= 500 bytes of new output', () => {
    detectWaitingInput('Esc to cancel\n', 'term-auto'); // triggers, clears buffer
    // Simulate substantial output (CC moved to next phase)
    const output = '\x1b[2K'.repeat(10) + 'Phase 2: Write Verification Test\n'.repeat(20);
    detectWaitingInput(output, 'term-auto');
    expect(shouldExitWaiting('term-auto')).toBe(true);
  });

  // --- Integrated scenario: the actual bug ---

  test('full scenario: Esc to cancel → WaitingInput → substantial output → should auto-recover', () => {
    const machine = createTerminalMachine();
    machine.send('SPAWN');
    machine.send('SPAWN_SUCCESS');
    expect(machine.state).toBe('Running');

    // Step 1: CC shows tool permission prompt with "Esc to cancel"
    const promptOutput = '\x1b[2mEsc to cancel\x1b[0m · Tab to amend\n';
    const detected1 = detectWaitingInput(promptOutput, 'term-scenario');
    expect(detected1).toBe(true);
    machine.send('WAIT_INPUT');
    expect(machine.state).toBe('WaitingInput');

    // Step 2: CC auto-approves (accept edits on), continues with thinking
    // Multiple spinner updates and tool output arrive
    const chunks = [
      '\x1b[2K⠋ Envisioning… (0s)\r',
      '\x1b[2K⠙ Envisioning… (1s)\r',
      '\x1b[2K⠹ Envisioning… (2s · thought for 1s)\r',
      '● Read 1 file (ctrl+o to expand)\n',
      '● Write(tests/verify/VERIFY-search-flash-fix.test.ts)\n',
      '  └ Wrote 84 lines to tests/verify/VERIFY-search-flash-fix.test.ts\n',
      '\x1b[2K⠋ Sketching… (1m 35s · thought for 21s)\r',
    ];

    let autoResumeTriggered = false;
    for (const chunk of chunks) {
      const det = detectWaitingInput(chunk, 'term-scenario');
      if (machine.state === 'WaitingInput' && !det && shouldExitWaiting('term-scenario')) {
        resetInputDetector('term-scenario');
        machine.send('AUTO_RESUME');
        autoResumeTriggered = true;
        break;
      }
    }

    expect(autoResumeTriggered).toBe(true);
    expect(machine.state).toBe('Running');
  });

  test('real prompt scenario: Esc to cancel → WaitingInput → no further output → stays waiting', () => {
    const machine = createTerminalMachine();
    machine.send('SPAWN');
    machine.send('SPAWN_SUCCESS');

    // CC shows tool permission prompt, user hasn't responded yet
    const promptOutput = 'Do you want to run this bash command?\n❯ 1. Yes\n  2. No\nEsc to cancel\n';
    const detected = detectWaitingInput(promptOutput, 'term-real-prompt');
    expect(detected).toBe(true);
    machine.send('WAIT_INPUT');
    expect(machine.state).toBe('WaitingInput');

    // No further output → shouldExitWaiting stays false
    expect(shouldExitWaiting('term-real-prompt')).toBe(false);
    expect(machine.state).toBe('WaitingInput');
  });
});
