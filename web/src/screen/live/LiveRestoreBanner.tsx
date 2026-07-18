/**
 * 会话恢复顶部横幅（terminal-session-restore.md §4 顶部横幅 form 半，B5 登记6）。
 *
 * substance（durable 本地日志 + 尽力而为系统通知）已由 native 恢复层落定；本组件只补「web 顶部条」视觉
 * form：两类计数任一 >0 时出一条顶栏，用户可关闭（dismissRestoreBanner）。native 侧按 seq 无关的投影派生
 * restoreBanner——关闭态存 native（本轮隐藏），下一轮重启新计数重新可见。
 *
 * 文案与 native durable log 口径一致（SessionRestoreSupport cannotRestoreBody/crashLoopBody）。
 * 纯 props：无 fx.restoreBanner → 不渲染（截图/纯展示模式恒缺席，golden 零差异）。
 */
import type { RestoreBanner, UIAction } from '../../bridge/gen/protocol';

export function LiveRestoreBanner({
  banner,
  onAction,
}: {
  banner: RestoreBanner | null | undefined;
  onAction: (action: UIAction) => void;
}): JSX.Element | null {
  if (!banner) return null;
  const { cannotRestoreCount, crashLoopPausedCount } = banner;
  if (cannotRestoreCount <= 0 && crashLoopPausedCount <= 0) return null;

  const messages: string[] = [];
  if (cannotRestoreCount > 0) messages.push(`${cannotRestoreCount} 个会话无法在本机恢复`);
  if (crashLoopPausedCount > 0)
    messages.push(`${crashLoopPausedCount} 个会话反复崩溃，已暂停自动恢复，可手动重开`);

  return (
    <div className="live-restore-banner" role="status" data-restore-banner="">
      <span className="live-restore-banner__text">{messages.join('；')}</span>
      <button
        type="button"
        className="live-restore-banner__dismiss"
        aria-label="关闭"
        onClick={() => onAction({ kind: 'dismissRestoreBanner' })}
      >
        ×
      </button>
    </div>
  );
}
