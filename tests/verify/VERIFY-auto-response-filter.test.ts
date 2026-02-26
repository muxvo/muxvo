/**
 * VERIFY: Terminal auto-response filter prevents WaitingInput state oscillation.
 *
 * Bug: xterm.js sends cursor position reports (\x1b[row;colR) and focus events
 * back through write(), which triggers USER_INPUT and reverts WaitingInput → Running.
 * ink then redraws → detection triggers → WaitingInput → write reverts → ...
 * This rapid oscillation prevents red dot/badge from stably displaying.
 *
 * Fix: isTerminalAutoResponse() filters out terminal emulator auto-responses
 * so they don't trigger USER_INPUT state transition.
 */
import { describe, test, expect } from 'vitest';

// Import the exported filter function
const { isTerminalAutoResponse } = require('@/main/services/terminal/manager');

describe('VERIFY: isTerminalAutoResponse filter', () => {
  describe('should identify terminal auto-responses', () => {
    test('cursor position report \x1b[24;1R', () => {
      expect(isTerminalAutoResponse('\x1b[24;1R')).toBe(true);
    });

    test('cursor position report \x1b[1;1R', () => {
      expect(isTerminalAutoResponse('\x1b[1;1R')).toBe(true);
    });

    test('cursor position report with large numbers \x1b[999;120R', () => {
      expect(isTerminalAutoResponse('\x1b[999;120R')).toBe(true);
    });

    test('focus in event \x1b[I', () => {
      expect(isTerminalAutoResponse('\x1b[I')).toBe(true);
    });

    test('focus out event \x1b[O', () => {
      expect(isTerminalAutoResponse('\x1b[O')).toBe(true);
    });

    test('device attributes response \x1b[?1;2c', () => {
      expect(isTerminalAutoResponse('\x1b[?1;2c')).toBe(true);
    });

    test('device attributes response \x1b[?64;1;2;6;22c', () => {
      expect(isTerminalAutoResponse('\x1b[?64;1;2;6;22c')).toBe(true);
    });
  });

  describe('should NOT filter real user input', () => {
    test('Enter key \\r', () => {
      expect(isTerminalAutoResponse('\r')).toBe(false);
    });

    test('number selection "1"', () => {
      expect(isTerminalAutoResponse('1')).toBe(false);
    });

    test('yes confirmation "y"', () => {
      expect(isTerminalAutoResponse('y')).toBe(false);
    });

    test('no confirmation "n"', () => {
      expect(isTerminalAutoResponse('n')).toBe(false);
    });

    test('Escape key \\x1b', () => {
      expect(isTerminalAutoResponse('\x1b')).toBe(false);
    });

    test('arrow up \\x1b[A', () => {
      expect(isTerminalAutoResponse('\x1b[A')).toBe(false);
    });

    test('arrow down \\x1b[B', () => {
      expect(isTerminalAutoResponse('\x1b[B')).toBe(false);
    });

    test('typed text "hello"', () => {
      expect(isTerminalAutoResponse('hello')).toBe(false);
    });

    test('number + enter "1\\r"', () => {
      expect(isTerminalAutoResponse('1\r')).toBe(false);
    });
  });
});
