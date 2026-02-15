/**
 * File preview module
 */

export function openPreview(filename: string) {
  const ext = filename.split('.').pop() || '';
  const isMarkdown = ext === 'md';

  return {
    filename,
    layout: 'three-column' as const,
    rendered: isMarkdown,
    format: isMarkdown ? 'markdown' : 'text',
  };
}
