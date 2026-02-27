/**
 * McpPanel — Two-column MCP server management panel
 *
 * Left: server list grouped by scope (Global / Project / Desktop)
 * Right: detail view / edit form / add form
 *
 * Only Global scope servers can be added / edited / deleted.
 * Escape: edit/add mode → back to view, view mode → close panel.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useMcpConfig } from '@/renderer/hooks/useMcpConfig';
import { useI18n } from '@/renderer/i18n';
import type { McpServerConfig, McpServerType } from '@/shared/types/mcp.types';
import './McpPanel.css';

type Mode = 'view' | 'edit' | 'add';

/** Scope display config */
const SCOPE_LABELS: Record<string, { label: string; cls: string }> = {
  global: { label: 'CC', cls: 'mcp-panel__scope--cc' },
  project: { label: 'Project', cls: 'mcp-panel__scope--project' },
  desktop: { label: 'Desktop', cls: 'mcp-panel__scope--desktop' },
  codex: { label: 'Codex', cls: 'mcp-panel__scope--codex' },
  gemini: { label: 'Gemini', cls: 'mcp-panel__scope--gemini' },
  'codex-project': { label: 'Codex Project', cls: 'mcp-panel__scope--codex' },
  'gemini-project': { label: 'Gemini Project', cls: 'mcp-panel__scope--gemini' },
};

const TYPE_OPTIONS: McpServerType[] = ['stdio', 'http', 'sse'];

