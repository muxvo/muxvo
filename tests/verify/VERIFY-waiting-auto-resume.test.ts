/**
 * VERIFY: WaitingInput state transitions — AUTO_RESUME via acknowledgeWaiting (click to dismiss).
 *
 * After simplification, WaitingInput exits via:
 * 1. USER_INPUT — user types in terminal
 * 2. AUTO_RESUME — user clicks terminal tile (acknowledgeWaiting)
 * 3. Terminal exit (CLOSE + EXIT_NORMAL)
 *
 * Auto-resume via buffer accumulation has been removed in favor of explicit user action.
 */
import { describe, test, expect } from 'vitest';
import { createTerminalMachine } from '@/shared/machines/terminal-process';

describe('VERIFY: WaitingInput state transitions', () => {
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

  test('USER_INPUT transitions WaitingInput → Running', () => {
    const machine = createTerminalMachine();
    machine.send('SPAWN');
    machine.send('SPAWN_SUCCESS');
    machine.send('WAIT_INPUT');
    expect(machine.state).toBe('WaitingInput');

    machine.send('USER_INPUT');
    expect(machine.state).toBe('Running');
  });

  test('real prompt scenario: WaitingInput stays until explicit action', () => {
    const machine = createTerminalMachine();
    machine.send('SPAWN');
    machine.send('SPAWN_SUCCESS');
    machine.send('WAIT_INPUT');
    expect(machine.state).toBe('WaitingInput');

    // Without USER_INPUT or AUTO_RESUME, state stays
    expect(machine.state).toBe('WaitingInput');

    // User clicks tile → AUTO_RESUME
    machine.send('AUTO_RESUME');
    expect(machine.state).toBe('Running');
  });
});
