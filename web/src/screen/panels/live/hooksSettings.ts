/**
 * Hooks settings.json 展平/解析/回写（纯函数，vitest 直测；useHooksLive 消费）。
 *
 * 单一数据源：settings.hooks 嵌套结构 →（展平规则：事件序→组序→处理器序，id=`global:event:gi:hi`）
 * → HookEntry[]。web 侧与 HooksPanelScreen 内置展平同构（此处为 live 写路径 + 损坏兜底的权威纯函数）。
 *
 * CONFIG_L1_18 锚点：settings.json 损坏（JSON.parse 抛）或无 hooks 字段 → parseHooksSettings 归
 * `{ hooks: {} }` → 展平得 [] → 空态不崩（catch→[] 行为）。
 */

export interface HookHandler {
  type: 'command' | 'prompt' | 'agent';
  command: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
  once?: boolean;
}

export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
}

export interface HooksSettings {
  hooks: Record<string, HookMatcherGroup[]>;
}

export interface HookEntry {
  id: string;
  event: string;
  matcher?: string;
  handler: HookHandler;
}

/**
 * 解析 config.getSettings() 返回的 settings JSON。
 * 损坏（parse 抛）/ 非对象 / 无 hooks → `{ hooks: {} }`（CONFIG_L1_18：catch→[]→空态不崩）。
 */
export function parseHooksSettings(json: string): HooksSettings {
  try {
    const obj = JSON.parse(json) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const hooks = (obj as { hooks?: unknown }).hooks;
      if (hooks && typeof hooks === 'object' && !Array.isArray(hooks)) {
        return { hooks: hooks as Record<string, HookMatcherGroup[]> };
      }
    }
  } catch {
    /* 损坏 → 归空 */
  }
  return { hooks: {} };
}

/** 展平：Event → MatcherGroup[] → Handler[] → HookEntry（id=`global:event:gi:hi`）。非数组安全跳过。 */
export function flattenHooks(hooksObj: Record<string, HookMatcherGroup[]>): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooksObj ?? {})) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      if (!group || !Array.isArray(group.hooks)) return;
      group.hooks.forEach((handler, hi) => {
        entries.push({ id: `global:${event}:${gi}:${hi}`, event, matcher: group.matcher, handler });
      });
    });
  }
  return entries;
}

/** 损坏兜底一步到位：JSON → 展平（corrupt → []）。 */
export function flattenHooksFromJson(json: string): HookEntry[] {
  return flattenHooks(parseHooksSettings(json).hooks);
}

/** 展平 id → {event, gi, hi}；形状非法返回 null。 */
export function parseHookId(id: string): { event: string; gi: number; hi: number } | null {
  const parts = id.split(':');
  if (parts.length !== 4 || parts[0] !== 'global') return null;
  const gi = Number(parts[2]);
  const hi = Number(parts[3]);
  if (!Number.isInteger(gi) || !Number.isInteger(hi)) return null;
  return { event: parts[1], gi, hi };
}

function cloneHooks(hooks: Record<string, HookMatcherGroup[]>): Record<string, HookMatcherGroup[]> {
  return JSON.parse(JSON.stringify(hooks ?? {})) as Record<string, HookMatcherGroup[]>;
}

/**
 * 表单保存：把 entryId 指向的处理器替换为 next（CONFIG_L1_13/27）。
 *  - event 不变：就地替换 [gi].hooks[hi] = handler，并更新该组 matcher（App 路径 group 多为单处理器；
 *    多处理器共享 matcher 的边界见下方 note）。
 *  - event 变更：从旧事件组摘除（组空则删组、事件空则删键）→ 目标事件按 matcher 归组追加。
 * 返回全新 settings（不改入参）。id 非法则原样返回。
 *
 * note（多处理器组 matcher）：同组多处理器共享 matcher，就地改 matcher 会波及兄弟处理器；
 * legacy 表单亦按整组 matcher 语义（HooksPanel 编辑单条时组多为单处理器），此处沿用不额外拆组。
 */
export function applyHookEdit(
  settings: HooksSettings,
  entryId: string,
  next: { event: string; matcher?: string; handler: HookHandler },
): HooksSettings {
  const parsed = parseHookId(entryId);
  if (!parsed) return settings;
  const hooks = cloneHooks(settings.hooks);

  if (next.event === parsed.event) {
    const groups = hooks[parsed.event];
    const group = Array.isArray(groups) ? groups[parsed.gi] : undefined;
    if (group && Array.isArray(group.hooks) && group.hooks[parsed.hi]) {
      group.hooks[parsed.hi] = next.handler;
      if (next.matcher === undefined) delete group.matcher;
      else group.matcher = next.matcher;
    }
    return { hooks };
  }

  // event 变更：摘旧
  const oldGroups = hooks[parsed.event];
  if (Array.isArray(oldGroups) && oldGroups[parsed.gi]?.hooks) {
    oldGroups[parsed.gi].hooks.splice(parsed.hi, 1);
    if (oldGroups[parsed.gi].hooks.length === 0) oldGroups.splice(parsed.gi, 1);
    if (oldGroups.length === 0) delete hooks[parsed.event];
  }
  // 归目标事件（按 matcher 匹配现有组，否则新建组）
  const targetGroups = hooks[next.event] ?? (hooks[next.event] = []);
  let group = targetGroups.find((g) => (g.matcher ?? '') === (next.matcher ?? ''));
  if (!group) {
    group = next.matcher === undefined ? { hooks: [] } : { matcher: next.matcher, hooks: [] };
    targetGroups.push(group);
  }
  group.hooks.push(next.handler);
  return { hooks };
}

/** settings 回写 JSON（saveSettings payload；2 空格缩进对齐 legacy 写盘）。 */
export function serializeSettings<T>(settings: T): string {
  return JSON.stringify(settings, null, 2);
}
