/**
 * Path display utilities for terminal tile headers.
 */

/** Shorten a filesystem path for display (replace home with ~, truncate middle segments) */
export function shortenPath(path: string, truncate = true): string {
  const home = window.api.app.getHomePath();
  let short = path;
  if (home && home !== '/' && path.startsWith(home)) {
    short = '~' + path.slice(home.length);
  }
  if (truncate) {
    const parts = short.split('/');
    if (parts.length > 3) {
      // 空间有限，优先保证最后的文件夹名完整可见
      return parts[0] + '/\u2026/' + parts[parts.length - 1];
    }
  }
  return short;
}
