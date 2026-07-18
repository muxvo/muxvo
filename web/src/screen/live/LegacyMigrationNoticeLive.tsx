/**
 * 老版聊天归档首启迁移提示（legacy-migration.md §7.2 M7 批3）。
 *
 * LiveChrome 挂载 → legacyMigrationNotice 查询（native 查询即消费一次性闩，同 HookEnabledNoticeLive/
 * WhatsNewGate「查询即写回」）→ show=true 时渲染底部 toast，4s 自动消隐后卸载。native 侧仅在
 * 「检测到老版 ~/.muxvo/chat-archive 且本次迁移有命中（copied>0）」时回 true，且一生仅一次
 * （首个查询者拿到后置 legacyChatMigrationNoticeShown 闩）。零命中/隔离分身恒 false = 零 DOM。
 *
 * 时序说明（供复验）：迁移在后台 warmup（首次 chat.request）落 marker，故本 toast 展示在**迁移完成
 * 后的下一次启动**——措辞「已迁入」对同次或次启动均成立。纯显示不拦点击（pointer-events:none）。
 */

import { useEffect, useState } from 'react';
import { useConfig, useConfigApi } from '../../config/ConfigContext';

const TEXT = {
  zh: '已迁入你的历史聊天归档，可在「聊天记录」中查看',
  en: 'Your previous chat history has been imported — find it in Chat History.',
} as const;

/** 显形 4s + 消隐过渡 0.35s（HookEnabledNoticeLive 同款时序量级）。 */
const VISIBLE_MS = 4000;
const FADE_MS = 400;

export function LegacyMigrationNoticeLive(): JSX.Element | null {
  const cfg = useConfig();
  const api = useConfigApi();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void api
      .sendAppRequest({ kind: 'legacyMigrationNotice' })
      .then((r) => {
        if (cancelled || r.kind !== 'migrationNotice' || !r.show) return;
        setMounted(true);
        // 下一拍再挂 --visible：先以透明基态入 DOM，过渡才有起点（hook toast 同款）。
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
    <div className={`migration-notice-toast${visible ? ' migration-notice-toast--visible' : ''}`}>
      {TEXT[locale]}
    </div>
  );
}
