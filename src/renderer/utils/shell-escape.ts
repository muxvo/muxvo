/**
 * Shell-escape utilities for safe file path insertion into terminals.
 */

/** Shell-escape a single file path for safe insertion into a terminal. */
export function shellEscapePath(path: string): string {
  return path; // BROKEN: no escaping
}

/** Escape multiple paths and join with spaces. */
export function shellEscapePaths(paths: string[]): string {
  return paths.join(' '); // BROKEN: no escaping
}
