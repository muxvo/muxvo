/**
 * Hooks 面板 live 包装（hooks-panel.md）：golden HooksPanelScreen 纯 props 复用（列表 + detail 只读），
 * 编辑走 live 表单覆盖层（HookFormLive，复用 .hooks-panel__form-* 类）。
 *
 * 单一数据源：getSettings → parseHooksSettings（损坏→{hooks:{}}，CONFIG_L1_18）→ 展平列表。
 * 保存：applyHookEdit（就地/移组）→ serializeSettings → saveSettings（CONFIG_L1_13）。
 * detail→编辑→保存→回 detail 两级（detailReducer，CONFIG_L1_27）。Esc 两级 LiveChrome 路由归 A2。
 */
import { useCallback, useEffect, useReducer, useState } from 'react';
import type { MouseEvent } from 'react';
import { useConfigApi } from '../../../config/ConfigContext';
import { registerLivePanel, type LivePanelProps } from '../../live/panelRegistry';
import { HooksPanelScreen } from '../HooksPanelScreen';
import { DETAIL_INITIAL, detailReducer } from './panelState';
import {
  applyHookEdit,
  flattenHooks,
  parseHooksSettings,
  parseHookId,
  serializeSettings,
  type HookEntry,
  type HookHandler,
  type HooksSettings,
} from './hooksSettings';
import { useConfigData } from './shared';
import './panels-live.css';

const ALL_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop',
  'SubagentStart', 'SubagentStop', 'TeammateIdle', 'TaskCompleted',
  'Notification', 'ConfigChange', 'PreCompact',
];

