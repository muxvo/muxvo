/**
 * 面板意图信箱（M5-R1 批3 W1）：从聊天历史 chrome 的配置 tab / 齿轮点击，把「回终端后要打开的配置面板」
 * 跨 lazy chunk 暂存，供终端 chrome（LiveChrome）挂载时消费。
 *
 * 为何需要：聊天历史与终端是两套 chrome，切面板必须先 chatClose 回终端态（native 半 setPanelMode(.terminal)
 * → 下一拍 ui.state 无 chatHistory → main.tsx 卸 chat chrome、挂 LiveChrome）。目标面板 id 无法随 chatClose
 * 的 ui.action 一起带（chatClose 无 payload），故经本模块单例传递。ESM 单例跨 lazy chunk 成立：共享模块被打进
 * 独立 shared chunk，chat chunk 与 live chunk 引用同一实例。
 *
 * TTL 防陈旧：若 native 未按预期切屏、或用户投信后久未落地，过期意图不再误开面板。
 *
 * StrictMode 安全（对抗 M-2）：**读（peek）与清（clear）分离**——LiveChrome 在 useState 初始化器里 peek
 * （纯读、不清除，dev StrictMode 双调初始化器均得同值，提交态稳定），在挂载 effect 里 clear（双 effect 下
 * 第二次 clear 幂等）。禁止在 render/初始化器里做「读走即清」的一次性副作用（会被 StrictMode 第二次调用吞掉）。
 */

import type { PanelId } from './panelRegistry';

/** 意图存活窗（ms）：投信到 LiveChrome 挂载消费应在数百 ms 内；超此判陈旧丢弃。 */
const PENDING_TTL_MS = 3000;

let pending: { panel: PanelId; ts: number } | null = null;

/** 投信：聊天历史点配置 tab/齿轮时调用（随后发 chatClose）。 */
export function setPendingPanel(panel: PanelId): void {
  pending = { panel, ts: Date.now() };
}

/** 只读待开面板（不清除，TTL 内有效；纯函数——可安全用于 render/useState 初始化器）。 */
export function peekPendingPanel(): PanelId | null {
  if (!pending) return null;
  return Date.now() - pending.ts > PENDING_TTL_MS ? null : pending.panel;
}

/** 清空信箱（LiveChrome 挂载 effect 里调；幂等）。 */
export function clearPendingPanel(): void {
  pending = null;
}

/** 取信（一次性 = peek + clear）：供一次性读走的外部用途（勿在 render/初始化器里用，见头注 StrictMode 说明）。 */
export function consumePendingPanel(): PanelId | null {
  const p = peekPendingPanel();
  clearPendingPanel();
  return p;
}
