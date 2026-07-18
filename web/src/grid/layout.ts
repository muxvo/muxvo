/**
 * 网格行列分布（spec/behavior/term-grid.md §1.1）
 * 返回每行终端数；行内等分、行高等分（fixture 静态屏不含拖拽后比例）。
 */

const FIXED_ROWS: Record<number, number[]> = {
  1: [1],
  2: [2],
  3: [3],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
  7: [4, 3],
  8: [4, 4],
  9: [3, 3, 3],
};

export function rowDistribution(n: number): number[] {
  if (n <= 0) return [];
  const fixed = FIXED_ROWS[n];
  if (fixed) return fixed;
  // ≥10 通用算法：cols=⌈√N⌉，逐行填满，余数进末行（末行等分整行宽 = lastRowCentered）
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const dist: number[] = [];
  let remaining = n;
  for (let r = 0; r < rows; r++) {
    const c = Math.min(cols, remaining);
    dist.push(c);
    remaining -= c;
  }
  return dist;
}

/** 把终端按行分布切片 */
export function splitRows<T>(items: T[], dist: number[]): T[][] {
  const rows: T[][] = [];
  let off = 0;
  for (const count of dist) {
    rows.push(items.slice(off, off + count));
    off += count;
  }
  return rows;
}

/** 相邻把手位置（累计比例 %，等分时即 i/n*100） */
export function handlePositions(count: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < count; i++) out.push((i / count) * 100);
  return out;
}
