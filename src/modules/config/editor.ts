/**
 * Config editor module
 */

export async function editFile(path: string, content: string) {
  return {
    path,
    content,
    saved: true,
  };
}
