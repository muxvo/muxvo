// M3 批5③ 拖拽/分隔条纯逻辑单测（node 环境，无 DOM）。
// 断言面 = 真实工件 web/src/grid/gridInteractions.ts（TermGrid/useGridInteractions 消费的同一函数）。
import { expect, test, describe } from 'vitest';
import {
  MIN_RATIO,
  buildGridResizePayload,
  cumulativePercents,
  equalFractions,
  planReorder,
  ratiosForShape,
  redistribute,
  reorderBefore,
  toFrTemplate,
} from '../src/grid/gridInteractions';
import { handlePositions } from '../src/grid/layout';

describe('reorderBefore（drop-before 语义，spec §3.4）', () => {
  test('移到目标之前', () => {
    expect(reorderBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });
  test('向前拖：a 拖到 c 之前', () => {
    expect(reorderBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']);
  });
  test('beforeId=null → 移到末尾', () => {
    expect(reorderBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
  });
  test('不修改入参', () => {
    const src = ['a', 'b', 'c'];
    reorderBefore(src, 'a', 'c');
    expect(src).toEqual(['a', 'b', 'c']);
  });
});

describe('planReorder（方向感知插入，2026-07-07 用户实测裁决）', () => {
  test('向左拖 = 插目标前（拖拽物落在目标位置）', () => {
    expect(planReorder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(planReorder(['a', 'b'], 'b', 'a')).toEqual(['b', 'a']);
  });
  test('向右拖 = 插目标后（真机回归：纯 drop-before 下左往右永远拖不动/差一位）', () => {
    expect(planReorder(['a', 'b'], 'a', 'b')).toEqual(['b', 'a']); // 两 tile 左→右换位
    expect(planReorder(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']); // 拖到末尾真到末尾
    expect(planReorder(['a', 'b', 'c'], 'a', 'b')).toEqual(['b', 'a', 'c']); // 1→2 位
  });
  test('无目标（拖出网格/落自身）→ null（不发 reorder）', () => {
    expect(planReorder(['a', 'b', 'c'], 'a', null)).toBeNull();
    expect(planReorder(['a', 'b', 'c'], null, 'b')).toBeNull();
  });
  test('目标即自身 → null', () => {
    expect(planReorder(['a', 'b', 'c'], 'b', 'b')).toBeNull();
  });
  test('未知 id → null', () => {
    expect(planReorder(['a', 'b'], 'x', 'a')).toBeNull();
    expect(planReorder(['a', 'b'], 'a', 'x')).toBeNull();
  });
});

describe('equalFractions', () => {
  test('n 等分、和为 1', () => {
    for (const n of [1, 2, 3, 4, 5, 7]) {
      const f = equalFractions(n);
      expect(f).toHaveLength(n);
      expect(f.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
      expect(new Set(f).size).toBe(1); // 全等
    }
  });
  test('n<=0 → []', () => {
    expect(equalFractions(0)).toEqual([]);
    expect(equalFractions(-1)).toEqual([]);
  });
});

describe('redistribute（相邻两格重分 + clamp，spec §1.3）', () => {
  test('两格之和守恒', () => {
    const r = redistribute([0.5, 0.5], 0, 0.2);
    expect(r[0] + r[1]).toBeCloseTo(1, 12);
    expect(r[0]).toBeCloseTo(0.7, 12);
    expect(r[1]).toBeCloseTo(0.3, 12);
  });
  test('只动相邻两格，其余不变', () => {
    const r = redistribute([0.25, 0.25, 0.5], 0, 0.1);
    expect(r[2]).toBe(0.5);
    expect(r[0] + r[1]).toBeCloseTo(0.5, 12);
  });
  test('下限 clamp：不能拖没（≥0.1）', () => {
    const r = redistribute([0.5, 0.5], 0, -0.8); // 想拖到 -0.3
    expect(r[0]).toBeCloseTo(MIN_RATIO, 12);
    expect(r[1]).toBeCloseTo(0.9, 12);
  });
  test('上限 clamp：对格也不能拖没', () => {
    const r = redistribute([0.5, 0.5], 0, 0.8); // 想拖到 1.3
    expect(r[0]).toBeCloseTo(1 - MIN_RATIO, 12);
    expect(r[1]).toBeCloseTo(MIN_RATIO, 12);
  });
  test('越界 boundary → 原样返回', () => {
    expect(redistribute([0.5, 0.5], 5, 0.1)).toEqual([0.5, 0.5]);
  });
});

describe('cumulativePercents（把手位置）', () => {
  test('等分比例 → 与 handlePositions 一致（golden 保全）', () => {
    for (const n of [2, 3, 4]) {
      expect(cumulativePercents(equalFractions(n))).toEqual(handlePositions(n));
    }
  });
  test('非等分：累计边界', () => {
    expect(cumulativePercents([0.25, 0.75])).toEqual([25]);
    expect(cumulativePercents([0.2, 0.3, 0.5])).toEqual([20, 50]);
  });
});

describe('toFrTemplate', () => {
  test('比例 → fr 串', () => {
    expect(toFrTemplate([0.5, 0.5])).toBe('0.5fr 0.5fr');
  });
});

describe('ratiosForShape（形状守卫，spec §10.3 2026-07-17 回修）', () => {
  test('长度匹配 → 原样返回', () => {
    const r = [0.6, 0.4];
    expect(ratiosForShape(r, 2)).toBe(r);
  });
  test('长度不符/空 → null（回落均分，杜绝 flex 和<1 尾部死区）', () => {
    expect(ratiosForShape([1 / 3, 1 / 3, 1 / 3], 2)).toBeNull();
    expect(ratiosForShape([0.5, 0.5], 3)).toBeNull();
    expect(ratiosForShape(null, 2)).toBeNull();
  });
});

describe('buildGridResizePayload（gridResize 载荷，草案 §3.3）', () => {
  test('无覆盖 → 均分默认', () => {
    const p = buildGridResizePayload({}, null, 2, 3);
    expect(p.rowRatios).toHaveLength(2);
    expect(p.columnRatios).toHaveLength(3);
    expect(p.rowRatios.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(p.columnRatios.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
  });
  test('单行：columnRatios 取第 0 行覆盖（完整）', () => {
    const p = buildGridResizePayload({ 0: [0.7, 0.3] }, null, 1, 2);
    expect(p.columnRatios).toEqual([0.7, 0.3]);
    expect(p.rowRatios).toEqual(equalFractions(1));
  });
  test('行比覆盖', () => {
    const p = buildGridResizePayload({}, [0.6, 0.4], 2, 2);
    expect(p.rowRatios).toEqual([0.6, 0.4]);
  });
});
