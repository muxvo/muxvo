/**
 * Grid resize manager for column/row ratio adjustments.
 */

interface GridResizeOpts {
  cols: number;
  rows: number;
  columnRatios?: number[];
  rowRatios?: number[];
  viewMode?: string;
}

interface GridResizeManager {
  columnRatios: number[];
  rowRatios: number[];
  cursor: string;
  startColResize(index: number, event: { clientX: number }, containerSize?: number): boolean;
  moveResize(event: { clientX?: number; clientY?: number }): void;
  endResize(): void;
  startRowResize(index: number, event: { clientY: number }, containerSize?: number): void;
  doubleClickColGap(index: number): void;
  doubleClickRowGap(index: number): void;
}

export function createGridResizeManager(opts: GridResizeOpts): GridResizeManager {
  let resizeType: 'col' | 'row' | null = null;
  let resizeIndex = -1;
  let startPos = 0;
  let containerPx = 0;

  const manager: GridResizeManager = {
    columnRatios: opts.columnRatios ? [...opts.columnRatios] : Array(opts.cols).fill(1),
    rowRatios: opts.rowRatios ? [...opts.rowRatios] : Array(opts.rows).fill(1),
    cursor: 'default',

    startColResize(index: number, event: { clientX: number }, containerSize?: number): boolean {
      if (opts.viewMode === 'Focused') return false;
      resizeType = 'col';
      resizeIndex = index;
      startPos = event.clientX;
      containerPx = containerSize ?? 0;
      manager.cursor = 'col-resize';
      return true;
    },

    moveResize(event: { clientX?: number; clientY?: number }) {
      if (!resizeType) return;
      if (resizeType === 'col' && event.clientX !== undefined) {
        const delta = event.clientX - startPos;
        const totalRatio = manager.columnRatios[resizeIndex] + manager.columnRatios[resizeIndex + 1];
        const ratioSum = manager.columnRatios.reduce((a, b) => a + b, 0);
        // Use actual container pixels for precise conversion when available
        const totalPx = containerPx > 0
          ? (totalRatio / ratioSum) * containerPx
          : 1000;
        const shift = (delta / totalPx) * totalRatio;
        const newLeft = manager.columnRatios[resizeIndex] + shift;
        const newRight = totalRatio - newLeft;
        if (newLeft > 0.1 && newRight > 0.1) {
          manager.columnRatios[resizeIndex] = newLeft;
          manager.columnRatios[resizeIndex + 1] = newRight;
        }
        startPos = event.clientX;
      } else if (resizeType === 'row' && event.clientY !== undefined) {
        const delta = event.clientY - startPos;
        const totalRatio = manager.rowRatios[resizeIndex] + manager.rowRatios[resizeIndex + 1];
        const ratioSum = manager.rowRatios.reduce((a, b) => a + b, 0);
        const totalPx = containerPx > 0
          ? (totalRatio / ratioSum) * containerPx
          : 1000;
        const shift = (delta / totalPx) * totalRatio;
        const newTop = manager.rowRatios[resizeIndex] + shift;
        const newBottom = totalRatio - newTop;
        if (newTop > 0.1 && newBottom > 0.1) {
          manager.rowRatios[resizeIndex] = newTop;
          manager.rowRatios[resizeIndex + 1] = newBottom;
        }
        startPos = event.clientY;
      }
    },

    endResize() {
      resizeType = null;
      resizeIndex = -1;
      containerPx = 0;
    },

    startRowResize(index: number, event: { clientY: number }, containerSize?: number) {
      resizeType = 'row';
      resizeIndex = index;
      startPos = event.clientY;
      containerPx = containerSize ?? 0;
      manager.cursor = 'row-resize';
    },

    doubleClickColGap(_index: number) {
      const count = manager.columnRatios.length;
      manager.columnRatios = Array(count).fill(1);
    },

    doubleClickRowGap(_index: number) {
      const count = manager.rowRatios.length;
      manager.rowRatios = Array(count).fill(1);
    },
  };

  return manager;
}
