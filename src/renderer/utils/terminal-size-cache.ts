/**
 * Shared terminal size cache.
 *
 * XTermRenderer updates this on every fit/resize so that new terminal
 * creation can pass a reasonable initial PTY size instead of the 80×24 default.
 */

let cachedCols = 80;
let cachedRows = 24;

export function updateTerminalSizeCache(cols: number, rows: number): void {
  if (cols >= 10) cachedCols = cols;
  if (rows >= 2) cachedRows = rows;
}

export function getTerminalSizeCache(): { cols: number; rows: number } {
  return { cols: cachedCols, rows: cachedRows };
}
