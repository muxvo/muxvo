/**
 * Hooks 两栏面板屏（specs/behavior/hooks-panel.md）。纯 props 吃 fixture，永不 mock IPC。
 * 单一数据源：fixture 只带嵌套 settings.hooks，本组件用 legacy flattenHooks 同构规则展平
 * （事件插入序 → 组序 → 处理器序，id='global:<event>:<gi>:<hi>'）。
 * CONFIG_L1_17：空态文案以 legacy 实渲染为准（'暂无 Hook 配置'，HooksPanel.tsx:173）。
 */

import './panels.css';

interface HookHandler {
  type: 'command' | 'prompt' | 'agent';
  command: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
  once?: boolean;
}

interface HookMatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
}

interface HookEntry {
  id: string;
  event: string;
  matcher?: string;
  handler: HookHandler;
}

interface HooksPayload {
  settings: { hooks: Record<string, HookMatcherGroup[]> };
  selectedId: string | null;
  form?: boolean;
  /** dom-assert 面：loading 态 */
  loading?: boolean;
}

/** legacy useHookConfig.ts flattenHooks 同构（scope 恒 global，App 路径无项目源） */
function flattenHooks(hooksObj: Record<string, HookMatcherGroup[]>): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      if (!Array.isArray(group.hooks)) return;
      group.hooks.forEach((handler, hi) => {
        entries.push({ id: `global:${event}:${gi}:${hi}`, event, matcher: group.matcher, handler });
      });
    });
  }
  return entries;
}

function groupByEvent(hooks: HookEntry[]): Record<string, HookEntry[]> {
  const result: Record<string, HookEntry[]> = {};
  for (const h of hooks) {
    if (!result[h.event]) result[h.event] = [];
    result[h.event].push(h);
  }
  return result;
}

/** legacy HooksPanel.tsx ALL_EVENTS 同款（表单 select 选项） */
const ALL_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop',
  'SubagentStart', 'SubagentStop', 'TeammateIdle', 'TaskCompleted',
  'Notification', 'ConfigChange', 'PreCompact',
];

function HandlerBadge({ type }: { type: HookHandler['type'] }): JSX.Element {
  return <span className={`hooks-panel__handler-badge hooks-panel__handler-badge--${type}`}>{type}</span>;
}

function ScopeBadge(): JSX.Element {
  return <span className="hooks-panel__scope-badge hooks-panel__scope--global">Global</span>;
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="hooks-panel__detail-row">
      <span className="hooks-panel__detail-label">{label}</span>
      <span className={`hooks-panel__detail-value${mono ? ' hooks-panel__detail-value--mono' : ''}`}>{value}</span>
    </div>
  );
}

function HookDetail({ hook, configPath }: { hook: HookEntry; configPath: string }): JSX.Element {
  return (
    <div className="hooks-panel__detail">
      <div className="hooks-panel__detail-header">
        <span className="hooks-panel__detail-event">{hook.event}</span>
        <HandlerBadge type={hook.handler.type} />
        <ScopeBadge />
      </div>

      <div className="hooks-panel__detail-body">
        {hook.matcher && <DetailRow label="匹配器" value={hook.matcher} mono />}
        <DetailRow label="命令" value={hook.handler.command} mono />
        <DetailRow label="处理类型" value={hook.handler.type} />
        {hook.handler.timeout != null && <DetailRow label="超时" value={`${hook.handler.timeout}ms`} />}
        {hook.handler.async && <DetailRow label="异步执行" value="true" />}
        {hook.handler.statusMessage && <DetailRow label="状态消息" value={hook.handler.statusMessage} />}
        {hook.handler.once && <DetailRow label="仅执行一次" value="true" />}
        <DetailRow label="配置路径" value={configPath} mono />
      </div>

      <div className="hooks-panel__detail-actions">
        <button className="hooks-panel__btn hooks-panel__btn--primary">编辑</button>
        <button className="hooks-panel__btn hooks-panel__btn--danger">删除</button>
      </div>
    </div>
  );
}