function HookFormLive({
  entry,
  onSave,
  onCancel,
}: {
  entry: HookEntry;
  onSave: (next: { event: string; matcher?: string; handler: HookHandler }) => void;
  onCancel: () => void;
}): JSX.Element {
  const [event, setEvent] = useState(entry.event);
  const [matcher, setMatcher] = useState(entry.matcher ?? '');
  const [type, setType] = useState<HookHandler['type']>(entry.handler.type);
  const [command, setCommand] = useState(entry.handler.command);
  const [timeout, setTimeout] = useState(entry.handler.timeout != null ? String(entry.handler.timeout) : '');
  const [statusMessage, setStatusMessage] = useState(entry.handler.statusMessage ?? '');
  const [isAsync, setIsAsync] = useState(entry.handler.async ?? false);
  const [once, setOnce] = useState(entry.handler.once ?? false);

  const submit = (): void => {
    const handler: HookHandler = { type, command };
    if (timeout.trim() && Number.isFinite(Number(timeout))) handler.timeout = Number(timeout);
    if (statusMessage.trim()) handler.statusMessage = statusMessage;
    if (isAsync) handler.async = true;
    if (once) handler.once = true;
    onSave({ event, matcher: matcher.trim() ? matcher : undefined, handler });
  };

  return (
    <div className="panel-form-live-cover">
      <div className="hooks-panel__form">
        <div className="hooks-panel__form-header">编辑 Hook</div>
        <div className="hooks-panel__form-body">
          <label className="hooks-panel__form-label">
            事件
            <select className="hooks-panel__form-select" value={event} onChange={(e) => setEvent(e.target.value)}>
              {ALL_EVENTS.map((ev) => (
                <option key={ev} value={ev}>{ev}</option>
              ))}
            </select>
          </label>
          <label className="hooks-panel__form-label">
            匹配器
            <input className="hooks-panel__form-input" value={matcher} placeholder="工具名称或正则（可选）" onChange={(e) => setMatcher(e.target.value)} />
          </label>
          <label className="hooks-panel__form-label">
            处理类型
            <select className="hooks-panel__form-select" value={type} onChange={(e) => setType(e.target.value as HookHandler['type'])}>
              <option value="command">command</option>
              <option value="prompt">prompt</option>
              <option value="agent">agent</option>
            </select>
          </label>
          <label className="hooks-panel__form-label">
            命令
            <textarea className="hooks-panel__form-textarea" value={command} placeholder="命令或提示词" rows={3} onChange={(e) => setCommand(e.target.value)} />
          </label>
          <label className="hooks-panel__form-label">
            超时
            <input className="hooks-panel__form-input" value={timeout} placeholder="ms" type="number" onChange={(e) => setTimeout(e.target.value)} />
          </label>
          <label className="hooks-panel__form-label">
            状态消息
            <input className="hooks-panel__form-input" value={statusMessage} placeholder="执行时显示的消息" onChange={(e) => setStatusMessage(e.target.value)} />
          </label>
          <div className="hooks-panel__form-checks">
            <label className="hooks-panel__form-check">
              <input type="checkbox" checked={isAsync} onChange={(e) => setIsAsync(e.target.checked)} />
              <span>异步执行</span>
            </label>
            <label className="hooks-panel__form-check">
              <input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />
              <span>仅执行一次</span>
            </label>
          </div>
        </div>
        <div className="hooks-panel__form-actions">
          <button className="hooks-panel__btn hooks-panel__btn--primary" onClick={submit}>
            保存
          </button>
          <button className="hooks-panel__btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// 两级 Esc（CONFIG_L1_15）：form 时 Esc→cancel 回 detail（capture 拦截）；detail 时 Esc 冒泡→LiveChrome 关面板。
export function HooksPanelLive({}: LivePanelProps): JSX.Element {
  const api = useConfigApi();
  const [{ settings }] = useConfigData<{ settings: HooksSettings }>(
    api,
    async (a) => {
      const r = await a.request({ kind: 'getSettings' });
      return { settings: r.kind === 'settingsJson' ? parseHooksSettings(r.json) : { hooks: {} } };
    },
    { settings: { hooks: {} } },
  );

  const entries = flattenHooks(settings.hooks);
  const [detail, dispatch] = useReducer(detailReducer, DETAIL_INITIAL);
  const selectedEntry = entries.find((e) => e.id === detail.selectedId) ?? null;
  const [wrap, setWrap] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && detail.form) {
        e.preventDefault();
        e.stopPropagation();
        dispatch({ type: 'cancel' });
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [detail.form]);

  const onClick = useCallback(
    (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      // form 覆盖层内的点击由 HookFormLive 自身 handler 处理（其 保存/取消 亦 __btn--primary），委托跳过。
      if (target.closest('.panel-form-live-cover')) return;
      const item = target.closest('.hooks-panel__item');
      if (item && wrap) {
        const all = Array.from(wrap.querySelectorAll('.hooks-panel__item'));
        const idx = all.indexOf(item);
        if (idx >= 0 && entries[idx]) dispatch({ type: 'select', id: entries[idx].id });
        return;
      }
      if (target.closest('.hooks-panel__btn--danger')) {
        if (selectedEntry && api) {
          const parsed = parseHookId(selectedEntry.id);
          if (parsed) {
            const next = JSON.parse(JSON.stringify(settings)) as HooksSettings;
            const groups = next.hooks[parsed.event];
            if (Array.isArray(groups) && groups[parsed.gi]?.hooks) {
              groups[parsed.gi].hooks.splice(parsed.hi, 1);
              if (groups[parsed.gi].hooks.length === 0) groups.splice(parsed.gi, 1);
              if (groups.length === 0) delete next.hooks[parsed.event];
            }
            void api.request({ kind: 'saveSettings', json: serializeSettings(next) }).catch(() => {});
          }
        }
        dispatch({ type: 'close' });
        return;
      }
      if (target.closest('.hooks-panel__btn--primary')) {
        dispatch({ type: 'edit' });
      }
    },
    [api, entries, selectedEntry, settings, wrap],
  );

  const onSave = useCallback(
    (next: { event: string; matcher?: string; handler: HookHandler }): void => {
      if (selectedEntry && api) {
        const updated = applyHookEdit(settings, selectedEntry.id, next);
        void api.request({ kind: 'saveSettings', json: serializeSettings(updated) }).catch(() => {});
      }
      dispatch({ type: 'save' });
    },
    [api, selectedEntry, settings],
  );

  return (
    <div className="hooks-panel-live" ref={setWrap} onClick={onClick}>
      <HooksPanelScreen fx={{ screen: 'hooks-panel', theme: 'dark', hooks: { settings, selectedId: detail.selectedId, form: false } }} />
      {selectedEntry && detail.form && <HookFormLive entry={selectedEntry} onSave={onSave} onCancel={() => dispatch({ type: 'cancel' })} />}
    </div>
  );
}

registerLivePanel('hooks', HooksPanelLive);
