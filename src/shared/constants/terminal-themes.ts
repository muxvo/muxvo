/**
 * Terminal theme definitions for xterm.js
 * 5 built-in themes with full ANSI 16-color palettes
 */

import type { ITheme } from '@xterm/xterm';
import type { TerminalThemeName } from '@/shared/types/config.types';

const dark: ITheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#000000',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

const light: ITheme = {
  background: '#ffffff',
  foreground: '#383a42',
  cursor: '#526eff',
  cursorAccent: '#ffffff',
  selectionBackground: '#bfceff',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#4f525e',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const monokai: ITheme = {
  background: '#272822',
  foreground: '#f8f8f2',
  cursor: '#f8f8f0',
  cursorAccent: '#272822',
  selectionBackground: '#49483e',
  black: '#272822',
  red: '#f92672',
  green: '#a6e22e',
  yellow: '#f4bf75',
  blue: '#66d9ef',
  magenta: '#ae81ff',
  cyan: '#a1efe4',
  white: '#f8f8f2',
  brightBlack: '#75715e',
  brightRed: '#f92672',
  brightGreen: '#a6e22e',
  brightYellow: '#f4bf75',
  brightBlue: '#66d9ef',
  brightMagenta: '#ae81ff',
  brightCyan: '#a1efe4',
  brightWhite: '#f9f8f5',
};

const dracula: ITheme = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#282a36',
  selectionBackground: '#44475a',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

const solarizedDark: ITheme = {
  background: '#002b36',
  foreground: '#839496',
  cursor: '#93a1a1',
  cursorAccent: '#002b36',
  selectionBackground: '#073642',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#586e75',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3',
};

export const TERMINAL_THEMES: Record<TerminalThemeName, ITheme> = {
  dark,
  light,
  monokai,
  dracula,
  'solarized-dark': solarizedDark,
};

/** Resolve a theme by name, falling back to 'dark' for unknown names */
export function resolveTerminalTheme(name: string): ITheme {
  return TERMINAL_THEMES[name as TerminalThemeName] ?? TERMINAL_THEMES.dark;
}

/** Get all available theme names */
export function getTerminalThemeNames(): TerminalThemeName[] {
  return Object.keys(TERMINAL_THEMES) as TerminalThemeName[];
}