function HookForm({ hook }: { hook: HookEntry }): JSX.Element {
  return (
    <div className="hooks-panel__form">
      <div className="hooks-panel__form-header">编辑 Hook</div>

      <div className="hooks-panel__form-body">
        <label className="hooks-panel__form-label">
          事件
          <select className="hooks-panel__form-select" value={hook.event} onChange={() => {}}>
            {ALL_EVENTS.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
        </label>

        <label className="hooks-panel__form-label">
          匹配器
          <input className="hooks-panel__form-input" value={hook.matcher ?? ''} placeholder="工具名称或正则（可选）" readOnly />
        </label>

        <label className="hooks-panel__form-label">
          处理类型
          <select className="hooks-panel__form-select" value={hook.handler.type} onChange={() => {}}>
            <option value="command">command</option>
            <option value="prompt">prompt</option>
            <option value="agent">agent</option>
          </select>
        </label>

        <label className="hooks-panel__form-label">
          命令
          <textarea className="hooks-panel__form-textarea" value={hook.handler.command} placeholder="命令或提示词" rows={3} readOnly />
        </label>

        <label className="hooks-panel__form-label">
          超时
          <input
            className="hooks-panel__form-input"
            value={hook.handler.timeout != null ? String(hook.handler.timeout) : ''}
            placeholder="ms"
            type="number"
            readOnly
          />
        </label>

        <label className="hooks-panel__form-label">
          状态消息
          <input className="hooks-panel__form-input" value={hook.handler.statusMessage ?? ''} placeholder="执行时显示的消息" readOnly />
        </label>

        <div className="hooks-panel__form-checks">
          <label className="hooks-panel__form-check">
            <input type="checkbox" checked={hook.handler.async ?? false} readOnly />
            <span>异步执行</span>
          </label>
          <label className="hooks-panel__form-check">
            <input type="checkbox" checked={hook.handler.once ?? false} readOnly />
            <span>仅执行一次</span>
          </label>
        </div>
      </div>

      <div className="hooks-panel__form-actions">
        <button className="hooks-panel__btn hooks-panel__btn--primary">保存</button>
        <button className="hooks-panel__btn">取消</button>
      </div>
    </div>
  );
}

export function HooksPanelScreen({ fx }: { fx: any }): JSX.Element {
  const hk: HooksPayload = fx.hooks ?? { settings: { hooks: {} }, selectedId: null };
  const homePath: string = fx.homePath ?? '/Users/rl';
  const configPath = `${homePath}/.claude/settings.json`;
  const hooks = flattenHooks(hk.settings?.hooks ?? {});
  const grouped = groupByEvent(hooks);
  const selected = hooks.find((h) => h.id === hk.selectedId) ?? null;

  return (
    <div className="hooks-panel-overlay">
      <div className="hooks-panel">
        {/* 左：hook 列表（按事件分组） */}
        <div className="hooks-panel__left" style={{ width: 300 }}>
          <div className="hooks-panel__header">
            <span>Hooks</span>
            <span className="hooks-panel__count">{hooks.length}</span>
            <button className="hooks-panel__add-btn">+</button>
          </div>
          <div className="hooks-panel__list">
            {hk.loading ? (
              <div className="hooks-panel__loading">加载中...</div>
            ) : hooks.length === 0 ? (
              <div className="hooks-panel__empty">暂无 Hook 配置</div>
            ) : (
              Object.entries(grouped).map(([event, entries]) => (
                <div key={event} className="hooks-panel__event-group">
                  <div className="hooks-panel__event-label">{event}</div>
                  {entries.map((h) => (
                    <div
                      key={h.id}
                      className={`hooks-panel__item${selected?.id === h.id ? ' hooks-panel__item--active' : ''}`}
                    >
                      <div className="hooks-panel__item-info">
                        {h.matcher && <span className="hooks-panel__item-matcher">{h.matcher}</span>}
                        <span className="hooks-panel__item-command">{h.handler.command}</span>
                      </div>
                      <div className="hooks-panel__item-badges">
                        <HandlerBadge type={h.handler.type} />
                        <ScopeBadge />
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="hooks-panel__resize-handle" />

        {/* 右：详情 / 表单 */}
        <div className="hooks-panel__right">
          {selected && hk.form ? (
            <HookForm hook={selected} />
          ) : selected ? (
            <HookDetail hook={selected} configPath={configPath} />
          ) : (
            <div className="hooks-panel__placeholder">
              <span>选择一个 Hook 查看详情</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
