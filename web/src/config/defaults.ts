/**
 * 首启默认配置常量（行为 oracle：specs/legacy/l1/term.spec.json TERM_L1_08/11/12 +
 * specs/legacy/l2/boundaries.spec.json APP_L2_02/TERM_L2_87）。
 *
 * M3 接缝走 codegen/构建期共享给 Swift 壳，不占桥消息配额（≤15 CI 红线）；
 * golden viewport 是 _CONTRACT.md 冻结的 1440×900@2x，与本模块 1400×900 无关，
 * 严禁据此改截图 viewport。
 */

/** 首次启动窗口尺寸（TERM_L1_08 / APP_L2_02 window.width|height） */
export const DEFAULT_WINDOW_SIZE = { width: 1400, height: 900 } as const;

/** 默认字体大小（APP_L2_02 fontSize） */
export const DEFAULT_FONT_SIZE = 14;

/** 默认主题（APP_L2_02 theme） */
export const DEFAULT_THEME = 'dark';

/** 默认 Grid 列比例等分（TERM_L1_11 / TERM_L2_87 / APP_L2_02 gridLayout.columnRatios） */
export const DEFAULT_GRID_COLUMN_RATIOS: readonly number[] = [1, 1];

/** 默认 Grid 行比例等分（TERM_L1_12 / TERM_L2_87 / APP_L2_02 gridLayout.rowRatios） */
export const DEFAULT_GRID_ROW_RATIOS: readonly number[] = [1, 1];

/** 文件树视图左栏默认宽度（APP_L2_02 ftvLeftWidth） */
export const DEFAULT_FTV_LEFT_WIDTH = 250;

/** 文件树视图右栏默认宽度（APP_L2_02 ftvRightWidth） */
export const DEFAULT_FTV_RIGHT_WIDTH = 280;
