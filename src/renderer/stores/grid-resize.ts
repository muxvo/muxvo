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
  persistedRatios: number[];
  startColResize(index: number, event: { clientX: number }): boolean;
  moveResize(event: { clientX?: number; clientY?: number }): void;
  endResize(): void;
  startRowResize(index: number, event: { clientY: number }): void;
  doubleClickColGap(index: number): void;
  doubleClickRowGap(index: number): void;
}

export function createGridResizeManager(opts: GridResizeOpts): GridResizeManager {
  let resizeType: 'col' | 'row' | null = null;
  let resizeIndex = -1;
  let startPos = 0;

  const manager: GridResizeManager = {
    columnRatios: opts.columnRatios ? [...opts.columnRatios] : Array(opts.cols).fill(1),
    rowRatios: opts.rowRatios ? [...opts.rowRatios] : Array(opts.rows).fill(1),
    cursor: 'default',
    persistedRatios: [],

    startColResize(index: number, event: { clientX: number }): boolean {
      if (opts.viewMode === 'Focused') return false;
      resizeType = 'col';
      resizeIndex = index;
      startPos = event.clientX;
      manager.cursor = 'col-resize';
      return true;
    },

    moveResize(event: { clientX?: number; clientY?: number }) {
      if (!resizeType) return;
      if (resizeType === 'col' && event.clientX !== undefined) {
        const delta = event.clientX - startPos;
        const totalRatio = manager.columnRatios[resizeIndex] + manager.columnRatios[resizeIndex + 1];
        const shift = (delta / 1000) * totalRatio;
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
        const shift = (delta / 1000) * totalRatio;
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
      if (resizeType === 'col') {
        manager.persistedRatios = [...manager.columnRatios];
      } else if (resizeType === 'row') {
        manager.persistedRatios = [...manager.rowRatios];
      }
      resizeType = null;
      resizeIndex = -1;
    },

    startRowResize(index: number, event: { clientY: number }) {
      resizeType = 'row';
      resizeIndex = index;
      startPos = event.clientY;
      manager.cursor = 'row-resize';
    },

    doubleClickColGap(_index: number) {
      const count = manager.columnRatios.length;
      manager.columnRatios = Array(count).fill(1);
      manager.persistedRatios = [...manager.columnRatios];
    },

    doubleClickRowGap(_index: number) {
      const count = manager.rowRatios.length;
      manager.rowRatios = Array(count).fill(1);
      manager.persistedRatios = [...manager.rowRatios];
    },
  };

  return manager;
}
