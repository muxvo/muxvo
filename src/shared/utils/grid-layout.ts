export interface GridLayoutResult {
  cols: number;
  rows: number;
  rowPattern?: number[];
  spanRow?: Record<number, number>;
  distribution?: number[];
  lastRowCentered?: boolean;
}

export function calculateGridLayout(terminalCount: number): GridLayoutResult {
  if (terminalCount <= 0) {
    return { cols: 0, rows: 0 };
  }

  // Hardcoded optimal layouts for 1-9 terminals
  switch (terminalCount) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return { cols: 2, rows: 1 };
    case 3:
      return { cols: 3, rows: 1 };
    case 4:
      return { cols: 2, rows: 2, distribution: [2, 2] };
    case 5:
      // Row 0: 3 items each spanning 2 cols, Row 1: 2 items each spanning 3 cols
      return {
        cols: 6,
        rows: 2,
        rowPattern: [3, 2],
        spanRow: { 0: 2, 1: 3 },
        distribution: [3, 2],
      };
    case 6:
      return { cols: 3, rows: 2, distribution: [3, 3] };
    case 7:
      // Row 0: 4 items each spanning 3 cols, Row 1: 3 items each spanning 4 cols
      return {
        cols: 12,
        rows: 2,
        rowPattern: [4, 3],
        spanRow: { 0: 3, 1: 4 },
        distribution: [4, 3],
      };
    case 8:
      return { cols: 4, rows: 2, distribution: [4, 4] };
    case 9:
      return { cols: 3, rows: 3, distribution: [3, 3, 3] };
  }

  // General algorithm for >= 10 terminals
  const cols = Math.ceil(Math.sqrt(terminalCount));
  const rows = Math.ceil(terminalCount / cols);

  const result: GridLayoutResult = { cols, rows };

  const lastRowCount = terminalCount - cols * (rows - 1);

  if (lastRowCount < cols) {
    result.lastRowCentered = true;
  }

  // Build distribution array
  if (rows > 1) {
    const dist: number[] = [];
    let remaining = terminalCount;
    for (let r = 0; r < rows; r++) {
      const rowCount = Math.min(cols, remaining);
      dist.push(rowCount);
      remaining -= rowCount;
    }
    result.distribution = dist;
  }

  return result;
}
