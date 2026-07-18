/**
 * 配置面板 live 状态（纯函数，vitest 直测；LiveChrome 与四 live 面板消费）。
 *
 * ① 面板 open-state 互斥（CONFIG_L1_09）：四配置面板任一时刻至多一个打开（单值天然互斥），
 *    openPanel 打开一个即隐含关闭其余，closeAllPanels 全关。
 * ② 面板内 detail 两级导航（CONFIG_L1_15/27）：view(detail) ⇄ edit(form) ⇄ close。
 *    MCP/Hooks 的 edit→view→close 两级 Esc = detailReducer 的 cancel/save（回 view）+ close（回列表）。
 */

export type LivePanelId = 'skills' | 'mcp' | 'hooks' | 'plugins';

/** 四配置面板 id（角标/注册表迭代序）。 */
export const LIVE_PANEL_IDS: readonly LivePanelId[] = ['skills', 'mcp', 'hooks', 'plugins'];

/** 打开一个面板（互斥：单值即隐含关闭其余）。 */
export function openPanel(_current: LivePanelId | null, id: LivePanelId): LivePanelId {
  return id;
}

/** 切换：已打开的同一面板再点则关闭，否则互斥打开目标。 */
export function togglePanel(current: LivePanelId | null, id: LivePanelId): LivePanelId | null {
  return current === id ? null : id;
}

/** 全部关闭（closeAllPanels 行为）。 */
export function closeAllPanels(): null {
  return null;
}

/** 是否有任一面板打开。 */
export function anyPanelOpen(current: LivePanelId | null): boolean {
  return current !== null;
}

// ── detail 两级导航（MCP/Hooks；Skills 无 form 用 dirty 守卫，见 useSkillsLive） ──

export interface DetailState {
  /** 选中项 id（null = 列表态未选中）。 */
  selectedId: string | null;
  /** true = 编辑表单态；false = 只读 detail 态。 */
  form: boolean;
}

export const DETAIL_INITIAL: DetailState = { selectedId: null, form: false };

export type DetailAction =
  | { type: 'select'; id: string }
  | { type: 'edit' }
  | { type: 'save' }
  | { type: 'cancel' }
  | { type: 'close' };

/**
 * detail 状态机（两级 Esc 的数据面）：
 *  - select(id)：进只读 detail（form=false）。
 *  - edit：detail → 编辑表单（form=true）。
 *  - save / cancel：表单 → 回只读 detail（form=false，selectedId 不变）。
 *  - close：任意态 → 回列表（selectedId=null）。
 * Esc 路由（LiveChrome 层，A2）：form 时派 cancel（第一级）、detail 时派 close（第二级）。
 */
export function detailReducer(state: DetailState, action: DetailAction): DetailState {
  switch (action.type) {
    case 'select':
      return { selectedId: action.id, form: false };
    case 'edit':
      return state.selectedId ? { ...state, form: true } : state;
    case 'save':
    case 'cancel':
      return { ...state, form: false };
    case 'close':
      return DETAIL_INITIAL;
    default:
      return state;
  }
}
