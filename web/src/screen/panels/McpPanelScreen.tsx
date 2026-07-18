/**
 * MCP 两栏面板屏（specs/behavior/mcp-panel.md）。纯 props 吃 fixture，永不 mock IPC。
 * App 路径无 projectCwd → 仅「系统」组；form=true = 选中 server 的编辑表单终态。
 */

import './panels.css';

type McpType = 'stdio' | 'http' | 'sse';

interface McpServer {
  name: string;
  type: McpType;
  scope: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  configPath?: string;
}

interface McpPayload {
  servers: McpServer[];
  selected: string | null;
  form?: boolean;
  /** dom-assert 面：loading 态 */
  loading?: boolean;
}

/** legacy McpPanel.tsx SCOPE_LABELS 同款 */
const SCOPE_LABELS: Record<string, { label: string; cls: string }> = {
  global: { label: 'CC', cls: 'mcp-panel__scope--cc' },
  project: { label: 'Project', cls: 'mcp-panel__scope--project' },
  desktop: { label: 'CC Desk', cls: 'mcp-panel__scope--cc' },
  codex: { label: 'Codex', cls: 'mcp-panel__scope--codex' },
  gemini: { label: 'GM', cls: 'mcp-panel__scope--gm' },
  'codex-project': { label: 'Codex Project', cls: 'mcp-panel__scope--codex' },
  'gemini-project': { label: 'GM Project', cls: 'mcp-panel__scope--gm' },
};

const PROJECT_SCOPES = new Set(['project', 'codex-project', 'gemini-project']);

function groupByLevel(servers: McpServer[]): { key: string; label: string; servers: McpServer[] }[] {
  const system: McpServer[] = [];
  const project: McpServer[] = [];
  for (const s of servers) (PROJECT_SCOPES.has(s.scope) ? project : system).push(s);
  const groups: { key: string; label: string; servers: McpServer[] }[] = [];
  if (system.length) groups.push({ key: 'system', label: '系统', servers: system });
  if (project.length) groups.push({ key: 'project', label: '项目', servers: project });
  return groups;
}

function ScopeBadge({ scope }: { scope: string }): JSX.Element {
  const meta = SCOPE_LABELS[scope] ?? { label: scope, cls: '' };
  return <span className={`mcp-panel__scope-badge ${meta.cls}`}>{meta.label}</span>;
}

function TypeBadge({ type }: { type: McpType }): JSX.Element {
  return <span className={`mcp-panel__type-badge mcp-panel__type-badge--${type}`}>{type.toUpperCase()}</span>;
}

function DetailRow({ label, value, mono, pre }: { label: string; value: string; mono?: boolean; pre?: boolean }): JSX.Element {
  const valueCls = `mcp-panel__detail-value${mono ? ' mcp-panel__detail-value--mono' : ''}`;
  return (
    <div className="mcp-panel__detail-row">
      <span className="mcp-panel__detail-label">{label}</span>
      {pre ? <pre className={valueCls}>{value}</pre> : <span className={valueCls}>{value}</span>}
    </div>
  );
}

function ServerDetail({ server }: { server: McpServer }): JSX.Element {
  const isGlobal = server.scope === 'global';
  return (
    <div className="mcp-panel__detail">
      <div className="mcp-panel__detail-header">
        <h3 className="mcp-panel__detail-name">{server.name}</h3>
        <ScopeBadge scope={server.scope} />
        <TypeBadge type={server.type} />
      </div>

      <div className="mcp-panel__detail-body">
        {server.type === 'stdio' && (
          <>
            <DetailRow label="命令" value={server.command || '-'} mono />
            <DetailRow label="参数" value={server.args?.join(' ') || '-'} mono />
          </>
        )}
        {server.type !== 'stdio' && (
          <>
            <DetailRow label="URL" value={server.url || '-'} mono />
            {server.headers && Object.keys(server.headers).length > 0 && (
              <DetailRow label="Headers" value={JSON.stringify(server.headers, null, 2)} mono pre />
            )}
          </>
        )}
        {server.env && Object.keys(server.env).length > 0 && (
          <DetailRow label="环境变量" value={JSON.stringify(server.env, null, 2)} mono pre />
        )}
        {server.configPath && <DetailRow label="配置路径" value={server.configPath} mono />}
      </div>

      {isGlobal ? (
        <div className="mcp-panel__detail-actions">
          <button className="mcp-panel__btn mcp-panel__btn--primary">编辑</button>
          <button className="mcp-panel__btn mcp-panel__btn--danger">删除</button>
        </div>
      ) : (
        <div className="mcp-panel__detail-hint">
          此服务器来自项目或桌面配置，仅可在对应配置文件中修改。
        </div>
      )}
    </div>
  );
}

