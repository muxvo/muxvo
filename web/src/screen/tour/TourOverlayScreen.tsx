/**
 * 新手引导 spotlight 屏（specs/behavior/tour-overlay.md）。
 * M2 唯一复合宿主特例（screens.json 裁决#4 授权）：宿主 = menu-bar 屏同构
 * （MenuBarScreen 复用，auth/update 均无），spotlight 层由 driver.js@1.4.0（与 legacy
 * 同版本同库，dist 字节一致）按真实 DOM rect 挖孔+定位——挖孔 path/气泡定位数学同库
 * 像素同源，不手抄。固定渲染步 1（代表 step 裁决 spec §4）；fonts.ready 后才 drive()
 * （气泡 left/top 定位后不重算，须终版字体度量）；ready = 气泡 rect + 挖孔 path[d]
 * 连续 30 帧稳定后在 .app 打逐 fixture 唯一戳记（golden 侧对称，B5 稳定闸先例）。
 */

import { useEffect } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { MenuBarScreen } from '../menubar/MenuBarScreen';
import { TOUR_STEPS } from './tour-steps';
import './tour.css';

export function TourOverlayScreen({ fx }: { fx: any }): JSX.Element {
  useEffect(() => {
    // 配置逐项对齐 legacy TourOverlay（spec §2 视觉相关项；行为回调不属视觉，不设）
    const tour = driver({
      showProgress: true,
      animate: true,
      overlayColor: 'rgba(6, 8, 12, 0.85)',
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: 'tour-popover',
      nextBtnText: '下一步',
      prevBtnText: '上一步',
      doneBtnText: '完成',
      progressText: '{{current}} / {{total}}',
      allowClose: true,
      overlayClickBehavior: () => {},
    });
    tour.setSteps(
      TOUR_STEPS.map((step) => ({
        element: step.selector,
        disableActiveInteraction: !step.interactive,
        popover: {
          title: step.title,
          description: step.desc,
          side: step.side,
          popoverClass: 'tour-popover',
          showButtons: step.showButtons,
        },
      })),
    );

    let raf = 0;
    let stableFrames = 0;
    let prevSig = '';
    const tick = () => {
      const popover = document.querySelector('.driver-popover');
      const path = document.querySelector('.driver-overlay path');
      if (popover && path) {
        const r = popover.getBoundingClientRect();
        const sig = `${path.getAttribute('d')}|${r.x},${r.y},${r.width},${r.height}`;
        if (sig === prevSig) {
          stableFrames++;
        } else {
          stableFrames = 0;
          prevSig = sig;
        }
        if (stableFrames >= 30) {
          document.querySelector('.app')?.setAttribute('data-fx-tour-ready', fx.id);
          return; // 打标即收（不稳不打标 → capture 超时红）
        }
      } else {
        stableFrames = 0;
        prevSig = '';
      }
      raf = requestAnimationFrame(tick);
    };

    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      tour.drive();
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      tour.destroy();
    };
    // fx 随 key={fx.id} 重挂固定，effect 仅跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <MenuBarScreen fx={fx} />;
}
