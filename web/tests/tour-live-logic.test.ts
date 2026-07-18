// 导览推进纯逻辑矩阵（右上角批 B4；tour-overlay.md §7.1 TOUR_advance_matrix）：
// 四步推进条件 × 满足/不满足两态（legacy TourOverlay 各 effect 监听语义对齐）。
import { describe, expect, test } from 'vitest';
import { ADVANCE_DELAY_MS, shouldAdvance, type TourFxView } from '../src/screen/tour/tour-live-logic';

function fx(over: Partial<TourFxView> = {}): TourFxView {
  return {
    terminals: [{}, {}],
    viewMode: 'Tiling',
    filePanel: null,
    ...over,
  };
}

describe('TOUR_advance_matrix：四步推进条件矩阵（B4）', () => {
  test('create-terminal：终端数超基线才推进', () => {
    expect(shouldAdvance('create-terminal', 2, fx())).toBe(false); // 2 == 基线 2
    expect(shouldAdvance('create-terminal', 2, fx({ terminals: [{}, {}, {}] }))).toBe(true);
    expect(shouldAdvance('create-terminal', 3, fx({ terminals: [{}, {}, {}] }))).toBe(false);
  });

  test('focus-terminal：viewMode 进 Focused 才推进', () => {
    expect(shouldAdvance('focus-terminal', 0, fx())).toBe(false);
    expect(shouldAdvance('focus-terminal', 0, fx({ viewMode: 'Focused' }))).toBe(true);
    expect(shouldAdvance('focus-terminal', 0, fx({ viewMode: 'List' }))).toBe(false);
  });

  test('rename-terminal：任一终端非空自定义名才推进（空白名不算）', () => {
    expect(shouldAdvance('rename-terminal', 0, fx())).toBe(false);
    expect(shouldAdvance('rename-terminal', 0, fx({ terminals: [{}, { customName: '构建机' }] }))).toBe(true);
    expect(shouldAdvance('rename-terminal', 0, fx({ terminals: [{ customName: '   ' }] }))).toBe(false);
  });

  test('open-files：文件面板开才推进（末步=完成）', () => {
    expect(shouldAdvance('open-files', 0, fx())).toBe(false);
    expect(shouldAdvance('open-files', 0, fx({ filePanel: { terminalId: 't1' } }))).toBe(true);
  });

  test('未知步 id 恒不推进 + ADVANCE_DELAY 对齐 legacy 500ms', () => {
    expect(shouldAdvance('no-such-step', 0, fx({ viewMode: 'Focused' }))).toBe(false);
    expect(ADVANCE_DELAY_MS).toBe(500);
  });
});
