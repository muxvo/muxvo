/**
 * 新手引导 live 驱动（右上角批 B4；tour-overlay.md §0/§2/§7）：driver.js@1.4.0 直挂 live 真实 DOM
 * （TOUR_STEPS 选择器即生产布局元素），推进=真实用户动作落 ui.state 回推（tour-live-logic 纯函数），
 * 各步 +500ms ADVANCE_DELAY。步 1→2 推进后 `.driver-overlay` 置 display:none（legacy 实况 §0：
 * 只有步 1 具备完整 spotlight 形态）。ESC/× = 跳过（allowClose + onCloseClick/onDestroyed 兜底）；
 * 完成非跳过 → `.tour-complete-toast` 3s（legacy tour.complete 文案）。
 * 洞区穿透：drive/每步 highlight 后给 `.driver-overlay`/`.driver-popover` 补挂 data-hit-island——
 * useLayoutReport 的 MutationObserver 自动重上报（浮层=岛约定），native 把遮罩区从穿透区抠掉。
 * golden 隔离：本组件仅 LiveOnboarding（bridge 路径）挂载；golden TourOverlayScreen 零触碰。
 */

import { useEffect, useRef } from 'react';
import { track } from '../../bridge/track';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { TOUR_STEPS } from './tour-steps';
import { ADVANCE_DELAY_MS, TOUR_LIVE_STR, shouldAdvance, type TourFxView } from './tour-live-logic';
import './tour.css';

// toast/按钮文案随 locale（TOUR_LIVE_STR，MAJOR-1 回修）

/** driver.js 动态浮层补挂岛标（每步 highlight 后浮层可能重建，幂等重挂）。 */
function tagDriverIslands(): void {
  document
    .querySelectorAll('.driver-overlay, .driver-popover')
    .forEach((el) => el.setAttribute('data-hit-island', ''));
}

export function TourOverlayLive({
  fx,
  onComplete,
  locale = 'zh',
}: {
  fx: TourFxView;
  onComplete: () => void;
  locale?: 'zh' | 'en';
}): null {
  const str = TOUR_LIVE_STR[locale];
  const driverRef = useRef<Driver | null>(null);
  const baselineCountRef = useRef<number>(fx.terminals.length);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advancedPastFirstRef = useRef(false);
  const completedRef = useRef(false);
  const completeTourRef = useRef<(skipped: boolean) => void>(() => {});
  const fxRef = useRef(fx);
  fxRef.current = fx;

  // 挂载：建 driver（配置逐项对齐 legacy，tour-overlay.md §2）+ drive()。
  useEffect(() => {
    completeTourRef.current = (skipped: boolean): void => {
      if (completedRef.current) return;
      completedRef.current = true;
      // analytics.md L4：导览结束恰一次（× / Esc = skipped；末步动作完成 = completed）。
      track('onboarding.tour_ended', {
        outcome: skipped ? 'skipped' : 'completed',
        step: String(driverRef.current?.getActiveIndex?.() ?? -1),
      });
      if (!skipped) {
        // 完成 toast（legacy 3s；tour.css 基态透明 + --visible 过渡显形；先撤类走 0.35s 淡出再移除，MINOR-8）
        const toast = document.createElement('div');
        toast.className = 'tour-complete-toast';
        toast.textContent = str.complete;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('tour-complete-toast--visible'));
        setTimeout(() => toast.classList.remove('tour-complete-toast--visible'), 2600);
        setTimeout(() => toast.remove(), 3000);
      }
      driverRef.current?.destroy();
      driverRef.current = null;
      onComplete();
    };

    const tour = driver({
      showProgress: true,
      animate: true,
      overlayColor: 'rgba(6, 8, 12, 0.85)',
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: 'tour-popover',
      nextBtnText: str.next,
      prevBtnText: str.prev,
      doneBtnText: str.done,
      progressText: '{{current}} / {{total}}',
      allowClose: true,
      overlayClickBehavior: () => {},
      onCloseClick: () => completeTourRef.current(true), // × = 跳过（legacy onCloseClick→completeTour(true)）
      onDestroyed: () => {
        // ESC 走 driver 内部 destroy（不经 onCloseClick）→ 此钩子兜底收口（幂等）
        if (!completedRef.current) {
          completedRef.current = true;
          driverRef.current = null;
          onComplete();
        }
      },
      onHighlighted: () => {
        tagDriverIslands();
        // 步 2+ 撤遮罩（legacy §0 实况：advance 后 .driver-overlay display:none，让用户看清网格）
        if (advancedPastFirstRef.current) {
          document
            .querySelectorAll<HTMLElement>('.driver-overlay')
            .forEach((el) => (el.style.display = 'none'));
        }
      },
    });
    tour.setSteps(
      TOUR_STEPS.map((step) => ({
        element: step.selector,
        disableActiveInteraction: !step.interactive,
        popover: {
          // en 覆盖表命中用 en，否则回 zh 原文（MAJOR-1 回修；zh=TOUR_STEPS 原文零改）
          title: str.steps[step.id]?.title ?? step.title,
          description: str.steps[step.id]?.desc ?? step.desc,
          side: step.side,
          popoverClass: 'tour-popover',
          showButtons: step.showButtons,
        },
      })),
    );
    driverRef.current = tour;
    let cancelled = false;
    // fonts.ready 后 drive（气泡定位需终版字体度量，golden 屏同款）；jsdom 无 document.fonts → 直跑。
    const fontsReady: Promise<unknown> =
      (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    void fontsReady.then(() => {
      if (cancelled || completedRef.current) return;
      tour.drive();
      tagDriverIslands();
    });
    return () => {
      cancelled = true;
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      if (!completedRef.current) {
        completedRef.current = true; // 卸载即收（防 destroy→onDestroyed→onComplete 重入）
        driverRef.current?.destroy();
        driverRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 推进：ui.state 回推（fx 变化）→ 当前步条件满足 → 500ms 后 moveNext / 末步完成。
  useEffect(() => {
    const tour = driverRef.current;
    if (!tour || completedRef.current || advanceTimerRef.current) return;
    const idx = tour.getActiveIndex?.() ?? -1;
    const step = TOUR_STEPS[idx];
    if (!step || !shouldAdvance(step.id, baselineCountRef.current, fx)) return;
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      const d = driverRef.current;
      if (!d || completedRef.current) return;
      // 再验条件（500ms 窗内状态可能回退，legacy 定时器同窗语义）
      const cur = d.getActiveIndex?.() ?? -1;
      const curStep = TOUR_STEPS[cur];
      if (!curStep || !shouldAdvance(curStep.id, baselineCountRef.current, fxRef.current)) return;
      advancedPastFirstRef.current = true;
      if (d.hasNextStep()) d.moveNext();
      else completeTourRef.current(false); // 末步动作完成 → toast + 收口
    }, ADVANCE_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx]);

  return null;
}
