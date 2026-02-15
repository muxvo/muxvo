/**
 * Session Detail Loader
 *
 * Paged loading of session messages for large conversations.
 */

interface DetailLoaderOpts {
  totalMessages: number;
  pageSize: number;
}

export function createSessionDetailLoader(opts: DetailLoaderOpts) {
  const { totalMessages, pageSize } = opts;
  let loadedCount = 0;

  return {
    get loadedCount() { return loadedCount; },

    async loadPage(pageNumber: number) {
      const remaining = totalMessages - loadedCount;
      const count = Math.min(pageSize, remaining);
      const page = Array.from({ length: count }, (_, i) => ({
        index: loadedCount + i,
        content: `Message ${loadedCount + i}`,
      }));
      loadedCount += count;
      return page;
    },
  };
}
