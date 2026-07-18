/**
 * 终端状态三桶纯函数（term-grid §3.1 / file-tabs §2.5 同语义）。独立叶子模块：
 * FileTabBar 等 screen 层组件也要消费，若留在 TileHeader（其引 LiveInteractions）会与
 * LiveInteractions→LiveFileTabsView→FileTabsView→FileTabBar 成 import 环（对抗验收 MINOR-1）。
 */

/** 状态三桶：waiting / running / 其余 idle。样式类各屏自有，此处只给语义。 */
export function statusKind(state: string): 'running' | 'waiting' | 'idle' {
  if (state === 'WaitingInput') return 'waiting';
  if (state === 'Running') return 'running';
  return 'idle';
}

/** tile-header 状态点类名（term-grid §3.1 三色 CSS 的消费入口）。 */
export function statusClass(state: string): string {
  return `tile-status--${statusKind(state)}`;
}
