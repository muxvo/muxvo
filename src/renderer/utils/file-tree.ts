/**
 * Shared file-tree utilities
 * Used by FileTempView and SkillsPanel for directory tree rendering.
 */

import type { FileEntry as IpcFileEntry } from '@/shared/types/fs.types';

/** Flat tree node with indent level for rendering */
export interface TreeEntry {
  name: string;
  type: 'file' | 'folder';
  ext?: string;
  indent: number;
  path?: string;
}

/** Image file extensions */
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

/** Spreadsheet file extensions */
const SPREADSHEET_EXTS = ['xlsx', 'xls'];

/** Code file extensions */
const CODE_EXTS = [
  'ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html', 'py', 'swift',
  'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'yaml', 'yml',
  'toml', 'xml', 'sql', 'rb', 'php', 'vue', 'svelte',
];

/** Map file extension to display type */
export function mapExtToFileType(ext: string): 'markdown' | 'code' | 'text' | 'image' | 'spreadsheet' | 'pdf' {
  if (['md', 'mdx', 'markdown'].includes(ext)) return 'markdown';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (SPREADSHEET_EXTS.includes(ext)) return 'spreadsheet';
  if (ext === 'pdf') return 'pdf';
  if (CODE_EXTS.includes(ext)) return 'code';
  return 'text';
}

/** Build local-file:// URL for serving images via custom protocol */
export function toLocalFileUrl(filePath: string): string {
  return `local-file://${encodeURIComponent(filePath)}`;
}

/** Map IPC file entries to flat tree nodes, sorted folders-first then alphabetical */
export function mapIpcToTree(entries: IpcFileEntry[], indent: number, showHidden = false): TreeEntry[] {
  return [...entries]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .filter(e => showHidden || !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      type: (e.isDirectory ? 'folder' : 'file') as 'file' | 'folder',
      ext: e.isDirectory ? undefined : (e.name.includes('.') ? e.name.split('.').pop() : undefined),
      indent,
      path: e.path,
    }));
}

/** Remove all entries that are children of the given parent (deeper indent) */
export function removeChildren(list: TreeEntry[], parentPath: string, parentIndent: number): TreeEntry[] {
  const parentIdx = list.findIndex(f => f.path === parentPath);
  if (parentIdx === -1) return list;
  let endIdx = parentIdx + 1;
  while (endIdx < list.length && list[endIdx].indent > parentIndent) {
    endIdx++;
  }
  return [...list.slice(0, parentIdx + 1), ...list.slice(endIdx)];
}

/** Insert children after a parent entry in the flat list */
export function insertAfter(list: TreeEntry[], parent: TreeEntry, children: TreeEntry[]): TreeEntry[] {
  const idx = list.findIndex(f => f.path === parent.path);
  if (idx === -1) return list;
  const cleaned = removeChildren(list, parent.path!, parent.indent);
  const insertIdx = cleaned.findIndex(f => f.path === parent.path);
  return [
    ...cleaned.slice(0, insertIdx + 1),
    ...children,
    ...cleaned.slice(insertIdx + 1),
  ];
}
