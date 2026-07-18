/**
 * 首启导览编排（右上角批 B4；welcome-overlay.md §1 + tour-overlay.md §7）：
 * - 首启：config 快照就绪且 tourCompleted==false → **1.5s 后**出欢迎卡（legacy App.tsx:163-168）。
 *   「开始导览」= 置 tourCompleted:true + 进导览；「跳过」= 仅置位——欢迎卡一生只出一次。
 * - 设置重放：设置面板「新手引导」→ 关面板 100ms 后 requestTourStart()（tourIntent 信箱）→
 *   直接进导览（跳过欢迎卡、不重置 tourCompleted，legacy handleRestartTour 对齐）。
 * - What's New 升级自动弹归 feat/auto-update（whatsNewStatus 门 native 侧）；首装 lastSeen 缺席
 *   不弹（其门语义），与本欢迎卡天然互斥——首装只见欢迎卡，legacy 同构。
 * golden 隔离：仅 LiveChrome（bridge 路径）挂载；cfg 未就绪/截图模式恒 null 渲染。
 */

import { useEffect, useRef, useState } from 'react';
import type { Fixture } from '../../fixture/types';
import { useConfig, useConfigApi } from '../../config/ConfigContext';
import { WelcomeOverlayLive } from '../tour/WelcomeOverlayLive';
import { TourOverlayLive } from '../tour/TourOverlayLive';
import { subscribeTourStart } from './tourIntent';

const WELCOME_DELAY_MS = 1500; // legacy App.tsx:163 首启欢迎延迟

export function LiveOnboarding({ fx }: { fx: Fixture }): JSX.Element | null {
  const cfg = useConfig();
  const api = useConfigApi();
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const armedRef = useRef(false); // 首启判定只做一次（cfg 后续快照更新不重弹）

  // 首启欢迎卡：cfg 首次就绪且未完成导览 → 1.5s 后弹。
  useEffect(() => {
    if (!cfg || armedRef.current) return;
    armedRef.current = true;
    if (cfg.tourCompleted) return;
    const timer = setTimeout(() => setWelcomeVisible(true), WELCOME_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cfg]);

  // 设置面板重放：跳过欢迎卡直接进导览。
  useEffect(
    () =>
      subscribeTourStart(() => {
        setWelcomeVisible(false);
        setTourActive(true);
      }),
    [],
  );

  if (!cfg || !api) return null;
  const locale: 'zh' | 'en' = cfg.language === 'en' ? 'en' : 'zh';

  if (welcomeVisible) {
    return (
      <WelcomeOverlayLive
        locale={locale}
        onStartTour={() => {
          void api.set({ tourCompleted: true }); // legacy：点「开始导览」即置位
          setWelcomeVisible(false);
          setTourActive(true);
        }}
        onSkip={() => {
          void api.set({ tourCompleted: true }); // legacy：跳过同样置位（欢迎卡只出一次）
          setWelcomeVisible(false);
        }}
      />
    );
  }

  if (tourActive) {
    return <TourOverlayLive fx={fx} locale={locale} onComplete={() => setTourActive(false)} />;
  }

  return null;
}
