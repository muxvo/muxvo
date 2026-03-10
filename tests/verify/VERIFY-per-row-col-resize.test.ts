/**
 * VERIFY: 每行列宽独立调整
 * 验证 4 个终端(2x2)时，拖动第 0 行的列分隔线不影响第 1 行的列宽比例。
 */
import { describe, test, expect } from 'vitest';

describe('Per-row independent column resize', () => {
  test('拖动 row0 的列分隔线不影响 row1', async () => {
    const { createGridResizeManager } = await import(
      '@/renderer/stores/grid-resize'
    );
    // 4 terminals: 2x2, distribution [2, 2]
    const manager = createGridResizeManager({
      cols: 2,
      rows: 2,
      distribution: [2, 2],
    });

    // Initial: both rows have equal ratios
    expect(manager.perRowColumnRatios[0]).toEqual([1, 1]);
    expect(manager.perRowColumnRatios[1]).toEqual([1, 1]);

    // Drag row 0's column divider to the right
    manager.startColResize(0, 0, { clientX: 500 }, 1000);
    manager.moveResize({ clientX: 600 });
    manager.endResize();

    // Row 0 should have changed
    expect(manager.perRowColumnRatios[0][0]).toBeGreaterThan(1);
    expect(manager.perRowColumnRatios[0][1]).toBeLessThan(1);

    // Row 1 should remain unchanged
    expect(manager.perRowColumnRatios[1]).toEqual([1, 1]);
  });

  test('拖动 row1 的列分隔线不影响 row0', async () => {
    const { createGridResizeManager } = await import(
      '@/renderer/stores/grid-resize'
    );
    const manager = createGridResizeManager({
      cols: 2,
      rows: 2,
      distribution: [2, 2],
    });

    // Drag row 1's column divider
    manager.startColResize(1, 0, { clientX: 500 }, 1000);
    manager.moveResize({ clientX: 400 });
    manager.endResize();

    // Row 0 should remain unchanged
    expect(manager.perRowColumnRatios[0]).toEqual([1, 1]);

    // Row 1 should have changed
    expect(manager.perRowColumnRatios[1][0]).toBeLessThan(1);
    expect(manager.perRowColumnRatios[1][1]).toBeGreaterThan(1);
  });

  test('双击只重置当前行的列宽', async () => {
    const { createGridResizeManager } = await import(
      '@/renderer/stores/grid-resize'
    );
    const manager = createGridResizeManager({
      cols: 2,
      rows: 2,
      distribution: [2, 2],
    });

    // Adjust both rows
    manager.startColResize(0, 0, { clientX: 500 }, 1000);
    manager.moveResize({ clientX: 600 });
    manager.endResize();

    manager.startColResize(1, 0, { clientX: 500 }, 1000);
    manager.moveResize({ clientX: 400 });
    manager.endResize();

    // Both rows changed
    expect(manager.perRowColumnRatios[0]).not.toEqual([1, 1]);
    expect(manager.perRowColumnRatios[1]).not.toEqual([1, 1]);

    // Double-click row 0 only
    manager.doubleClickColGap(0, 0);

    // Row 0 reset, row 1 unchanged
    expect(manager.perRowColumnRatios[0]).toEqual([1, 1]);
    expect(manager.perRowColumnRatios[1]).not.toEqual([1, 1]);
  });

  test('5 终端(3+2) 每行列数不同', async () => {
    const { createGridResizeManager } = await import(
      '@/renderer/stores/grid-resize'
    );
    const manager = createGridResizeManager({
      cols: 3,
      rows: 2,
      distribution: [3, 2],
    });

    // Row 0 has 3 columns, row 1 has 2 columns
    expect(manager.perRowColumnRatios[0]).toEqual([1, 1, 1]);
    expect(manager.perRowColumnRatios[1]).toEqual([1, 1]);
  });

  test('backward compat: columnRatios getter 返回 row0', async () => {
    const { createGridResizeManager } = await import(
      '@/renderer/stores/grid-resize'
    );
    const manager = createGridResizeManager({
      cols: 2,
      rows: 2,
      distribution: [2, 2],
    });

    // columnRatios should be row 0's ratios
    expect(manager.columnRatios).toEqual([1, 1]);

    // After adjusting row 0, columnRatios reflects the change
    manager.startColResize(0, 0, { clientX: 500 }, 1000);
    manager.moveResize({ clientX: 600 });
    manager.endResize();

    expect(manager.columnRatios[0]).toBeGreaterThan(1);
    expect(manager.columnRatios).toEqual(manager.perRowColumnRatios[0]);
  });
});
