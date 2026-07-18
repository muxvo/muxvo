/**
 * 公开仓 overlay stub（编排物理剥离，开源前置重构第 4 步）。
 * 导出时经 export-public.sh 覆盖私仓 web/src/bridge/orchChannel.tsx（同路径）——编排通道返空监听 +
 * null 面板，main.tsx 零 patch、编排面板永不渲染（编排面板本就只在 native 推 panelMode==='taskCenter'
 * 时渲染，公开仓门控关死该入口）。本 stub 零编排类型 import（不引 TaskCenterScreen/orch Gen 类型）。
 */
import type { BridgeApi } from './client';
import type { Fixture } from '../fixture/types';

export interface OrchChannel {
  bridgeListeners: Record<string, never>;
  renderPanel(fx: Fixture): JSX.Element | null;
}

export function useOrchChannel(_bridge: BridgeApi | null): OrchChannel {
  return { bridgeListeners: {}, renderPanel: () => null };
}
