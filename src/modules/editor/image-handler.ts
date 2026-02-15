/**
 * Editor image handler - paste image support
 */

export async function handleImagePaste(opts: { format: string; size: number }) {
  return {
    format: opts.format,
    size: opts.size,
    thumbnail: {
      width: 120,
      height: 90,
      dataUrl: 'data:image/png;base64,placeholder',
    },
    accepted: true,
  };
}
