/**
 * B4 file 簇共用：dirs 字典 → 扁平展示树（specs/behavior/file-panel.md §3）。
 * 排序/过滤/缩进与 legacy mapIpcEntries / mapIpcToTree 同构：
 * 文件夹优先 → name.localeCompare → showHidden=false 滤点头条目；展开项子级 indent+1。
 */

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

export interface FlatEntry {
  name: string;
  type: 'file' | 'folder';
  ext?: string;
  /** 仅文件且 fixture 给了 size（file-panel 尺寸徽记） */
  meta?: string;
  indent: number;
  path: string;
  expanded?: boolean;
}

/** legacy FilePanel.formatFileSize 同构 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** legacy FileItem.getFileIcon 同构 */
export function fileIcon(type: 'file' | 'folder', ext?: string, expanded?: boolean): string {
  if (type === 'folder') return expanded ? '\u{1F4C2}' : '\u{1F4C1}';
  if (ext === 'md') return '\u{1F4DD}';
  if (ext === 'json') return '⚙️';
  return '\u{1F4C4}';
}

function levelOf(
  dirs: Record<string, DirEntry[]>,
  dirPath: string,
  indent: number,
  expanded: Set<string>,
  showHidden: boolean,
  withMeta: boolean,
): FlatEntry[] {
  const entries = [...(dirs[dirPath] ?? [])]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .filter((e) => showHidden || !e.name.startsWith('.'));

  const out: FlatEntry[] = [];
  for (const e of entries) {
    const path = `${dirPath}/${e.name}`;
    const isOpen = e.isDirectory && expanded.has(path);
    out.push({
      name: e.name,
      type: e.isDirectory ? 'folder' : 'file',
      ext: e.isDirectory ? undefined : e.name.includes('.') ? e.name.split('.').pop() : undefined,
      meta: withMeta && !e.isDirectory && e.size != null ? formatFileSize(e.size) : undefined,
      indent,
      path,
      expanded: e.isDirectory ? isOpen : undefined,
    });
    if (isOpen) {
      out.push(...levelOf(dirs, path, indent + 1, expanded, showHidden, withMeta));
    }
  }
  return out;
}

export function flattenTree(
  dirs: Record<string, DirEntry[]>,
  rootPath: string,
  expandedPaths: string[],
  showHidden: boolean,
  withMeta: boolean,
): FlatEntry[] {
  return levelOf(dirs, rootPath, 0, new Set(expandedPaths), showHidden, withMeta);
}
