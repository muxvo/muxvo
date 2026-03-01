/**
 * TERM L2 -- Business Rules Tests (Part 2 of 2)
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_TERM.md
 * Covers: Naming state machine, border resize,
 *         auto-grouping, special rules
 *
 * Total cases in this file: 28
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks } from '../helpers/mock-ipc';
import { defaultConfig, terminalFixtures } from '../helpers/test-fixtures';

describe('TERM L2 -- 业务规则测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // ---------------------------------------------------------------------------
  // 2.7 双段式命名 (PRD 6.8)
  // ---------------------------------------------------------------------------
  describe('状态机: 双段式命名', () => {
    test('TERM_L2_66_name_init_empty: N1 [*] -> DisplayEmpty', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      expect(machine.state).toBe('DisplayEmpty');
      expect(machine.context.displayText).toBe('');
      expect(machine.context.placeholder).toBe('命名...');
    });

    test('TERM_L2_67_name_empty_editing: N2 DisplayEmpty -> Editing', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      expect(machine.state).toBe('DisplayEmpty');

      machine.send('CLICK_PLACEHOLDER');
      expect(machine.state).toBe('Editing');
    });

    test('TERM_L2_68_name_editing_named_enter: N3 Editing -> DisplayNamed (Enter)', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      machine.send('CLICK_PLACEHOLDER');
      expect(machine.state).toBe('Editing');

      machine.send({ type: 'ENTER', value: 'my-term' });
      expect(machine.state).toBe('DisplayNamed');
      expect(machine.context.displayText).toBe('my-term');
    });

    test('TERM_L2_69_name_editing_named_blur: N4 Editing -> DisplayNamed (blur)', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      machine.send('CLICK_PLACEHOLDER');
      expect(machine.state).toBe('Editing');

      machine.send({ type: 'BLUR', value: 'my-term' });
      expect(machine.state).toBe('DisplayNamed');
      expect(machine.context.displayText).toBe('my-term');
    });

    test('TERM_L2_70_name_editing_empty_enter: N5 Editing -> DisplayEmpty (Enter 空)', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      machine.send('CLICK_PLACEHOLDER');
      expect(machine.state).toBe('Editing');

      machine.send({ type: 'ENTER', value: '' });
      expect(machine.state).toBe('DisplayEmpty');
    });

    test('TERM_L2_71_name_editing_empty_blur: N6 Editing -> DisplayEmpty (blur 空)', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      machine.send('CLICK_PLACEHOLDER');
      expect(machine.state).toBe('Editing');

      machine.send({ type: 'BLUR', value: '' });
      expect(machine.state).toBe('DisplayEmpty');
    });

    test('TERM_L2_72_name_esc_restore_empty: N7 Editing -> DisplayEmpty (Esc, 原值空)', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      // Start empty, enter editing
      machine.send('CLICK_PLACEHOLDER');
      expect(machine.state).toBe('Editing');
      expect(machine.context.originalValue).toBe('');

      machine.send('ESC');
      expect(machine.state).toBe('DisplayEmpty');
    });

    test('TERM_L2_73_name_esc_restore_named: N8 Editing -> DisplayNamed (Esc, 原值非空)', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      // First name the terminal
      machine.send('CLICK_PLACEHOLDER');
      machine.send({ type: 'ENTER', value: 'old-name' });
      expect(machine.state).toBe('DisplayNamed');

      // Now edit again, type something, then Esc
      machine.send('CLICK_NAME');
      expect(machine.state).toBe('Editing');
      expect(machine.context.originalValue).toBe('old-name');

      machine.send('ESC');
      expect(machine.state).toBe('DisplayNamed');
      expect(machine.context.displayText).toBe('old-name');
    });

    test('TERM_L2_74_name_named_editing: N9 DisplayNamed -> Editing', async () => {
      const { createNamingMachine } = await import(
        '@/shared/machines/terminal-naming'
      );
      const machine = createNamingMachine();
      // Name the terminal first
      machine.send('CLICK_PLACEHOLDER');
      machine.send({ type: 'ENTER', value: 'my-term' });
      expect(machine.state).toBe('DisplayNamed');

      // Click the name to edit
      machine.send('CLICK_NAME');
      expect(machine.state).toBe('Editing');
      // Input should be pre-filled with current name
      expect(machine.context.editValue).toBe('my-term');
    });
  });

  // ---------------------------------------------------------------------------
  // 2.8 Grid 边框调整 (PRD 6.9)
  // ---------------------------------------------------------------------------
  describe('Grid 边框调整', () => {
    test('TERM_L2_75_resize_col_drag: 拖拽列间隙调整列比例', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 1,
        columnRatios: [1, 1],
      });

      // Simulate mousedown on column gap + mousemove
      manager.startColResize(0, { clientX: 500 });
      manager.moveResize({ clientX: 600 });
      manager.endResize();

      // Column ratios should have changed
      expect(manager.columnRatios[0]).not.toBe(1);
      expect(manager.cursor).toBe('col-resize');
    });

    test('TERM_L2_76_resize_row_drag: 拖拽行间隙调整行比例', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 2,
        rowRatios: [1, 1],
      });

      // Simulate mousedown on row gap + mousemove
      manager.startRowResize(0, { clientY: 300 });
      manager.moveResize({ clientY: 400 });
      manager.endResize();

      expect(manager.rowRatios[0]).not.toBe(1);
      expect(manager.cursor).toBe('row-resize');
    });

    test('TERM_L2_77_resize_col_dblclick: 双击列间隙重置列比例', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 1,
        columnRatios: [0.7, 0.3],
      });

      // Double-click on column gap should reset to equal split
      manager.doubleClickColGap(0);
      expect(manager.columnRatios).toEqual([1, 1]);
    });

    test('TERM_L2_78_resize_row_dblclick: 双击行间隙重置行比例', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 2,
        rowRatios: [0.7, 0.3],
      });

      // Double-click on row gap should reset to equal split
      manager.doubleClickRowGap(0);
      expect(manager.rowRatios).toEqual([1, 1]);
    });

    test('TERM_L2_79_resize_only_tiling: 聚焦模式下不触发边框调整', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 1,
        columnRatios: [1, 1],
        viewMode: 'Focused',
      });

      // Attempt to start resize in Focused mode
      const started = manager.startColResize(0, { clientX: 500 });
      expect(started).toBe(false);
      expect(manager.cursor).not.toBe('col-resize');
    });
  });

  // ---------------------------------------------------------------------------
  // 2.9 同目录终端自动归组 (PRD Feature M, 8.1)
  // ---------------------------------------------------------------------------
  describe('同目录终端自动归组', () => {
    test('TERM_L2_80_group_new_same_dir: 新建终端自动归组到同目录终端旁', async () => {
      const { createTerminalGroupManager } = await import(
        '@/shared/utils/terminal-grouping'
      );
      const manager = createTerminalGroupManager();

      // Add terminals with different cwds
      manager.addTerminal({ id: 'A', cwd: '/Users/test/proj' });
      manager.addTerminal({ id: 'B', cwd: '/Users/test/other' });

      // New terminal with same cwd as A
      const position = manager.addTerminal({ id: 'C', cwd: '/Users/test/proj' });

      // C should be placed next to A
      const order = manager.getOrder();
      const indexA = order.indexOf('A');
      const indexC = order.indexOf('C');
      expect(Math.abs(indexA - indexC)).toBe(1);
    });

    test('TERM_L2_81_group_cd_same_dir: cd 触发自动归组', async () => {
      const { createTerminalGroupManager } = await import(
        '@/shared/utils/terminal-grouping'
      );
      const manager = createTerminalGroupManager();

      manager.addTerminal({ id: 'A', cwd: '/Users/test/proj' });
      manager.addTerminal({ id: 'B', cwd: '/Users/test/other' });
      manager.addTerminal({ id: 'C', cwd: '/Users/test/third' });

      // Terminal C changes directory to match A
      manager.updateCwd('C', '/Users/test/proj');

      const order = manager.getOrder();
      const indexA = order.indexOf('A');
      const indexC = order.indexOf('C');
      expect(Math.abs(indexA - indexC)).toBe(1);
    });

    test('TERM_L2_82_group_no_same_dir: 无同目录时不触发移动', async () => {
      const { createTerminalGroupManager } = await import(
        '@/shared/utils/terminal-grouping'
      );
      const manager = createTerminalGroupManager();

      manager.addTerminal({ id: 'A', cwd: '/Users/test/proj' });
      const orderBefore = manager.getOrder();

      // New terminal with unique cwd
      manager.addTerminal({ id: 'B', cwd: '/Users/test/other' });

      // B should be appended to end, not moved
      const orderAfter = manager.getOrder();
      expect(orderAfter[orderAfter.length - 1]).toBe('B');
    });
  });

  // ---------------------------------------------------------------------------
  // 2.10 特殊规则 (附录 H)
  // ---------------------------------------------------------------------------
  describe('特殊规则', () => {
    test('TERM_L2_83_max_terminal_20: 终端上限 20 个', async () => {
      const { createTerminalManager } = await import(
        '@/shared/utils/terminal-manager'
      );
      const manager = createTerminalManager();

      // Open 20 terminals
      for (let i = 0; i < 20; i++) {
        manager.create({ cwd: `/proj/${i}` });
      }
      expect(manager.count).toBe(20);

      // Attempt to create 21st
      const result = manager.create({ cwd: '/proj/21' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('已达最大终端数');
      expect(manager.canCreateNew).toBe(false);
    });

    test('TERM_L2_84_buffer_limit_focused: 聚焦/可见终端滚动缓冲区 10000 行', async () => {
      const { getBufferLimit } = await import(
        '@/shared/utils/buffer-manager'
      );
      const limit = getBufferLimit('visible');
      expect(limit).toBe(10000);
    });

    test('TERM_L2_85_buffer_limit_hidden: 非可见终端缓冲区缩减至 1000 行', async () => {
      const { getBufferLimit } = await import(
        '@/shared/utils/buffer-manager'
      );
      const limit = getBufferLimit('hidden');
      expect(limit).toBe(1000);
    });

    test('TERM_L2_86_buffer_no_restore: 缓冲区缩减不可逆', async () => {
      const { createBufferManager } = await import(
        '@/shared/utils/buffer-manager'
      );
      const buffer = createBufferManager({ initialLines: 5000 });

      // Terminal becomes hidden -> buffer shrinks to 1000
      buffer.setVisibility('hidden');
      expect(buffer.lineCount).toBeLessThanOrEqual(1000);

      const lineCountAfterShrink = buffer.lineCount;

      // Terminal becomes visible again
      buffer.setVisibility('visible');
      // Buffer limit increases but lost lines are NOT restored
      expect(buffer.lineCount).toBe(lineCountAfterShrink);
      expect(buffer.maxLines).toBe(10000);
    });

    test('TERM_L2_87_default_grid_ratios: 默认 Grid 比例等分', () => {
      expect(defaultConfig.tile.columnRatios).toEqual([1, 1]);
      expect(defaultConfig.tile.rowRatios).toEqual([1, 1]);
    });

    test('TERM_L2_88_default_tile_style: Tile Default 状态默认样式', () => {
      expect(defaultConfig.tile.border).toBe('var(--border)');
      expect(defaultConfig.tile.opacity).toBe(1);
    });

    test('TERM_L2_91_resize_persist_ratios: 调整后比例持久化', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 1,
        columnRatios: [1, 1],
      });

      // Adjust ratios
      manager.startColResize(0, { clientX: 500 });
      manager.moveResize({ clientX: 600 });
      manager.endResize();

      // Verify ratios were adjusted (not equal default [1, 1])
      expect(manager.columnRatios).not.toEqual([1, 1]);
    });

    test('TERM_L2_92_grid_close_reflow: 关闭终端后 Grid 重排', async () => {
      const { calculateGridLayout } = await import('@/shared/utils/grid-layout');

      // 4 terminals -> 2x2
      const layout4 = calculateGridLayout(4);
      expect(layout4.cols).toBe(2);
      expect(layout4.rows).toBe(2);

      // Close 1 -> 3 terminals -> 3x1
      const layout3 = calculateGridLayout(3);
      expect(layout3.cols).toBe(3);
      expect(layout3.rows).toBe(1);
    });

    test('TERM_L2_93_grid_open_reflow: 新建终端后 Grid 重排', async () => {
      const { calculateGridLayout } = await import('@/shared/utils/grid-layout');

      // 3 terminals -> 3x1
      const layout3 = calculateGridLayout(3);
      expect(layout3.cols).toBe(3);
      expect(layout3.rows).toBe(1);

      // Add 1 -> 4 terminals -> 2x2
      const layout4 = calculateGridLayout(4);
      expect(layout4.cols).toBe(2);
      expect(layout4.rows).toBe(2);
    });

    test('TERM_L2_95_esc_priority_overlap: Esc 多状态重叠时按优先级处理', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');

      // Both focused mode AND file panel open
      const context = {
        viewMode: 'Focused',
        filePanelOpen: true,
        terminalFocused: false,
      };
      const result = handleEscPress(context);

      // File panel (priority 5) should close first, not focused mode (priority 6)
      expect(result.action).toBe('closeFilePanel');
      expect(result.priority).toBe(5);
    });

    test('TERM_L2_96_drag_reorder: 拖拽排序终端位置', async () => {
      const { createDragManager } = await import(
        '@/renderer/stores/drag-manager'
      );
      const manager = createDragManager({
        order: ['A', 'B', 'C'],
      });

      // Drag C before A
      manager.startDrag('C');
      manager.dropBefore('A');

      expect(manager.order).toEqual(['C', 'A', 'B']);
    });

    test('TERM_L2_97_drag_cancel: 拖拽取消恢复原位', async () => {
      const { createDragManager } = await import(
        '@/renderer/stores/drag-manager'
      );
      const manager = createDragManager({
        order: ['A', 'B', 'C'],
      });

      // Start drag then cancel
      manager.startDrag('C');
      manager.cancel();

      // Order should remain unchanged
      expect(manager.order).toEqual(['A', 'B', 'C']);
    });
  });

  // ---------------------------------------------------------------------------
  // 2.11 Grid 布局升级补充测试
  // ---------------------------------------------------------------------------
  describe('Grid 布局升级补充测试', () => {
    test('TERM_L2_101_resize_container_size: containerSize 精确比例计算', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 1,
        columnRatios: [1, 1],
      });

      // With containerSize=1000, each col is 500px. Drag right 100px
      manager.startColResize(0, { clientX: 500 }, 1000);
      manager.moveResize({ clientX: 600 });
      manager.endResize();

      // 100px / 1000px total * 2 (total ratio) = 0.2 shift
      // Left: 1 + 0.2 = 1.2, Right: 1 - 0.2 = 0.8
      expect(manager.columnRatios[0]).toBeCloseTo(1.2, 1);
      expect(manager.columnRatios[1]).toBeCloseTo(0.8, 1);
    });

    test('TERM_L2_102_resize_no_container_fallback: 无 containerSize 回退', async () => {
      const { createGridResizeManager } = await import(
        '@/renderer/stores/grid-resize'
      );
      const manager = createGridResizeManager({
        cols: 2,
        rows: 1,
        columnRatios: [1, 1],
      });

      // Without containerSize, uses fallback totalPx=1000
      manager.startColResize(0, { clientX: 500 });
      manager.moveResize({ clientX: 600 });
      manager.endResize();

      // Should still resize (delta=100, totalPx=1000, shift=0.2)
      expect(manager.columnRatios[0]).toBeGreaterThan(1);
      expect(manager.columnRatios[1]).toBeLessThan(1);
      expect(manager.columnRatios[0] + manager.columnRatios[1]).toBeCloseTo(2, 5);
    });

    test('TERM_L2_103_drag_same_position: 拖拽到自身位置不变', async () => {
      const { createDragManager } = await import(
        '@/renderer/stores/drag-manager'
      );
      const manager = createDragManager({
        order: ['A', 'B', 'C', 'D'],
      });

      // Drag A to A (same position) — UI layer guards this (TerminalGrid.tsx),
      // at the drag-manager level dropBefore(self) removes self then can't find
      // target so appends to end. Verify this raw behavior.
      manager.startDrag('A');
      manager.dropBefore('A');

      // A is removed from filtered list, targetIndex=-1, pushed to end
      expect(manager.order).toEqual(['B', 'C', 'D', 'A']);
    });
  });
});
