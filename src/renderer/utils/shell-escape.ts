/**
 * Shell-escape utilities for safe file path insertion into terminals.
 */

/** Shell-escape a single file path for safe insertion into a terminal. */
export function shellEscapePath(path: string): string {
  if (/^[a-zA-Z0-9_.\/~:-]+$/.test(path)) return path;
  return "'" + path.replace(/'/g, "'" + '"' + "'" + '"' + "'") + "'";
}

/** Escape multiple paths and join with spaces. */
export function shellEscapePaths(paths: string[]): string {
  return paths.map(shellEscapePath).join(' ');
}
