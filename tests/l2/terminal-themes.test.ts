/**
 * Terminal themes L2 tests
 * Validates theme completeness, fallback behavior, and theme listing
 */

import { describe, test, expect } from 'vitest';
import {
  TERMINAL_THEMES,
  resolveTerminalTheme,
  getTerminalThemeNames,
} from '@/shared/constants/terminal-themes';

const REQUIRED_ANSI_FIELDS = [
  'background',
  'foreground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

describe('Terminal Themes L2', () => {
  const themeNames = getTerminalThemeNames();

  test.each(themeNames)('theme "%s" has all required ANSI color fields', (name) => {
    const theme = TERMINAL_THEMES[name];
    for (const field of REQUIRED_ANSI_FIELDS) {
      expect(theme[field], `${name}.${field}`).toBeDefined();
      expect(typeof theme[field]).toBe('string');
    }
  });

  test('resolveTerminalTheme returns dark theme for unknown name', () => {
    const theme = resolveTerminalTheme('nonexistent');
    expect(theme).toBe(TERMINAL_THEMES.dark);
  });

  test('resolveTerminalTheme returns correct theme for valid name', () => {
    expect(resolveTerminalTheme('dracula')).toBe(TERMINAL_THEMES.dracula);
  });

  test('getTerminalThemeNames returns 5 theme names', () => {
    expect(themeNames).toHaveLength(5);
    expect(themeNames).toContain('dark');
    expect(themeNames).toContain('light');
    expect(themeNames).toContain('monokai');
    expect(themeNames).toContain('dracula');
    expect(themeNames).toContain('solarized-dark');
  });
});
