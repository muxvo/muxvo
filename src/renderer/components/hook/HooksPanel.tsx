/**
 * HooksPanel — Two-column Hook management panel
 *
 * Left: hook list grouped by event name
 * Right: detail view / edit form / add form
 *
 * Only Global scope hooks can be added / edited / deleted.
 * Escape: edit/add mode → back to view, view mode → close panel.
 */

import { useState, useEffect, useCallback } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useHookConfig } from '@/renderer/hooks/useHookConfig';
import { useI18n } from '@/renderer/i18n';
import type { HookEntry, HookEventName, HookHandler, HookHandlerType } from '@/shared/types/hook.types';
import './HooksPanel.css';

type Mode = 'view' | 'edit' | 'add';

const SCOPE_LABELS: Record<string, { label: string; cls: string }> = {
  global: { label: 'Global', cls: 'hooks-panel__scope--global' },
  project: { label: 'Project', cls: 'hooks-panel__scope--project' },
  'project-local': { label: 'Local', cls: 'hooks-panel__scope--local' },
};

const HANDLER_TYPES: HookHandlerType[] = ['command', 'prompt', 'agent'];

const ALL_EVENTS: HookEventName[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop',
  'SubagentStart', 'SubagentStop', 'TeammateIdle', 'TaskCompleted',
  'Notification', 'ConfigChange', 'PreCompact',
];

