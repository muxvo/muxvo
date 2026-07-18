/**
 * live 配置面板注册表（M6 批1，A2 定义的接缝）：LiveChrome 只按 PanelId 路由「哪个面板打开」，
 * 面板 live 组件由 A3 交付并经 registerLivePanel 注册进本表——A3 只加自己文件 + 在
 * registerLivePanels.ts 追加副作用 import，不改 LiveChrome.tsx / 本文件。
 *
 * 契约（A3 遵守）：
 *  - 每个 live 面板组件 = React.ComponentType<LivePanelProps>，经 ConfigContext（useConfig/
 *    useConfigApi）自取数据，永不 mock 桥。
 *  - onClose：回终端态（关本面板）。面板内两级导航 / dirty 守卫先自行拦截，决定后再调 onClose。
 *  - Esc 由 LiveChrome 顶层监听（bubble 相、`!defaultPrevented` 才关面板）；面板要在子级/ dirty
 *    时拦截 Esc，请在自身 capture 相监听并 stopPropagation，LiveChrome 便不会关闭（CONFIG_L1_15）。
 *  - 未注册的 PanelId → LiveChrome 渲染空槽（overlay 容器带 data-live-panel 但内容 null），
 *    路由/互斥/角标行为不依赖 A3 组件是否就位（供 A2 测试独立断言）。
 */

import type { ComponentType } from 'react';

/** 互斥面板身份（gear=settings；skills/mcp/hooks/plugins 对应同名 tab）。 */
export type PanelId = 'skills' | 'mcp' | 'hooks' | 'plugins' | 'settings';

export interface LivePanelProps {
  /** 关闭本面板（回终端态）。面板内 dirty / 两级守卫自行拦截后再决定是否调用。 */
  onClose: () => void;
}

export type LivePanelComponent = ComponentType<LivePanelProps>;

const registry = new Map<PanelId, LivePanelComponent>();

/** A3 在自己面板文件模块级调用注册（幂等覆盖：热重载/重复 import 安全）。 */
export function registerLivePanel(id: PanelId, component: LivePanelComponent): void {
  registry.set(id, component);
}

/** LiveChrome 渲染时取活跃面板组件；未注册 → undefined（渲染空槽）。 */
export function getLivePanel(id: PanelId): LivePanelComponent | undefined {
  return registry.get(id);
}
