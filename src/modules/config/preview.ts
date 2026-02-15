/**
 * Config preview module
 */

export async function previewFile(path: string) {
  const ext = path.split('.').pop() || '';
  const isMarkdown = ext === 'md' || ext === 'MD';

  return {
    path,
    rendered: true,
    format: isMarkdown ? 'markdown' : 'text',
    content: '',
  };
}
