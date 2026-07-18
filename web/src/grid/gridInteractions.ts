/**
 * 网格交互纯逻辑（M3 批5③：拖拽重排 + 分隔条比例）。
 * 与 React/DOM 无耦合，node 环境可直接单测；hook（useGridInteractions）只负责状态与 DOM 事件接线。
 *
 * 权威：specs/behavior/term-grid.md §1.3（比例下限 0.1、相邻两格重分、均分重置）、
 * §3.4（drop-before 语义），桥草案 §3.2 reorder{order[]} / §3.3 gridResize{columnRatios,rowRatios}。
 */

/** 单格比例下限（占整行/整列的比例，spec §1.3「任一格比例下限 0.1，不能拖没」） */
export const MIN_RATIO = 0.1;

/** n 等分比例（和为 1）。空/非正 → []。 */
export function equalFractions(n: number): number[] {
  if (n <= 0) return [];
  return new Array(n).fill(1 / n);
}

/**
 * drop-before 重排（spec §3.4「插到目标 tile 之前」）：把 draggedId 移到 beforeId 之前；
 * beforeId=null → 移到末尾。返回新顺序（不修改入参）。
 */
export function reorderBefore(
  ids: string[],
  draggedId: string,
  beforeId: string | null,
): string[] {
  const without = ids.filter((id) => id !== draggedId);
  const at = beforeId == null ? without.length : without.indexOf(beforeId);
  const idx = at < 0 ? without.length : at;
  without.splice(idx, 0, draggedId);
  return without;
}

/**
 * 计算重排载荷：无有效目标 / 目标即自身 / 顺序未变 → null（不发 reorder）。
 * 方向感知插入（2026-07-07 用户实测裁决，替代纯 drop-before）：向右拖（源在目标左）= 插到目标
 * **之后**、向左拖 = 插到目标之前 → 拖拽物恒落在目标的位置，目标向来源方向挪一格。纯 drop-before
 * 对向右拖差一位：[A,B] 拖 A 到 B = 插 B 前 = 原地不动（永远拖不动）、[A,B,C] 拖 A 到 C 只能落
 * 第 2 位（永远到不了末尾）——用户真机实测「左往右拖不动/到不了第三位」即此。
 */
export function planReorder(
  ids: string[],
  draggingId: string | null,
  dragOverId: string | null,
): string[] | null {
  if (!draggingId || !dragOverId || draggingId === dragOverId) return null;
  const from = ids.indexOf(draggingId);
  const to = ids.indexOf(dragOverId);
  if (from < 0 || to < 0) return null;
  const without = ids.filter((id) => id !== draggingId);
  // 向右拖（from<to）：目标在 without 里左移一位，插 indexOf+1 = 目标之后；向左拖：插 indexOf = 目标之前。
  const at = without.indexOf(dragOverId) + (from < to ? 1 : 0);
  const next = without.slice();
  next.splice(at, 0, draggingId);
  const unchanged = next.every((id, i) => id === ids[i]);
  return unchanged ? null : next;
}

/**
 * 分隔条重分：只动相邻两格 [boundaryIdx, boundaryIdx+1]，二者之和不变，
 * 各自 clamp 到 [MIN_RATIO, sum-MIN_RATIO]（spec §1.3）。delta 为占整体的比例增量。
 */
export function redistribute(
  fractions: number[],
  boundaryIdx: number,
  delta: number,
  min = MIN_RATIO,
): number[] {
  const next = fractions.slice();
  const a = next[boundaryIdx];
  const b = next[boundaryIdx + 1];
  if (a == null || b == null) return next;
  const sum = a + b;
  const lo = min;
  const hi = sum - min;
  let na = a + delta;
  na = Math.max(lo, Math.min(hi, na));
  next[boundaryIdx] = na;
  next[boundaryIdx + 1] = sum - na;
  return next;
}

/**
 * 相邻把手位置（累计比例 %，不含 0 与 100）。等分比例时等价于 handlePositions（i/n*100）。
 * 按实际和归一化，容 equalFractions 的浮点残差。
 */
export function cumulativePercents(fractions: number[]): number[] {
  const total = fractions.reduce((s, f) => s + f, 0);
  if (total <= 0) return [];
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < fractions.length - 1; i++) {
    acc += fractions[i];
    out.push((acc / total) * 100);
  }
  return out;
}

/** 比例数组 → gridTemplateColumns 的 fr 串（"0.5fr 0.5fr"）。 */
export function toFrTemplate(fractions: number[]): string {
  return fractions.map((f) => `${f}fr`).join(' ');
}

/**
 * 形状守卫（spec §10.3）：比例数组长度与当前行/列数不符 → 视为无覆盖（null），调用方回落均分。
 * 长度不符的行比直接上屏会令 flex-grow 总和 <1（CSS flex：和<1 时只分配该占比的空间）→ 网格
 * 尾部死区（2026-07-17 真机：9 终端收起 3，行比按总数播成 3 份 ⅓ 套在 2 行上，底部 ⅓ 空黑）。
 */
export function ratiosForShape(ratios: number[] | null, count: number): number[] | null {
  return ratios && ratios.length === count ? ratios : null;
}

/**
 * gridResize 载荷（桥草案 §3.3，扁平 columnRatios/rowRatios）。
 * columnRatios 取第 0 行列比（单行网格即全部；多行网格每行列比独立但协议仅一维——
 * 取第 0 行为代表，多行的其余行列比为会话内视觉态、不入持久化，见报告「偏差记录」）。
 */
export function buildGridResizePayload(
  colRatiosByRow: Record<number, number[]>,
  rowRatios: number[] | null,
  rowCount: number,
  row0Cols: number,
): { columnRatios: number[]; rowRatios: number[] } {
  return {
    columnRatios: colRatiosByRow[0] ?? equalFractions(row0Cols),
    rowRatios: rowRatios ?? equalFractions(rowCount),
  };
}