export function HooksPanel(): JSX.Element {
  const { dispatch } = usePanelContext();
  const { t } = useI18n();
  const { hooks, loading, add, update, remove, reload } = useHookConfig();

  const [selected, setSelected] = useState<HookEntry | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [leftWidth, setLeftWidth] = useState(300);

  // Form state
  const [formEvent, setFormEvent] = useState<HookEventName>('PreToolUse');
  const [formMatcher, setFormMatcher] = useState('');
  const [formHandlerType, setFormHandlerType] = useState<HookHandlerType>('command');
  const [formCommand, setFormCommand] = useState('');
  const [formTimeout, setFormTimeout] = useState('');
  const [formAsync, setFormAsync] = useState(false);
  const [formStatusMessage, setFormStatusMessage] = useState('');
  const [formOnce, setFormOnce] = useState(false);

  // Populate form
  useEffect(() => {
    if (mode === 'edit' && selected) {
      setFormEvent(selected.event);
      setFormMatcher(selected.matcher || '');
      setFormHandlerType(selected.handler.type);
      setFormCommand(selected.handler.command);
      setFormTimeout(selected.handler.timeout != null ? String(selected.handler.timeout) : '');
      setFormAsync(selected.handler.async ?? false);
      setFormStatusMessage(selected.handler.statusMessage || '');
      setFormOnce(selected.handler.once ?? false);
    }
    if (mode === 'add') {
      setFormEvent('PreToolUse');
      setFormMatcher('');
      setFormHandlerType('command');
      setFormCommand('');
      setFormTimeout('');
      setFormAsync(false);
      setFormStatusMessage('');
      setFormOnce(false);
    }
  }, [mode, selected]);

  // Keyboard
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode === 'edit' || mode === 'add') {
          setMode('view');
        } else {
          dispatch({ type: 'CLOSE_HOOKS_PANEL' });
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, dispatch]);

  const handleSave = useCallback(async () => {
    const handler: HookHandler = {
      type: formHandlerType,
      command: formCommand.trim(),
    };
    if (formTimeout.trim()) handler.timeout = parseInt(formTimeout, 10);
    if (formAsync) handler.async = true;
    if (formStatusMessage.trim()) handler.statusMessage = formStatusMessage.trim();
    if (formOnce) handler.once = true;

    if (!handler.command) return;

    const matcher = formMatcher.trim() || undefined;

    try {
      if (mode === 'add') {
        await add(formEvent, matcher, handler);
      } else if (mode === 'edit' && selected) {
        await update(selected.id, formEvent, matcher, handler);
      }
      setMode('view');
      setSelected(null);
    } catch (err) {
      console.error('Save hook failed:', err);
    }
  }, [mode, selected, formEvent, formMatcher, formHandlerType, formCommand, formTimeout, formAsync, formStatusMessage, formOnce, add, update]);

  const handleDelete = useCallback(async () => {
    if (!selected || selected.scope !== 'global') return;
    try {
      await remove(selected.id);
      setSelected(null);
      setMode('view');
    } catch (err) {
      console.error('Delete hook failed:', err);
    }
  }, [selected, remove]);

  // Resize
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setLeftWidth(Math.min(500, Math.max(200, startWidth + delta)));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [leftWidth],
  );

  // Group hooks by event
  const grouped = groupByEvent(hooks);

  return (
    <div className="hooks-panel">
      {/* Left: hook list */}
      <div className="hooks-panel__left" style={{ width: leftWidth }}>
        <div className="hooks-panel__header">
          <span>{t('hooks.title')}</span>
          <span className="hooks-panel__count">{hooks.length}</span>
          <button
            className="hooks-panel__add-btn"
            onClick={() => { setSelected(null); setMode('add'); }}
            title={t('hooks.addHook')}
          >
            +
          </button>
        </div>
        <div className="hooks-panel__list">
          {loading ? (
            <div className="hooks-panel__loading">{t('hooks.loading')}</div>
          ) : hooks.length === 0 ? (
            <div className="hooks-panel__empty">{t('hooks.noHooks')}</div>
          ) : (
            Object.entries(grouped).map(([event, entries]) => (
              <div key={event} className="hooks-panel__event-group">
                <div className="hooks-panel__event-label">{event}</div>
                {entries.map((h) => (
                  <div
                    key={h.id}
                    className={`hooks-panel__item${selected?.id === h.id ? ' hooks-panel__item--active' : ''}`}
                    onClick={() => { setSelected(h); setMode('view'); }}
                  >
                    <div className="hooks-panel__item-info">
                      {h.matcher && (
                        <span className="hooks-panel__item-matcher">{h.matcher}</span>
                      )}
                      <span className="hooks-panel__item-command">{h.handler.command}</span>
                    </div>
                    <div className="hooks-panel__item-badges">
                      <span className={`hooks-panel__handler-badge hooks-panel__handler-badge--${h.handler.type}`}>
                        {h.handler.type}
                      </span>
                      <span className={`hooks-panel__scope-badge ${SCOPE_LABELS[h.scope].cls}`}>
                        {SCOPE_LABELS[h.scope].label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="hooks-panel__resize-handle" onMouseDown={handleResizeStart} />

      {/* Right: detail / form */}
      <div className="hooks-panel__right">
        {mode === 'view' && selected ? (
          <HookDetail
            hook={selected}
            onEdit={() => setMode('edit')}
            onDelete={handleDelete}
            t={t}
          />
        ) : mode === 'edit' || mode === 'add' ? (
          <HookForm
            mode={mode}
            formEvent={formEvent}
            formMatcher={formMatcher}
            formHandlerType={formHandlerType}
            formCommand={formCommand}
            formTimeout={formTimeout}
            formAsync={formAsync}
            formStatusMessage={formStatusMessage}
            formOnce={formOnce}
            onEventChange={setFormEvent}
            onMatcherChange={setFormMatcher}
            onHandlerTypeChange={setFormHandlerType}
            onCommandChange={setFormCommand}
            onTimeoutChange={setFormTimeout}
            onAsyncChange={setFormAsync}
            onStatusMessageChange={setFormStatusMessage}
            onOnceChange={setFormOnce}
            onSave={handleSave}
            onCancel={() => setMode('view')}
            t={t}
          />
        ) : (
          <div className="hooks-panel__placeholder">
            <span>{t('hooks.selectHook')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function HookDetail({
  hook,
  onEdit,
  onDelete,
  t,
}: {
  hook: HookEntry;
  onEdit: () => void;
  onDelete: () => void;
  t: (...args: any[]) => string;
}): JSX.Element {
  const isGlobal = hook.scope === 'global';

  return (
    <div className="hooks-panel__detail">
      <div className="hooks-panel__detail-header">
        <span className="hooks-panel__detail-event">{hook.event}</span>
        <span className={`hooks-panel__handler-badge hooks-panel__handler-badge--${hook.handler.type}`}>
          {hook.handler.type}
        </span>
        <span className={`hooks-panel__scope-badge ${SCOPE_LABELS[hook.scope].cls}`}>
          {SCOPE_LABELS[hook.scope].label}
        </span>
      </div>

      <div className="hooks-panel__detail-body">
        {hook.matcher && (
          <DetailRow label={t('hooks.matcher')} value={hook.matcher} mono />
        )}
        <DetailRow label={t('hooks.command')} value={hook.handler.command} mono />
        <DetailRow label={t('hooks.handlerType')} value={hook.handler.type} />
        {hook.handler.timeout != null && (
          <DetailRow label={t('hooks.timeout')} value={`${hook.handler.timeout}ms`} />
        )}
        {hook.handler.async && (
          <DetailRow label={t('hooks.async')} value="true" />
        )}
        {hook.handler.statusMessage && (
          <DetailRow label={t('hooks.statusMessage')} value={hook.handler.statusMessage} />
        )}
        {hook.handler.once && (
          <DetailRow label={t('hooks.once')} value="true" />
        )}
        <DetailRow label={t('hooks.configPath')} value={hook.configPath} mono />
      </div>

      {isGlobal && (
        <div className="hooks-panel__detail-actions">
          <button className="hooks-panel__btn hooks-panel__btn--primary" onClick={onEdit}>
            {t('hooks.edit')}
          </button>
          <button className="hooks-panel__btn hooks-panel__btn--danger" onClick={onDelete}>
            {t('hooks.delete')}
          </button>
        </div>
      )}

      {!isGlobal && (
        <div className="hooks-panel__detail-hint">{t('hooks.readOnlyHint')}</div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="hooks-panel__detail-row">
      <span className="hooks-panel__detail-label">{label}</span>
      <span className={`hooks-panel__detail-value${mono ? ' hooks-panel__detail-value--mono' : ''}`}>{value}</span>
    </div>
  );
}

function HookForm({
  mode,
  formEvent,
  formMatcher,
  formHandlerType,
  formCommand,
  formTimeout,
  formAsync,
  formStatusMessage,
  formOnce,
  onEventChange,
  onMatcherChange,
  onHandlerTypeChange,
  onCommandChange,
  onTimeoutChange,
  onAsyncChange,
  onStatusMessageChange,
  onOnceChange,
  onSave,
  onCancel,
  t,
}: {
  mode: Mode;
  formEvent: HookEventName;
  formMatcher: string;
  formHandlerType: HookHandlerType;
  formCommand: string;
  formTimeout: string;
  formAsync: boolean;
  formStatusMessage: string;
  formOnce: boolean;
  onEventChange: (v: HookEventName) => void;
  onMatcherChange: (v: string) => void;
  onHandlerTypeChange: (v: HookHandlerType) => void;
  onCommandChange: (v: string) => void;
  onTimeoutChange: (v: string) => void;
  onAsyncChange: (v: boolean) => void;
  onStatusMessageChange: (v: string) => void;
  onOnceChange: (v: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  t: (...args: any[]) => string;
}): JSX.Element {
  return (
    <div className="hooks-panel__form">
      <div className="hooks-panel__form-header">
        {mode === 'add' ? t('hooks.addHook') : t('hooks.editHook')}
      </div>

      <div className="hooks-panel__form-body">
        <label className="hooks-panel__form-label">
          {t('hooks.event')}
          <select
            className="hooks-panel__form-select"
            value={formEvent}
            onChange={(e) => onEventChange(e.target.value as HookEventName)}
          >
            {ALL_EVENTS.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
            ))}
          </select>
        </label>

        <label className="hooks-panel__form-label">
          {t('hooks.matcher')}
          <input
            className="hooks-panel__form-input"
            value={formMatcher}
            onChange={(e) => onMatcherChange(e.target.value)}
            placeholder={t('hooks.matcherPlaceholder')}
          />
        </label>

        <label className="hooks-panel__form-label">
          {t('hooks.handlerType')}
          <select
            className="hooks-panel__form-select"
            value={formHandlerType}
            onChange={(e) => onHandlerTypeChange(e.target.value as HookHandlerType)}
          >
            {HANDLER_TYPES.map((ht) => (
              <option key={ht} value={ht}>{ht}</option>
            ))}
          </select>
        </label>

        <label className="hooks-panel__form-label">
          {t('hooks.command')}
          <textarea
            className="hooks-panel__form-textarea"
            value={formCommand}
            onChange={(e) => onCommandChange(e.target.value)}
            placeholder={t('hooks.commandPlaceholder')}
            rows={3}
          />
        </label>

        <label className="hooks-panel__form-label">
          {t('hooks.timeout')}
          <input
            className="hooks-panel__form-input"
            value={formTimeout}
            onChange={(e) => onTimeoutChange(e.target.value)}
            placeholder="ms"
            type="number"
          />
        </label>

        <label className="hooks-panel__form-label">
          {t('hooks.statusMessage')}
          <input
            className="hooks-panel__form-input"
            value={formStatusMessage}
            onChange={(e) => onStatusMessageChange(e.target.value)}
            placeholder={t('hooks.statusMessagePlaceholder')}
          />
        </label>

        <div className="hooks-panel__form-checks">
          <label className="hooks-panel__form-check">
            <input type="checkbox" checked={formAsync} onChange={(e) => onAsyncChange(e.target.checked)} />
            <span>{t('hooks.async')}</span>
          </label>
          <label className="hooks-panel__form-check">
            <input type="checkbox" checked={formOnce} onChange={(e) => onOnceChange(e.target.checked)} />
            <span>{t('hooks.once')}</span>
          </label>
        </div>
      </div>

      <div className="hooks-panel__form-actions">
        <button className="hooks-panel__btn hooks-panel__btn--primary" onClick={onSave}>
          {t('hooks.save')}
        </button>
        <button className="hooks-panel__btn" onClick={onCancel}>
          {t('hooks.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──

function groupByEvent(hooks: HookEntry[]): Record<string, HookEntry[]> {
  const result: Record<string, HookEntry[]> = {};
  for (const h of hooks) {
    if (!result[h.event]) result[h.event] = [];
    result[h.event].push(h);
  }
  return result;
}
