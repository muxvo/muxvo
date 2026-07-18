// M2 B1 spec 翻牌：grid-layout.spec.json 全文件 test.each 注入（13 case，全量 implemented+owner=web，
// spec-runner E_INJECTION_PARTIAL 硬约束）。expected 全部来自冻结 spec JSON，不造平行常量。
//
// 适配映射 rowDistribution(n) → calculateGridLayout(n)：
//   rows         = dist.length（每行个数数组的长度）
//   cols         = 各行个数的最小公倍数 LCM（统一列数网格：第 r 行每个 item 跨 cols/dist[r] 列
//                  实现居中，与 legacy 的 5→6 列、7→12 列 span 方案一致；均匀网格时 LCM=每行个数）
//   rowPattern   = distribution = dist
//   spanRow[r]   = cols / dist[r]
import { expect, test } from 'vitest';
import spec from '../../specs/legacy/l2/grid-layout.spec.json';
import { rowDistribution } from '../src/grid/layout';

interface GridCase {
  id: string;
  description: string;
  input: { terminalCount: number };
  expected: Record<string, unknown>;
}

const cases = spec.cases as unknown as GridCase[];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

/** 把真实工件 rowDistribution 映射成 legacy calculateGridLayout 的输出形状 */
function calculateGridLayout(terminalCount: number): Record<string, unknown> {
  const dist = rowDistribution(terminalCount);
  const rows = dist.length;
  const cols = rows === 0 ? 0 : dist.reduce(lcm, 1);
  const spanRow: Record<string, number> = {};
  dist.forEach((count, r) => {
    spanRow[String(r)] = cols / count;
  });
  return { cols, rows, rowPattern: dist, distribution: dist, spanRow };
}

test.each(cases)('$id: $description', (c) => {
  const actual = calculateGridLayout(c.input.terminalCount);
  for (const [key, want] of Object.entries(c.expected)) {
    expect(actual[key], `${c.id} expected.${key}`).toEqual(want);
  }
});