export function McpPanel(): JSX.Element {
  const { dispatch } = usePanelContext();
  const { t } = useI18n();
  const { servers, loading, add, update, remove, reload } = useMcpConfig();

  const [selected, setSelected] = useState<McpServerConfig | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [leftWidth, setLeftWidth] = useState(280);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<McpServerType>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formHeaders, setFormHeaders] = useState('');
  const [formEnv, setFormEnv] = useState('');

  // Populate form when entering edit mode
  useEffect(() => {
    if (mode === 'edit' && selected) {
      setFormName(selected.name);
      setFormType(selected.type);
      setFormCommand(selected.command || '');
      setFormArgs(selected.args?.join(' ') || '');
      setFormUrl(selected.url || '');
      setFormHeaders(selected.headers ? JSON.stringify(selected.headers, null, 2) : '');
      setFormEnv(selected.env ? JSON.stringify(selected.env, null, 2) : '');
    }
    if (mode === 'add') {
      setFormName('');
      setFormType('stdio');
      setFormCommand('');
      setFormArgs('');
      setFormUrl('');
      setFormHeaders('');
      setFormEnv('');
    }
  }, [mode, selected]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (mode === 'edit' || mode === 'add') {
          setMode('view');
        } else {
          dispatch({ type: 'CLOSE_MCP_PANEL' });
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, dispatch]);

  const handleSave = useCallback(async () => {
    const serverData: Omit<McpServerConfig, 'scope' | 'configPath'> = {
      name: formName.trim(),
      type: formType,
      command: formType === 'stdio' ? formCommand.trim() || undefined : undefined,
      args: formType === 'stdio' && formArgs.trim() ? formArgs.trim().split(/\s+/) : undefined,
      url: formType !== 'stdio' ? formUrl.trim() || undefined : undefined,
      headers: formType !== 'stdio' && formHeaders.trim() ? safeParseJson(formHeaders) : undefined,
      env: formEnv.trim() ? safeParseJson(formEnv) : undefined,
    };

    if (!serverData.name) return;

    try {
      if (mode === 'add') {
        await add(serverData);
      } else if (mode === 'edit' && selected) {
        await update(selected.name, serverData);
      }
      setMode('view');
      // Select the newly saved server
      setSelected({ ...serverData, scope: 'global', configPath: '' });
    } catch (err) {
      console.error('Save MCP server failed:', err);
    }
  }, [mode, selected, formName, formType, formCommand, formArgs, formUrl, formHeaders, formEnv, add, update]);

  const handleDelete = useCallback(async () => {
    if (!selected || selected.scope !== 'global') return;
    try {
      await remove(selected.name);
      setSelected(null);
      setMode('view');
    } catch (err) {
      console.error('Delete MCP server failed:', err);
    }
  }, [selected, remove]);

  // Resize handle
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

  // Group servers by level (system vs project)
  const groups = useMemo(() => groupByLevel(servers), [servers]);

  return (
    <div className="mcp-panel">
      {/* Left: server list */}
      <div className="mcp-panel__left" style={{ width: leftWidth }}>
        <div className="mcp-panel__header">
          <span>{t('mcp.title')}</span>
          <span className="mcp-panel__count">{servers.length}</span>
          <button
            className="mcp-panel__add-btn"
            onClick={() => { setSelected(null); setMode('add'); }}
            title={t('mcp.addServer')}
          >
            +
          </button>
        </div>
        <div className="mcp-panel__list">
          {loading ? (
            <div className="mcp-panel__loading">{t('mcp.loading')}</div>
          ) : servers.length === 0 ? (
            <div className="mcp-panel__empty">{t('mcp.noServers')}</div>
          ) : (
            groups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              return (
                <div key={group.key} className="mcp-panel__group">
                  <div
                    className="mcp-panel__group-header"
                    onClick={() => toggleGroup(group.key)}
                  >
                    <span className={`mcp-panel__group-arrow${isCollapsed ? '' : ' mcp-panel__group-arrow--open'}`}>
                      &#9654;
                    </span>
                    <span className="mcp-panel__group-label">{group.label}</span>
                    <span className="mcp-panel__group-count">{group.servers.length}</span>
                  </div>
                  {!isCollapsed && (
                    <div className="mcp-panel__group-items">
                      {group.servers.map((s) => (
                        <div
                          key={`${s.scope}:${s.name}`}
                          className={`mcp-panel__item${selected?.name === s.name && selected?.scope === s.scope ? ' mcp-panel__item--active' : ''}`}
                          onClick={() => { setSelected(s); setMode('view'); }}
                        >
                          <div className="mcp-panel__item-name">{s.name}</div>
                          <span className={`mcp-panel__scope-badge ${(SCOPE_LABELS[s.scope] || { cls: '' }).cls}`}>
                            {(SCOPE_LABELS[s.scope] || { label: s.scope }).label}
                          </span>
                          <span className={`mcp-panel__type-badge mcp-panel__type-badge--${s.type}`}>
                            {s.type.toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mcp-panel__resize-handle" onMouseDown={handleResizeStart} />

      {/* Right: detail / form */}
      <div className="mcp-panel__right">
        {mode === 'view' && selected ? (
          <ServerDetail
            server={selected}
            onEdit={() => setMode('edit')}
            onDelete={handleDelete}
            t={t}
          />
        ) : mode === 'edit' || mode === 'add' ? (
          <ServerForm
            mode={mode}
            formName={formName}
            formType={formType}
            formCommand={formCommand}
            formArgs={formArgs}
            formUrl={formUrl}
            formHeaders={formHeaders}
            formEnv={formEnv}
            onNameChange={setFormName}
            onTypeChange={setFormType}
            onCommandChange={setFormCommand}
            onArgsChange={setFormArgs}
            onUrlChange={setFormUrl}
            onHeadersChange={setFormHeaders}
            onEnvChange={setFormEnv}
            onSave={handleSave}
            onCancel={() => setMode('view')}
            t={t}
          />
        ) : (
          <div className="mcp-panel__placeholder">
            <span>{t('mcp.selectServer')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function ServerDetail({
  server,
  onEdit,
  onDelete,
  t,
}: {
  server: McpServerConfig;
  onEdit: () => void;
  onDelete: () => void;
  t: (...args: any[]) => string;
}): JSX.Element {
  const isGlobal = server.scope === 'global';

  return (
    <div className="mcp-panel__detail">
      <div className="mcp-panel__detail-header">
        <h3 className="mcp-panel__detail-name">{server.name}</h3>
        <span className={`mcp-panel__scope-badge ${(SCOPE_LABELS[server.scope] || { cls: '' }).cls}`}>
          {(SCOPE_LABELS[server.scope] || { label: server.scope }).label}
        </span>
        <span className={`mcp-panel__type-badge mcp-panel__type-badge--${server.type}`}>
          {server.type.toUpperCase()}
        </span>
      </div>

      <div className="mcp-panel__detail-body">
        {server.type === 'stdio' && (
          <>
            <DetailRow label={t('mcp.command')} value={server.command || '-'} mono />
            <DetailRow label={t('mcp.args')} value={server.args?.join(' ') || '-'} mono />
          </>
        )}
        {server.type !== 'stdio' && (
          <>
            <DetailRow label={t('mcp.url')} value={server.url || '-'} mono />
            {server.headers && Object.keys(server.headers).length > 0 && (
              <DetailRow label={t('mcp.headers')} value={JSON.stringify(server.headers, null, 2)} mono pre />
            )}
          </>
        )}
        {server.env && Object.keys(server.env).length > 0 && (
          <DetailRow label={t('mcp.env')} value={JSON.stringify(server.env, null, 2)} mono pre />
        )}
        {server.configPath && (
          <DetailRow label={t('mcp.configPath')} value={server.configPath} mono />
        )}
      </div>

      {isGlobal && (
        <div className="mcp-panel__detail-actions">
          <button className="mcp-panel__btn mcp-panel__btn--primary" onClick={onEdit}>
            {t('mcp.edit')}
          </button>
          <button className="mcp-panel__btn mcp-panel__btn--danger" onClick={onDelete}>
            {t('mcp.delete')}
          </button>
        </div>
      )}

      {!isGlobal && (
        <div className="mcp-panel__detail-hint">{t('mcp.readOnlyHint')}</div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  pre,
}: {
  label: string;
  value: string;
  mono?: boolean;
  pre?: boolean;
}): JSX.Element {
  return (
    <div className="mcp-panel__detail-row">
      <span className="mcp-panel__detail-label">{label}</span>
      {pre ? (
        <pre className={`mcp-panel__detail-value${mono ? ' mcp-panel__detail-value--mono' : ''}`}>{value}</pre>
      ) : (
        <span className={`mcp-panel__detail-value${mono ? ' mcp-panel__detail-value--mono' : ''}`}>{value}</span>
      )}
    </div>
  );
}

function ServerForm({
  mode,
  formName,
  formType,
  formCommand,
  formArgs,
  formUrl,
  formHeaders,
  formEnv,
  onNameChange,
  onTypeChange,
  onCommandChange,
  onArgsChange,
  onUrlChange,
  onHeadersChange,
  onEnvChange,
  onSave,
  onCancel,
  t,
}: {
  mode: Mode;
  formName: string;
  formType: McpServerType;
  formCommand: string;
  formArgs: string;
  formUrl: string;
  formHeaders: string;
  formEnv: string;
  onNameChange: (v: string) => void;
  onTypeChange: (v: McpServerType) => void;
  onCommandChange: (v: string) => void;
  onArgsChange: (v: string) => void;
  onUrlChange: (v: string) => void;
  onHeadersChange: (v: string) => void;
  onEnvChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  t: (...args: any[]) => string;
}): JSX.Element {
  return (
    <div className="mcp-panel__form">
      <div className="mcp-panel__form-header">
        {mode === 'add' ? t('mcp.addServer') : t('mcp.editServer')}
      </div>

      <div className="mcp-panel__form-body">
        <label className="mcp-panel__form-label">
          {t('mcp.name')}
          <input
            className="mcp-panel__form-input"
            value={formName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="server-name"
          />
        </label>

        <label className="mcp-panel__form-label">
          {t('mcp.type')}
          <select
            className="mcp-panel__form-select"
            value={formType}
            onChange={(e) => onTypeChange(e.target.value as McpServerType)}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t.toUpperCase()}</option>
            ))}
          </select>
        </label>

        {formType === 'stdio' ? (
          <>
            <label className="mcp-panel__form-label">
              {t('mcp.command')}
              <input
                className="mcp-panel__form-input"
                value={formCommand}
                onChange={(e) => onCommandChange(e.target.value)}
                placeholder="npx @modelcontextprotocol/server-xxx"
              />
            </label>
            <label className="mcp-panel__form-label">
              {t('mcp.args')}
              <input
                className="mcp-panel__form-input"
                value={formArgs}
                onChange={(e) => onArgsChange(e.target.value)}
                placeholder={t('mcp.argsPlaceholder')}
              />
            </label>
          </>
        ) : (
          <>
            <label className="mcp-panel__form-label">
              {t('mcp.url')}
              <input
                className="mcp-panel__form-input"
                value={formUrl}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://..."
              />
            </label>
            <label className="mcp-panel__form-label">
              {t('mcp.headers')}
              <textarea
                className="mcp-panel__form-textarea"
                value={formHeaders}
                onChange={(e) => onHeadersChange(e.target.value)}
                placeholder='{"Authorization": "Bearer ..."}'
                rows={3}
              />
            </label>
          </>
        )}

        <label className="mcp-panel__form-label">
          {t('mcp.env')}
          <textarea
            className="mcp-panel__form-textarea"
            value={formEnv}
            onChange={(e) => onEnvChange(e.target.value)}
            placeholder='{"API_KEY": "..."}'
            rows={3}
          />
        </label>
      </div>

      <div className="mcp-panel__form-actions">
        <button className="mcp-panel__btn mcp-panel__btn--primary" onClick={onSave}>
          {t('mcp.save')}
        </button>
        <button className="mcp-panel__btn" onClick={onCancel}>
          {t('mcp.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──

const PROJECT_SCOPES = new Set(['project', 'codex-project', 'gemini-project']);

function groupByLevel(servers: McpServerConfig[]): { key: string; label: string; servers: McpServerConfig[] }[] {
  const system: McpServerConfig[] = [];
  const project: McpServerConfig[] = [];
  for (const s of servers) {
    if (PROJECT_SCOPES.has(s.scope)) {
      project.push(s);
    } else {
      system.push(s);
    }
  }
  const groups: { key: string; label: string; servers: McpServerConfig[] }[] = [];
  if (system.length) groups.push({ key: 'system', label: '系统', servers: system });
  if (project.length) groups.push({ key: 'project', label: '项目', servers: project });
  return groups;
}

function safeParseJson(str: string): Record<string, string> | undefined {
  try {
    const obj = JSON.parse(str);
    return typeof obj === 'object' && obj !== null ? obj : undefined;
  } catch {
    return undefined;
  }
}
