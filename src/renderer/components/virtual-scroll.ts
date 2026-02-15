/**
 * Virtual Scroll List
 *
 * Provides virtual scrolling for long lists, rendering only visible items
 * plus a small buffer for smooth scrolling.
 */

interface VirtualScrollOptions {
  totalItems: number;
  itemHeight: number;
  viewportHeight: number;
  bufferSize?: number;
}

export function createVirtualScrollList(options: VirtualScrollOptions) {
  const { totalItems, itemHeight, viewportHeight, bufferSize = 2 } = options;
  const visibleCount = Math.ceil(viewportHeight / itemHeight);
  const renderedCount = Math.min(visibleCount + bufferSize, totalItems);

  return {
    getRenderedCount(): number {
      return renderedCount;
    },
    getTotalItems(): number {
      return totalItems;
    },
    getVisibleCount(): number {
      return visibleCount;
    },
  };
}
