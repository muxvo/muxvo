/**
 * Virtual Scroller
 *
 * Renders only visible items in long lists for performance.
 */

interface VirtualScrollOpts {
  totalItems: number;
  itemHeight: number;
  containerHeight: number;
}

export function createVirtualScroller(opts: VirtualScrollOpts) {
  const { totalItems, itemHeight, containerHeight } = opts;
  let scrollTop = 0;

  return {
    getVisibleItems() {
      const startIndex = Math.floor(scrollTop / itemHeight);
      const visibleCount = Math.ceil(containerHeight / itemHeight) + 2; // +2 buffer
      const endIndex = Math.min(startIndex + visibleCount, totalItems);

      const items: Array<{ index: number; top: number }> = [];
      for (let i = startIndex; i < endIndex; i++) {
        items.push({ index: i, top: i * itemHeight });
      }
      return items;
    },

    scrollTo(top: number) {
      scrollTop = Math.max(0, top);
    },
  };
}
