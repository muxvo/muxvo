export function calculateGridLayout(terminalCount: number) {
  if (terminalCount <= 0) {
    return { cols: 0, rows: 0 };
  }
  if (terminalCount <= 3) {
    return { cols: terminalCount, rows: 1 };
  }

  const cols = Math.ceil(Math.sqrt(terminalCount));
  const rows = Math.ceil(terminalCount / cols);

  const result: {
    cols: number;
    rows: number;
    lastRowCentered?: boolean;
    distribution?: number[];
  } = { cols, rows };

  const lastRowCount = terminalCount - cols * (rows - 1);

  if (lastRowCount < cols) {
    result.lastRowCentered = true;
  }

  // Build distribution array if there are multiple rows
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