function ServerForm({ server }: { server: McpServer }): JSX.Element {
  return (
    <div className="mcp-panel__form">
      <div className="mcp-panel__form-header">编辑服务器</div>

      <div className="mcp-panel__form-body">
        <label className="mcp-panel__form-label">
          名称
          <input className="mcp-panel__form-input" value={server.name} placeholder="server-name" readOnly />
        </label>

        <label className="mcp-panel__form-label">
          类型
          <select className="mcp-panel__form-select" value={server.type} disabled={false} onChange={() => {}}>
            <option value="stdio">STDIO</option>
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </label>

        {server.type === 'stdio' ? (
          <>
            <label className="mcp-panel__form-label">
              命令
              <input
                className="mcp-panel__form-input"
                value={server.command ?? ''}
                placeholder="npx @modelcontextprotocol/server-xxx"
                readOnly
              />
            </label>
            <label className="mcp-panel__form-label">
              参数
              <input className="mcp-panel__form-input" value={server.args?.join(' ') ?? ''} placeholder="空格分隔" readOnly />
            </label>
          </>
        ) : (
          <>
            <label className="mcp-panel__form-label">
              URL
              <input className="mcp-panel__form-input" value={server.url ?? ''} placeholder="https://..." readOnly />
            </label>
            <label className="mcp-panel__form-label">
              Headers
              <textarea
                className="mcp-panel__form-textarea"
                value={server.headers ? JSON.stringify(server.headers, null, 2) : ''}
                placeholder='{"Authorization": "Bearer ..."}'
                rows={3}
                readOnly
              />
            </label>
          </>
        )}

        <label className="mcp-panel__form-label">
          环境变量
          <textarea
            className="mcp-panel__form-textarea"
            value={server.env ? JSON.stringify(server.env, null, 2) : ''}
            placeholder='{"API_KEY": "..."}'
            rows={3}
            readOnly
          />
        </label>
      </div>

      <div className="mcp-panel__form-actions">
        <button className="mcp-panel__btn mcp-panel__btn--primary">保存</button>
        <button className="mcp-panel__btn">取消</button>
      </div>
    </div>
  );
}

export function McpPanelScreen({ fx }: { fx: any }): JSX.Element {
  const mc: McpPayload = fx.mcp ?? { servers: [], selected: null };
  const groups = groupByLevel(mc.servers);
  const selected = mc.servers.find((s) => s.name === mc.selected) ?? null;

  return (
    <div className="mcp-panel-overlay">
      <div className="mcp-panel">
        {/* 左：server 列表 */}
        <div className="mcp-panel__left" style={{ width: 280 }}>
          <div className="mcp-panel__header">
            <span>MCP Servers</span>
            <span className="mcp-panel__count">{mc.servers.length}</span>
            <button className="mcp-panel__add-btn">+</button>
          </div>
          <div className="mcp-panel__list">
            {mc.loading ? (
              <div className="mcp-panel__loading">加载中...</div>
            ) : mc.servers.length === 0 ? (
              <div className="mcp-panel__empty">暂无 MCP 服务器配置</div>
            ) : (
              groups.map((group) => (
                <div key={group.key} className="mcp-panel__group">
                  <div className="mcp-panel__group-header">
                    <span className="mcp-panel__group-arrow mcp-panel__group-arrow--open">{'▶'}</span>
                    <span className="mcp-panel__group-label">{group.label}</span>
                    <span className="mcp-panel__group-count">{group.servers.length}</span>
                  </div>
                  <div className="mcp-panel__group-items">
                    {group.servers.map((s) => (
                      <div
                        key={`${s.scope}:${s.name}`}
                        className={`mcp-panel__item${selected?.name === s.name && selected?.scope === s.scope ? ' mcp-panel__item--active' : ''}`}
                      >
                        <div className="mcp-panel__item-name">{s.name}</div>
                        <ScopeBadge scope={s.scope} />
                        <TypeBadge type={s.type} />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mcp-panel__resize-handle" />

        {/* 右：详情 / 表单 */}
        <div className="mcp-panel__right">
          {selected && mc.form ? (
            <ServerForm server={selected} />
          ) : selected ? (
            <ServerDetail server={selected} />
          ) : (
            <div className="mcp-panel__placeholder">
              <span>选择一个服务器查看详情</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
