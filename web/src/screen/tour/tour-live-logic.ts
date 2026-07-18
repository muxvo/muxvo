/**
 * 导览推进纯逻辑（右上角批 B4；tour-overlay.md §7）：推进=真实用户动作落进 ui.state 回推
 * （legacy TourOverlay 各 effect 监听 terminalCount/viewMode/名字/文件面板对齐）。纯函数可单测；
 * 500ms ADVANCE_DELAY 与 driver 驱动在 TourOverlayLive。
 */

export interface TourFxView {
  terminals: { customName?: string }[];
  viewMode: string;
  filePanel?: { terminalId: string } | null;
}

/** live 侧双语文案（MAJOR-1 回修；legacy tour.* en 键逐字）。golden TOUR_STEPS（zh）零触碰。 */
export const TOUR_LIVE_STR = {
  zh: {
    next: '下一步',
    prev: '上一步',
    done: '完成',
    complete: '恭喜！你已完成新手引导，开始享受 Muxvo 吧！',
    steps: {} as Record<string, { title: string; desc: string }>, // zh 直用 TOUR_STEPS 原文
  },
  en: {
    next: 'Next',
    prev: 'Previous',
    done: 'Done',
    complete: "Congrats! You've completed the tour. Enjoy Muxvo!",
    steps: {
      'create-terminal': { title: 'Create Terminal', desc: 'Click the + button to create your first terminal!' },
      'focus-terminal': { title: 'Focus Terminal', desc: 'Try clicking this blue button to maximize the terminal into focus mode!' },
      'rename-terminal': { title: 'Rename Terminal', desc: 'Click here to name this terminal for easy identification.' },
      'open-files': { title: 'Open Files', desc: 'Click the "File" button to open the file browser for this directory!' },
    } as Record<string, { title: string; desc: string }>,
  },
} as const;

/** 步间推进延迟（legacy ADVANCE_DELAY 对齐）。 */
export const ADVANCE_DELAY_MS = 500;

/**
 * 当前步是否满足推进条件：
 * - create-terminal：终端数超过导览启动时基线（legacy terminalCount 增加）
 * - focus-terminal：视图进入 Focused（legacy Tiling→Focused 翻转）
 * - rename-terminal：任一终端有非空自定义名（legacy any name non-empty）
 * - open-files：文件面板开（legacy filePanel.open → completeTour）
 */
export function shouldAdvance(stepId: string, baselineCount: number, fx: TourFxView): boolean {
  switch (stepId) {
    case 'create-terminal':
      return fx.terminals.length > baselineCount;
    case 'focus-terminal':
      return fx.viewMode === 'Focused';
    case 'rename-terminal':
      return fx.terminals.some((t) => !!t.customName && t.customName.trim() !== '');
    case 'open-files':
      return fx.filePanel != null;
    default:
      return false;
  }
}
