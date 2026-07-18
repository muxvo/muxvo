/**
 * hook 首启自动启用一次性轻提示（wait-detector.md §7 首启自动启用条款）。
 *
 * LiveChrome 挂载 → hookAutoEnableNotice 查询（native 查询即消费清 pending，WhatsNewGate
 * 「查询即写回」同款，一次性由 native 半保证）→ show=true 时渲染底部 toast，4s 自动消隐后卸载。
 * 纯显示不拦点击（pointer-events:none，无需 data-hit-island）；无桥/show=false = 零 DOM。
 */

import { useEffect, useState } from 'react';
import { useConfig, useConfigApi } from '../../config/ConfigContext';

const TEXT = {
  zh: '已启用终端等待检测，可在设置中管理',
  en: 'Terminal wait detection is on. Manage it in Settings.',
} as const;

/** 显形 4s + 消隐过渡 0.35s（tour-complete-toast 同款时序量级）。 */
const VISIBLE_MS = 4000;
const FADE_MS = 400;

export function HookEnabledNoticeLive(): JSX.Element | null {
  const cfg = useConfig();
  const api = useConfigApi();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void api
      .sendAppRequest({ kind: 'hookAutoEnableNotice' })
      .then((r) => {
        if (cancelled || r.kind !== 'hookNotice' || !r.show) return;
        setMounted(true);
        // 下一拍再挂 --visible：先以透明基态入 DOM，过渡才有起点（tour toast 同款）。
        timers.push(setTimeout(() => setVisible(true), 50));
        timers.push(setTimeout(() => setVisible(false), 50 + VISIBLE_MS));
        timers.push(setTimeout(() => setMounted(false), 50 + VISIBLE_MS + FADE_MS));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [api]);

  if (!api || !mounted) return null;

  const locale = cfg?.language === 'en' ? 'en' : 'zh';
  return (
    <div className={`hook-enabled-toast${visible ? ' hook-enabled-toast--visible' : ''}`}>
      {TEXT[locale]}
    </div>
  );
}
