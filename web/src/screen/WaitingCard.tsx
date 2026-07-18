/**
 * WaitingInputNotification 浮卡（spec §5）：fixed 右下 16px，
 * 红点 + "N 等待操作" + ✕。fixture 直接控制显隐与计数。
 *
 * 显隐门控在挂载方（截图/纯展示走 TerminalScreen；live 覆盖层走 LiveWaitingCard，
 * 见 DOGFOOD_M3_18 + legacy WaitingInputNotification.tsx L74 overlayActive 语义）——
 * 本组件仅纯展示：给了就画。
 */

export function WaitingCard({
  count,
  onDismiss,
  onActivate,
  zIndex = 200,
}: {
  count: number;
  /** ✕ 清红（acknowledgeWaiting）。未传（截图/纯展示）不挂监听。 */
  onDismiss?: () => void;
  /** 点卡片正文 = 跳回终端屏（legacy onSwitchToTerminals）。未传（截图/纯展示）不挂监听。 */
  onActivate?: () => void;
  /** 层级：缺省 200（golden f8 冻结值）；live 覆盖层上下文抬高以压过配置面板 overlay(z400)。 */
  zIndex?: number;
}): JSX.Element {
  return (
    // data-hit-island：浮卡盖在终端洞上，穿透岛采集器据此上报 role="island"，令 native 从穿透区
    // 抠掉本卡片区（否则 ✕ 点击被下层终端吞掉）。data-* 零像素，golden 不变（DOGFOOD_M3_04）。
    <div
      data-hit-island=""
      onClick={onActivate}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex,
        maxWidth: 280,
        borderRadius: 8,
        background: 'var(--bg-elevated)',
        border: '1px solid rgba(239, 68, 68, 0.4)',
        boxShadow: '0 4px 16px rgba(239, 68, 68, 0.15), var(--shadow-elevated)',
        padding: 12,
        fontSize: 13,
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className="waiting-card__dot"
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#ef4444',
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1 }}>{count} 等待操作</span>
        <button
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation(); // ✕ 只清红，绝不冒泡触发卡片正文的 onActivate（跳回终端）
            onDismiss?.();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
