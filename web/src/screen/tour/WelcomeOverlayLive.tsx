/**
 * 首启欢迎卡 live 接线（右上角批 B4；welcome-overlay.md §1）：golden 视觉件 WelcomeOverlayScreen
 * 一行不动，外包事件委托层——「开始导览」= 置 tourCompleted:true + 进导览；「跳过，稍后再看」=
 * 仅置 tourCompleted:true（legacy 两钮均立即置位，欢迎卡只出现一次）。
 *
 * data-hit-island 几何契约（发布阻断回修 fix/welcome-overlay-island）：外包 div **必须自身覆盖全屏**——
 * useLayoutReport 上报 `data-hit-island` 元素的 getBoundingClientRect 令 native 从终端穿透区抠掉该矩形；
 * 内层 golden 件 `.welcome-overlay` 是 position:fixed（脱离文档流），若外包 div 无样式则其高度塌成 0 →
 * 上报 visible:false 的零高度岛 → native 不抠 → 点击穿透到下层 Metal 终端、按钮全部点不动（真机实证：
 * jsdom 无布局测不出）。故外包 div 同挂 fixed inset:0 撑满全屏（透明命中层，视觉全由内层卡片承载），
 * 与能正常点的 `.live-panel-overlay`（data-hit-island 挂全屏元素）同工艺。z-index 对齐内层 welcome.css:600。
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef } from 'react';
import { track } from '../../bridge/track';
import { WelcomeOverlayScreen } from './WelcomeOverlayScreen';

/** 命中层几何契约（data-hit-island 必须全屏，否则岛塌 0 高度 → 点击穿透）。抽常量供单测断言防回归。 */
export const WELCOME_HIT_LAYER_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 600,
} as const;

export function WelcomeOverlayLive({
  onStartTour,
  onSkip,
  locale = 'zh',
}: {
  onStartTour: () => void;
  onSkip: () => void;
  locale?: 'zh' | 'en';
}): JSX.Element {
  // analytics.md L4：欢迎浮层展示恰一次（ref 门防 dev StrictMode 双挂载重发；真机取证 ×2）。
  const shownTrackedRef = useRef(false);
  useEffect(() => {
    if (shownTrackedRef.current) return;
    shownTrackedRef.current = true;
    track('onboarding.welcome_shown');
  }, []);
  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.closest('.welcome-overlay__start-btn')) onStartTour();
    else if (target.closest('.welcome-overlay__skip-btn')) onSkip();
  };
  return (
    <div onClick={onClick} data-hit-island="" data-live-welcome="" style={WELCOME_HIT_LAYER_STYLE}>
      <WelcomeOverlayScreen locale={locale} />
    </div>
  );
}
