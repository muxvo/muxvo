/**
 * LiveWaitingCard（DOGFOOD_M3_18）：等待浮卡的 **live 覆盖层托管**。
 *
 * legacy 铁证 src/renderer/components/terminal/WaitingInputNotification.tsx L74：
 *   `if (waitingCount === 0 || !overlayActive || dismissed) return null;`
 *   —— 浮卡**只在用户处于非终端覆盖层时显示**（那里看不到 tile 红点，浮卡是唯一屏内提醒），
 *   点卡片正文 `onSwitchToTerminals`（legacy dispatch CLOSE_ALL）跳回终端屏，✕ 单独清红。
 * 用户裁决 2026-07-07：终端屏不显示；非终端 tile 视图（Skills/MCP/Hooks/Plugins/历史聊天/任务中心）
 * 保留浮卡 + 点击跳回终端。
 *
 * 挂载方各自决定「是否处于非终端覆盖层」与「跳回终端」的具体动作（配置面板 = setPanel(null)；
 * 聊天历史 = chatClose；任务中心 = exitTaskCenter），本组件只吃 fx.waitingNotification 决定显隐、
 * 统一 ✕ 清红（对所有 WaitingInput 终端发 acknowledgeWaiting，wait-detector §3）。
 *
 * z 层级抬到配置面板 overlay(z400) 之上（settings backdrop z500 与浮卡互斥不共现，见 live-chrome.css）。
 */

import type { UIAction } from '../../bridge/gen/protocol';
import type { Fixture } from '../../fixture/types';
import { WaitingCard } from '../WaitingCard';

/** 高于配置面板 overlay(z400)；settings 覆盖层不显示浮卡故不与其 z500 backdrop 竞争。 */
const LIVE_WAITING_CARD_Z = 450;

export function LiveWaitingCard({
  fx,
  sendAction,
  onSwitchToTerminals,
}: {
  fx: Fixture;
  sendAction: (action: UIAction) => void;
  onSwitchToTerminals: () => void;
}): JSX.Element | null {
  const wn = fx.waitingNotification;
  if (!wn) return null;
  return (
    <WaitingCard
      count={wn.count}
      zIndex={LIVE_WAITING_CARD_Z}
      onActivate={onSwitchToTerminals}
      onDismiss={() => {
        for (const t of fx.terminals) {
          if (t.state === 'WaitingInput') sendAction({ kind: 'acknowledgeWaiting', terminalId: t.id });
        }
      }}
    />
  );
}
