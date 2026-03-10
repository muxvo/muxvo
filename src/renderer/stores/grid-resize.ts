/**
 * Grid resize manager for column/row ratio adjustments.
 * Supports per-row independent column ratios for nested row grids.
 */

interface GridResizeOpts {
  cols: number;
  rows: number;
  columnRatios?: number[];
  rowRatios?: number[];
  /** Number of columns per row (e.g. [2, 2] for 4 terminals in 2x2) */
  distribution?: number[];
  perRowColumnRatios?: number[][];
  viewMode?: string;
}

interface GridResizeManager {
  /** Backward-compat: returns perRowColumnRatios[0] */
  columnRatios: number[];
  /** Per-row column ratios: each row has its own independent ratio array */
  perRowColumnRatios: number[][];
  rowRatios: number[];
  cursor: string;
  startColResize(rowIndex: number, colIndex: number, event: { clientX: number }, containerSize?: number): boolean;
  moveResize(event: { clientX?: number; clientY?: number }): void;
  endResize(): void;
  startRowResize(index: number, event: { clientY: number }, containerSize?: number): void;
  doubleClickColGap(rowIndex: number, colIndex: number): void;
  doubleClickRowGap(index: number): void;
}

export function createGridResizeManager(opts: GridResizeOpts): GridResizeManager {
  let resizeType: 'col' | 'row' | null = null;
  let resizeRowIndex = -1;
  let resizeColIndex = -1;
  let startPos = 0;
  let containerPx = 0;

  // Initialize per-row column ratios
  const initPerRowRatios = (): number[][] => {
    if (opts.perRowColumnRatios) {
      return opts.perRowColumnRatios.map((r) => [...r]);
    }
    if (opts.distribution) {
      return opts.distribution.map((count) =>
        opts.columnRatios ? opts.columnRatios.slice(0, count) : Array(count).fill(1),
      );
    }
    // Fallback: single row or uniform cols
    const ratios = opts.columnRatios ? [...opts.columnRatios] : Array(opts.cols).fill(1);
    if (opts.rows <= 1) {
      return [ratios];
    }
    return Array.from({ length: opts.rows }, () => [...ratios]);
  };

  const manager: GridResizeManager = {
    perRowColumnRatios: initPerRowRatios(),
    rowRatios: opts.rowRatios ? [...opts.rowRatios] : Array(opts.rows).fill(1),
    cursor: 'default',

    // Backward-compat getter/setter
    get columnRatios(): number[] {
      return manager.perRowColumnRatios[0] || [];
    },
    set columnRatios(val: number[]) {
      if (manager.perRowColumnRatios.length > 0) {
        manager.perRowColumnRatios[0] = val;
      }
    },

    startColResize(rowIndex: number, colIndex: number, event: { clientX: number }, containerSize?: number): boolean {
      if (opts.viewMode === 'Focused') return false;
      resizeType = 'col';
      resizeRowIndex = rowIndex;
      resizeColIndex = colIndex;
      startPos = event.clientX;
      containerPx = containerSize ?? 0;
      manager.cursor = 'col-resize';
      return true;
    },

    moveResize(event: { clientX?: number; clientY?: number }) {
      if (!resizeType) return;
      if (resizeType === 'col' && event.clientX !== undefined) {
        const ratios = manager.perRowColumnRatios[resizeRowIndex];
        if (!ratios) return;
        const delta = event.clientX - startPos;
        const totalRatio = ratios[resizeColIndex] + ratios[resizeColIndex + 1];
        const ratioSum = ratios.reduce((a, b) => a + b, 0);
        const totalPx = containerPx > 0
          ? (totalRatio / ratioSum) * containerPx
          : 1000;
        const shift = (delta / totalPx) * totalRatio;
        const newLeft = ratios[resizeColIndex] + shift;
        const newRight = totalRatio - newLeft;
        if (newLeft > 0.1 && newRight > 0.1) {
          ratios[resizeColIndex] = newLeft;
          ratios[resizeColIndex + 1] = newRight;
        }
        startPos = event.clientX;
      } else if (resizeType === 'row' && event.clientY !== undefined) {
        const delta = event.clientY - startPos;
        const totalRatio = manager.rowRatios[resizeRowIndex] + manager.rowRatios[resizeRowIndex + 1];
        const ratioSum = manager.rowRatios.reduce((a, b) => a + b, 0);
        const totalPx = containerPx > 0
          ? (totalRatio / ratioSum) * containerPx
          : 1000;
        const shift = (delta / totalPx) * totalRatio;
        const newTop = manager.rowRatios[resizeRowIndex] + shift;
        const newBottom = totalRatio - newTop;
        if (newTop > 0.1 && newBottom > 0.1) {
          manager.rowRatios[resizeRowIndex] = newTop;
          manager.rowRatios[resizeRowIndex + 1] = newBottom;
        }
        startPos = event.clientY;
      }
    },

    endResize() {
      resizeType = null;
      resizeRowIndex = -1;
      resizeColIndex = -1;
      containerPx = 0;
    },

    startRowResize(index: number, event: { clientY: number }, containerSize?: number) {
      resizeType = 'row';
      resizeRowIndex = index;
      startPos = event.clientY;
      containerPx = containerSize ?? 0;
      manager.cursor = 'row-resize';
    },

    doubleClickColGap(rowIndex: number, _colIndex: number) {
      const ratios = manager.perRowColumnRatios[rowIndex];
      if (ratios) {
        manager.perRowColumnRatios[rowIndex] = Array(ratios.length).fill(1);
      }
    },

    doubleClickRowGap(_index: number) {
      const count = manager.rowRatios.length;
      manager.rowRatios = Array(count).fill(1);
    },
  };

  return manager;
}
