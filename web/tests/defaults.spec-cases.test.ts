// M2 B1 spec 翻牌：首启默认值（TERM_L1_08/11/12 + APP_L2_02 + TERM_L2_87）。
// l1/term 与 l2/boundaries 均为混里程碑 spec 文件 → 逐条 test('ID: ...')，严禁 test.each 注入。
// 断言面 = 真实工件 web/src/config/defaults.ts 常量模块；expected 一律取自冻结 spec JSON。
import { expect, test } from 'vitest';
import termL1Spec from '../../specs/legacy/l1/term.spec.json';
import boundariesSpec from '../../specs/legacy/l2/boundaries.spec.json';
import {
  DEFAULT_WINDOW_SIZE,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  DEFAULT_GRID_COLUMN_RATIOS,
  DEFAULT_GRID_ROW_RATIOS,
  DEFAULT_FTV_LEFT_WIDTH,
  DEFAULT_FTV_RIGHT_WIDTH,
} from '../src/config/defaults';

type SpecCase = Record<string, unknown>;

function caseOf(cases: readonly unknown[], id: string): SpecCase {
  const c = (cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

test('TERM_L1_08: 默认窗口尺寸 -- 首次启动 1400x900', () => {
  const c = caseOf(termL1Spec.cases, 'TERM_L1_08');
  expect({ width: DEFAULT_WINDOW_SIZE.width, height: DEFAULT_WINDOW_SIZE.height }).toEqual(
    c.expectedValue,
  );
});

test('TERM_L1_11: 默认列比例 -- 2 个终端时 columnRatios=[1,1]', () => {
  const c = caseOf(termL1Spec.cases, 'TERM_L1_11');
  expect([...DEFAULT_GRID_COLUMN_RATIOS]).toEqual(c.expectedValue);
});

test('TERM_L1_12: 默认行比例 -- 4 个终端时 rowRatios=[1,1]', () => {
  const c = caseOf(termL1Spec.cases, 'TERM_L1_12');
  expect([...DEFAULT_GRID_ROW_RATIOS]).toEqual(c.expectedValue);
});

/** APP_L2_02 八项参数 → defaults.ts 常量映射（actual 侧；expected 全部来自 spec JSON） */
const APP_DEFAULTS_BY_PARAM: Record<string, unknown> = {
  'window.width': DEFAULT_WINDOW_SIZE.width,
  'window.height': DEFAULT_WINDOW_SIZE.height,
  fontSize: DEFAULT_FONT_SIZE,
  theme: DEFAULT_THEME,
  'gridLayout.columnRatios': DEFAULT_GRID_COLUMN_RATIOS,
  'gridLayout.rowRatios': DEFAULT_GRID_ROW_RATIOS,
  ftvLeftWidth: DEFAULT_FTV_LEFT_WIDTH,
  ftvRightWidth: DEFAULT_FTV_RIGHT_WIDTH,
};

test('APP_L2_02: 首次启动默认配置值 — 8 个默认项', () => {
  const c = caseOf(boundariesSpec.cases, 'APP_L2_02');
  const boundaries = c.boundaries as Array<{ parameter: string; expected: unknown }>;
  expect(boundaries).toHaveLength(8);
  for (const b of boundaries) {
    expect(
      Object.prototype.hasOwnProperty.call(APP_DEFAULTS_BY_PARAM, b.parameter),
      `参数缺默认值映射: ${b.parameter}`,
    ).toBe(true);
    expect(APP_DEFAULTS_BY_PARAM[b.parameter], b.parameter).toEqual(b.expected);
  }
});

test('TERM_L2_87_default_grid_ratios: 默认 Grid 比例等分', () => {
  const c = caseOf(boundariesSpec.cases, 'TERM_L2_87_default_grid_ratios');
  const ratiosByParam: Record<string, readonly number[]> = {
    columnRatios: DEFAULT_GRID_COLUMN_RATIOS,
    rowRatios: DEFAULT_GRID_ROW_RATIOS,
  };
  const boundaries = c.boundaries as Array<{ parameter: string; expected: unknown }>;
  expect(boundaries.length).toBeGreaterThan(0);
  for (const b of boundaries) {
    expect(ratiosByParam[b.parameter], b.parameter).toEqual(b.expected);
  }
});
