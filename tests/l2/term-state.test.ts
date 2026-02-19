/**
 * TERM L2 -- State Machine Tests (Part 1 of 2)
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_TERM.md
 * Covers: Grid layout, terminal process lifecycle, view mode,
 *         Esc priority, Tile CSS mapping
 *
 * Total cases in this file: 52
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks } from '../helpers/mock-ipc';
import { gridFixtures, defaultConfig } from '../helpers/test-fixtures';
import gridSpec from '../specs/l2/grid-layout.spec.json';
import stateUiSpec from '../specs/l2/state-ui-map.spec.json';

describe('TERM L2 -- 状态机与布局测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // ---------------------------------------------------------------------------
  // 2.1 Grid 布局算法 (PRD 8.1)
  // ---------------------------------------------------------------------------
  describe('Grid 布局算法', () => {
    const gridCases = gridSpec.cases;

    test.each(gridCases)(
      '$id: $description',
      async ({ id, input, expected }) => {
        // RED: import the real grid layout calculator (will fail)
        const { calculateGridLayout } = await import('@/shared/utils/grid-layout');

        const result = calculateGridLayout(input.terminalCount);

        expect(result.cols).toBe(expected.cols);
        expect(result.rows).toBe(expected.rows);

        // Check optional fields if present in expected
        if ('lastRowCentered' in expected) {
          expect(result.lastRowCentered).toBe(expected.lastRowCentered);
        }
        if ('distribution' in expected) {
          expect(result.distribution).toEqual(expected.distribution);
        }
        if ('rowPattern' in expected) {
          expect(result.rowPattern).toEqual(expected.rowPattern);
        }
        if ('spanRow' in expected) {
          // JSON keys are strings, convert to number keys for comparison
          const expectedSpanRow: Record<number, number> = {};
          for (const [k, v] of Object.entries(expected.spanRow as Record<string, number>)) {
            expectedSpanRow[Number(k)] = v;
          }
          expect(result.spanRow).toEqual(expectedSpanRow);
        }
      },
    );

    // Also verify against gridFixtures from test-fixtures.ts
    test.each(gridFixtures)(
      'fixture: $count terminals -> $layout ($expectedCols x $expectedRows)',
      async ({ count, expectedCols, expectedRows }) => {
        const { calculateGridLayout } = await import('@/shared/utils/grid-layout');
        const result = calculateGridLayout(count);
        expect(result.cols).toBe(expectedCols);
        expect(result.rows).toBe(expectedRows);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // 2.1b computeTilePlacements 放置计算
  // ---------------------------------------------------------------------------
  describe('computeTilePlacements 放置计算', () => {
    test('TERM_L2_98_placement_span5: 5 终端 span 居中放置', async () => {
      const { calculateGridLayout } = await import('@/shared/utils/grid-layout');
      const { computeTilePlacements } = await import('@/renderer/components/terminal/TerminalGrid');
      const layout = calculateGridLayout(5);
      const placements = computeTilePlacements(layout, 5);

      // Row 0: 3 tiles, each span 2 in 6-col grid
      expect(placements[0].gridColumn).toBe('1 / span 2');
      expect(placements[1].gridColumn).toBe('3 / span 2');
      expect(placements[2].gridColumn).toBe('5 / span 2');
      // Row 1: 2 tiles, each span 3 in 6-col grid
      expect(placements[3].gridColumn).toBe('1 / span 3');
      expect(placements[4].gridColumn).toBe('4 / span 3');
    });

    test('TERM_L2_99_placement_span7: 7 终端 span 居中放置', async () => {
      const { calculateGridLayout } = await import('@/shared/utils/grid-layout');
      const { computeTilePlacements } = await import('@/renderer/components/terminal/TerminalGrid');
      const layout = calculateGridLayout(7);
      const placements = computeTilePlacements(layout, 7);

      // Row 0: 4 tiles, each span 3 in 12-col grid
      expect(placements[0].gridColumn).toBe('1 / span 3');
      expect(placements[1].gridColumn).toBe('4 / span 3');
      expect(placements[2].gridColumn).toBe('7 / span 3');
      expect(placements[3].gridColumn).toBe('10 / span 3');
      // Row 1: 3 tiles, each span 4 in 12-col grid
      expect(placements[4].gridColumn).toBe('1 / span 4');
      expect(placements[5].gridColumn).toBe('5 / span 4');
      expect(placements[6].gridColumn).toBe('9 / span 4');
    });

    test('TERM_L2_100_placement_simple4: 4 终端简单网格放置', async () => {
      const { calculateGridLayout } = await import('@/shared/utils/grid-layout');
      const { computeTilePlacements } = await import('@/renderer/components/terminal/TerminalGrid');
      const layout = calculateGridLayout(4);
      const placements = computeTilePlacements(layout, 4);

      expect(placements[0]).toEqual({ gridRow: '1', gridColumn: '1' });
      expect(placements[1]).toEqual({ gridRow: '1', gridColumn: '2' });
      expect(placements[2]).toEqual({ gridRow: '2', gridColumn: '1' });
      expect(placements[3]).toEqual({ gridRow: '2', gridColumn: '2' });
    });
  });

  // ---------------------------------------------------------------------------
  // 2.2 状态机: 终端进程生命周期 (PRD 6.2)
  // ---------------------------------------------------------------------------
  describe('状态机: 终端进程生命周期', () => {
    describe('状态 UI 映射验证', () => {
      const termProcessUiCases = stateUiSpec.cases.filter(
        (c) => c.machine === 'terminalProcess',
      );

      test.each(termProcessUiCases)(
        '$id: $description',
        async ({ state, ui }) => {
          // RED: import the real state-ui mapper (will fail)
          const { getTerminalProcessUI } = await import(
            '@/renderer/stores/terminal-process-ui-map'
          );

          const uiState = getTerminalProcessUI(state);

          expect(uiState.statusDotColor).toBe(ui.statusDotColor);
          expect(uiState.statusDotAnimation).toBe(ui.statusDotAnimation);
          expect(uiState.inputEnabled).toBe(ui.inputEnabled);

          if ('inputPlaceholder' in ui) {
            expect(uiState.inputPlaceholder).toBe(ui.inputPlaceholder);
          }
          if ('inputHasOptions' in ui) {
            expect(uiState.inputHasOptions).toBe(ui.inputHasOptions);
          }
        },
      );
    });

    describe('转换路径覆盖 (16/16)', () => {
      test('TERM_L2_21_trans_init_created: T1 [*] -> Created', async () => {
        // RED: import the real terminal state machine (will fail)
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();

        // Initial transition: [*] -> Created
        expect(machine.state).toBe('Created');
      });

      test('TERM_L2_22_trans_created_starting: T2 Created -> Starting', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        expect(machine.state).toBe('Created');

        // Trigger: spawn process
        machine.send('SPAWN');
        expect(machine.state).toBe('Starting');
      });

      test('TERM_L2_23_trans_starting_running: T3 Starting -> Running', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        expect(machine.state).toBe('Starting');

        // Trigger: spawn success
        machine.send('SPAWN_SUCCESS');
        expect(machine.state).toBe('Running');
      });

      test('TERM_L2_24_trans_starting_failed: T4 Starting -> Failed', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        expect(machine.state).toBe('Starting');

        // Trigger: spawn failure (path not found / permission denied)
        machine.send('SPAWN_FAILURE');
        expect(machine.state).toBe('Failed');
      });

      test('TERM_L2_25_trans_running_busy: T5 Running -> Busy', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        expect(machine.state).toBe('Running');

        // Trigger: process executing
        machine.send('PROCESS_START');
        expect(machine.state).toBe('Busy');
      });

      test('TERM_L2_26_trans_busy_running: T6 Busy -> Running', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        machine.send('PROCESS_START');
        expect(machine.state).toBe('Busy');

        // Trigger: process done
        machine.send('PROCESS_DONE');
        expect(machine.state).toBe('Running');
      });

      test('TERM_L2_27_trans_running_waiting: T7 Running -> WaitingInput', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        expect(machine.state).toBe('Running');

        // Trigger: process waiting for input
        machine.send('WAIT_INPUT');
        expect(machine.state).toBe('WaitingInput');
      });

      test('TERM_L2_28_trans_waiting_running: T8 WaitingInput -> Running', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        machine.send('WAIT_INPUT');
        expect(machine.state).toBe('WaitingInput');

        // Trigger: user input
        machine.send('USER_INPUT');
        expect(machine.state).toBe('Running');
      });

      test('TERM_L2_29_trans_running_stopping: T9 Running -> Stopping', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        expect(machine.state).toBe('Running');

        // Trigger: user closes terminal
        machine.send('CLOSE');
        expect(machine.state).toBe('Stopping');
      });

      test('TERM_L2_30_trans_stopping_stopped: T10 Stopping -> Stopped', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        machine.send('CLOSE');
        expect(machine.state).toBe('Stopping');

        // Trigger: process exits normally
        machine.send('EXIT_NORMAL');
        expect(machine.state).toBe('Stopped');
      });

      test('TERM_L2_31_trans_stopping_disconnected: T11 Stopping -> Disconnected', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        machine.send('CLOSE');
        expect(machine.state).toBe('Stopping');

        // Trigger: process timeout (5s)
        machine.send('TIMEOUT');
        expect(machine.state).toBe('Disconnected');
      });

      test('TERM_L2_32_trans_running_disconnected: T12 Running -> Disconnected', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        expect(machine.state).toBe('Running');

        // Trigger: abnormal exit (exit code != 0)
        machine.send('EXIT_ABNORMAL');
        expect(machine.state).toBe('Disconnected');
      });

      test('TERM_L2_33_trans_disconnected_starting: T13 Disconnected -> Starting', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        machine.send('EXIT_ABNORMAL');
        expect(machine.state).toBe('Disconnected');

        // Trigger: user reconnects
        machine.send('RECONNECT');
        expect(machine.state).toBe('Starting');
      });

      test('TERM_L2_34_trans_disconnected_removed: T14 Disconnected -> Removed', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        machine.send('EXIT_ABNORMAL');
        expect(machine.state).toBe('Disconnected');

        // Trigger: user removes terminal
        machine.send('REMOVE');
        expect(machine.state).toBe('Removed');
      });

      test('TERM_L2_35_trans_stopped_removed: T15 Stopped -> Removed', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_SUCCESS');
        machine.send('CLOSE');
        machine.send('EXIT_NORMAL');
        expect(machine.state).toBe('Stopped');

        // Trigger: auto cleanup
        machine.send('REMOVE');
        expect(machine.state).toBe('Removed');
      });

      test('TERM_L2_36_trans_failed_removed: T16 Failed -> Removed', async () => {
        const { createTerminalMachine } = await import(
          '@/shared/machines/terminal-process'
        );
        const machine = createTerminalMachine();
        machine.send('SPAWN');
        machine.send('SPAWN_FAILURE');
        expect(machine.state).toBe('Failed');

        // Trigger: auto cleanup
        machine.send('REMOVE');
        expect(machine.state).toBe('Removed');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2.3 状态机: 视图模式 (PRD 6.3)
  // ---------------------------------------------------------------------------
  describe('状态机: 视图模式', () => {
    test('TERM_L2_37_view_init_tiling: V1 [*] -> Tiling', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      expect(machine.state).toBe('Tiling');
    });

    test('TERM_L2_38_view_tiling_focused: V2 Tiling -> Focused', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      expect(machine.state).toBe('Tiling');

      machine.send('DOUBLE_CLICK_TILE');
      expect(machine.state).toBe('Focused');
    });

    test('TERM_L2_39_view_focused_tiling_esc: V3 Focused -> Tiling (Esc)', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      machine.send('DOUBLE_CLICK_TILE');
      expect(machine.state).toBe('Focused');

      machine.send('ESC');
      expect(machine.state).toBe('Tiling');
    });

    test('TERM_L2_40_view_focused_tiling_btn: V4 Focused -> Tiling (按钮)', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      machine.send('DOUBLE_CLICK_TILE');
      expect(machine.state).toBe('Focused');

      machine.send('CLICK_BACK_TO_TILING');
      expect(machine.state).toBe('Tiling');
    });

    test('TERM_L2_41_view_focused_switch: V5 Focused -> Focused (切换目标)', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      machine.send({ type: 'DOUBLE_CLICK_TILE', targetId: 'term-A' });
      expect(machine.state).toBe('Focused');
      expect(machine.context.focusedId).toBe('term-A');

      // Switch focus target
      machine.send({ type: 'CLICK_SIDEBAR_TILE', targetId: 'term-B' });
      expect(machine.state).toBe('Focused');
      expect(machine.context.focusedId).toBe('term-B');
    });

    test('TERM_L2_42_view_tiling_filepanel: V6 Tiling -> FilePanel', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      expect(machine.state).toBe('Tiling');

      machine.send('CLICK_FILE_BUTTON');
      expect(machine.state).toBe('FilePanel');
    });

    test('TERM_L2_43_view_focused_filepanel: V7 Focused -> FilePanel', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      machine.send('DOUBLE_CLICK_TILE');
      expect(machine.state).toBe('Focused');

      machine.send('CLICK_FILE_BUTTON');
      expect(machine.state).toBe('FilePanel');
    });

    test('TERM_L2_44_view_filepanel_tiling: V8 FilePanel -> Tiling', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      // Enter FilePanel from Tiling
      machine.send('CLICK_FILE_BUTTON');
      expect(machine.state).toBe('FilePanel');
      expect(machine.context.enteredFrom).toBe('Tiling');

      machine.send('ESC');
      expect(machine.state).toBe('Tiling');
    });

    test('TERM_L2_45_view_filepanel_focused: V9 FilePanel -> Focused', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      // Enter FilePanel from Focused
      machine.send('DOUBLE_CLICK_TILE');
      machine.send('CLICK_FILE_BUTTON');
      expect(machine.state).toBe('FilePanel');
      expect(machine.context.enteredFrom).toBe('Focused');

      machine.send('ESC');
      expect(machine.state).toBe('Focused');
    });

    test('TERM_L2_46_view_filepanel_tempview: V10 FilePanel -> TempView', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      machine.send('CLICK_FILE_BUTTON');
      expect(machine.state).toBe('FilePanel');

      machine.send('CLICK_FILE');
      expect(machine.state).toBe('TempView');
    });

    test('TERM_L2_47_view_tempview_tiling: V11 TempView -> Tiling', async () => {
      const { createViewModeMachine } = await import(
        '@/shared/machines/view-mode'
      );
      const machine = createViewModeMachine();
      machine.send('CLICK_FILE_BUTTON');
      machine.send('CLICK_FILE');
      expect(machine.state).toBe('TempView');

      machine.send('ESC');
      expect(machine.state).toBe('Tiling');
    });
  });

  // ---------------------------------------------------------------------------
  // 2.4 Esc 键 7 级优先级 (PRD 6.3)
  // ---------------------------------------------------------------------------
  describe('Esc 键 7 级优先级', () => {
    test('TERM_L2_48_esc_p1_security: 优先级 1 - 关闭安全审查对话框', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      const context = { securityDialogOpen: true };
      const result = handleEscPress(context);
      expect(result.action).toBe('closeSecurityDialog');
      expect(result.priority).toBe(1);
    });

    test('TERM_L2_49_esc_p2_folder: 优先级 2 - 关闭文件夹选择器', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      const context = { folderSelectorOpen: true };
      const result = handleEscPress(context);
      expect(result.action).toBe('closeFolderSelector');
      expect(result.priority).toBe(2);
    });

    test('TERM_L2_50_esc_p3_browser: 优先级 3 - 关闭 Skill 浏览器', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      const context = { skillBrowserOpen: true };
      const result = handleEscPress(context);
      expect(result.action).toBe('closeSkillBrowser');
      expect(result.priority).toBe(3);
    });

    test('TERM_L2_51_esc_p4_tempview: 优先级 4 - 关闭三栏临时视图', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      const context = { tempViewOpen: true };
      const result = handleEscPress(context);
      expect(result.action).toBe('closeTempView');
      expect(result.priority).toBe(4);
    });

    test('TERM_L2_52_esc_p5_filepanel: 优先级 5 - 关闭文件面板', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      const context = { filePanelOpen: true };
      const result = handleEscPress(context);
      expect(result.action).toBe('closeFilePanel');
      expect(result.priority).toBe(5);
    });

    test('TERM_L2_53_esc_p6_focused: 优先级 6 - 退出聚焦模式', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      const context = { viewMode: 'Focused', terminalFocused: false };
      const result = handleEscPress(context);
      expect(result.action).toBe('exitFocusMode');
      expect(result.priority).toBe(6);
    });

    test('TERM_L2_54_esc_p7_tiling: 优先级 7 - 平铺模式无操作', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      const context = { viewMode: 'Tiling' };
      const result = handleEscPress(context);
      expect(result.action).toBe('noop');
      expect(result.priority).toBe(7);
    });

    test('TERM_L2_55_esc_terminal_passthrough: 终端焦点时 Esc 透传', async () => {
      const { handleEscPress } = await import('@/shared/utils/esc-handler');
      // When terminal has focus, Esc should pass through regardless of mode
      const context = {
        terminalFocused: true,
        viewMode: 'Focused',
        filePanelOpen: false,
      };
      const result = handleEscPress(context);
      expect(result.action).toBe('passthrough');
      expect(result.intercepted).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2.5 Tile CSS 样式映射 (PRD 6.4)
  // ---------------------------------------------------------------------------
  describe('Tile CSS 样式映射', () => {
    const tileCssCases = stateUiSpec.cases.filter(
      (c) => c.machine === 'tileInteraction',
    );

    test.each(tileCssCases)(
      '$id: $description',
      async ({ state, ui }) => {
        // RED: import the real tile style mapper (will fail)
        const { getTileInteractionStyle } = await import(
          '@/renderer/components/tile/tile-interaction-styles'
        );

        const style = getTileInteractionStyle(state);

        expect(style.border).toBe(ui.border);
        expect(style.opacity).toBe(ui.opacity);
        expect(style.transform).toBe(ui.transform);

        if ('extra' in ui) {
          expect(style.extra).toBeDefined();
        }
      },
    );
  });
});
