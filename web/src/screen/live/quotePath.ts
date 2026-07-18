/**
 * 拖拽/粘贴路径入终端的 shell 安全转义（specs/behavior/file-panel.md §0.5，REQ-020）。
 * 含 shell 元字符（[^A-Za-z0-9/._-]）时用单引号包裹并以 `'\''` 法转义内部单引号（legacy cd 舞蹈同式）；
 * 纯净路径原样。两种情形均追加尾随空格——与 macOS Finder→Terminal 拖放一致（路径成完整 token，
 * 便于用户续打下一个参数）。
 */
export function quotePath(path: string): string {
  const needsQuote = /[^A-Za-z0-9/._-]/.test(path);
  const body = needsQuote ? `'${path.replace(/'/g, "'\\''")}'` : path;
  return `${body} `;
}
