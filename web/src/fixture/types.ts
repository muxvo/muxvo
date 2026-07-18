/**
 * Fixture 类型 —— 自 M1 起权威来源为 bridge/protocol.json（specs/bridge/bridge-v1.md §5.2），
 * 本文件仅 re-export + 注入容错的本地宽松别名。纯类型文件，运行时零代码（视觉回归零影响）。
 * 与 muxvo/tools/visual-diff/fixtures/_CONTRACT.md 的 ResolvedFixture 对应。
 */
import type { TerminalSnapshot, TerminalState, UIState } from '../bridge/gen/protocol';

export type { ContentLine, ContentSegment, TerminalState } from '../bridge/gen/protocol';

/** 注入容错：fixture 文件允许未知 state 字符串（协议侧严格 10 枚举，宽松别名不进协议） */
export type TerminalFixture = Omit<TerminalSnapshot, 'state'> & {
  state: TerminalState | string;
};

/**
 * Fixture ≡ UIState（协议 §5.2），仅 terminals 放宽为 TerminalFixture。
 * M2 起多屏：可选 screen 字段（缺省 'terminal-grid'）路由到 screen/registry.ts；
 * 桥推送的 ui.state 永远无 screen 字段（恒终端网格屏）。
 */
export type Fixture = Omit<UIState, 'terminals'> & {
  terminals: TerminalFixture[];
  screen?: string;
  /** fixture-only 截图初始折叠态提示（收起边栏折叠是 web 本地态，不过桥；仅 golden 用，桥推送恒缺席）。 */
  minRailCollapsed?: boolean;
};
