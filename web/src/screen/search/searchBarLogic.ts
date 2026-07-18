/**
 * 搜索条交互纯逻辑（terminal-search-bar.md §5.5）：键映射 + 输入防抖派发器。
 * 抽出为无 DOM 纯模块 → node 环境 vitest 可直测（组件本身是薄挂载胶水，不单测）。
 */

/** 输入防抖延时（ms）：连续键入只在停顿后派发一次 searchQuery，避免每键一发。 */
export const SEARCH_DEBOUNCE_MS = 150;

/** 搜索框 keydown 的键 → 导航/关闭动作（纯映射）。返回 null = 不拦截（放行默认行为）。 */
export function searchKeyAction(
  key: string,
  shiftKey: boolean,
): 'searchNext' | 'searchPrev' | 'searchClose' | null {
  if (key === 'Enter') return shiftKey ? 'searchPrev' : 'searchNext';
  if (key === 'Escape') return 'searchClose';
  return null;
}

/** 防抖派发器（真实 setTimeout；测试注入 fake timers）。 */
export interface QueryDebouncer {
  /** 排期一次派发（覆盖前一次待发）。 */
  schedule(query: string): void;
  /** 有待发的立即派发并返回 true；无则返回 false（Enter 据此决定「先冲刷查询」还是「导航」）。 */
  flush(): boolean;
  /** 丢弃待发（关闭 / 卸载）。 */
  cancel(): void;
}

/** 造一个防抖派发器：dispatch 收最终 query 串。 */
export function makeQueryDebouncer(
  dispatch: (query: string) => void,
  delayMs: number = SEARCH_DEBOUNCE_MS,
): QueryDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  const fire = (): void => {
    timer = null;
    const q = pending;
    pending = null;
    if (q !== null) dispatch(q);
  };
  return {
    schedule(query: string): void {
      pending = query;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    },
    flush(): boolean {
      if (timer === null) return false;
      clearTimeout(timer);
      fire();
      return true;
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
