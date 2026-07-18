/**
 * Plugins 两栏面板屏（specs/behavior/plugins-panel.md）。纯 props 吃 fixture，永不 mock IPC。
 * error 态渲染 `Error: <error>`（legacy usePluginConfig String(err) 同构）；
 * 日期 new Date(iso).toLocaleDateString()——fixture 固定 ISO，两侧同浏览器输出一致。
 */

import './panels.css';

interface PluginContents {
  commands: string[];
  skills: string[];
  hooks: string[];
  agents: string[];
}

interface PluginItem {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  scope: string;
  installPath: string;
  enabled: boolean;
  installedAt: string;
  lastUpdated: string;
  manifest?: { description?: string; author?: { name: string } };
  contents: PluginContents;
}

interface PluginsPayload {
  error: string | null;
  items: PluginItem[];
  selectedId: string | null;
  /** dom-assert 面：loading 态 */
  loading?: boolean;
}

function groupByMarketplace(plugins: PluginItem[]): Record<string, PluginItem[]> {
  const result: Record<string, PluginItem[]> = {};
  for (const p of plugins) {
    const key = p.marketplace || '';
    if (!result[key]) result[key] = [];
    result[key].push(p);
  }
  return result;
}

/** legacy PluginPanel.tsx formatDate 同构 */
function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="plugin-panel__info-row">
      <span className="plugin-panel__info-label">{label}</span>
      <span className="plugin-panel__info-value">{value}</span>
    </div>
  );
}

function ContentList({ label, items }: { label: string; items: string[] }): JSX.Element {
  return (
    <div className="plugin-panel__content-group">
      <span className="plugin-panel__content-label">{label}</span>
      <ul className="plugin-panel__content-list">
        {items.map((item) => (
          <li key={item} className="plugin-panel__content-item">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PluginDetail({ plugin }: { plugin: PluginItem }): JSX.Element {
  const c = plugin.contents;
  const hasContents =
    c && (c.commands.length > 0 || c.skills.length > 0 || c.hooks.length > 0 || c.agents.length > 0);

  return (
    <div className="plugin-panel__detail">
      <div className="plugin-panel__detail-header">
        <h3 className="plugin-panel__detail-name">{plugin.name}</h3>
        <span className="plugin-panel__tag">{plugin.marketplace || 'Unknown'}</span>
      </div>

      <div className="plugin-panel__toggle-row">
        <span className="plugin-panel__toggle-label">{plugin.enabled ? '已启用' : '已禁用'}</span>
        <label className="plugin-panel__toggle">
          <input type="checkbox" checked={plugin.enabled} readOnly />
          <span className="plugin-panel__toggle-slider" />
        </label>
      </div>

      <div className="plugin-panel__detail-body">
        <InfoRow label="版本" value={plugin.version} />
        <InfoRow label="范围" value={plugin.scope} />
        <InfoRow label="安装时间" value={formatDate(plugin.installedAt)} />
        <InfoRow label="最后更新" value={formatDate(plugin.lastUpdated)} />
        {plugin.manifest?.description && <InfoRow label="描述" value={plugin.manifest.description} />}
        {plugin.manifest?.author?.name && <InfoRow label="作者" value={plugin.manifest.author.name} />}
      </div>

      <div className="plugin-panel__contents-section">
        <div className="plugin-panel__contents-title">包含内容</div>
        {hasContents ? (
          <>
            {c.commands.length > 0 && <ContentList label="Commands" items={c.commands} />}
            {c.skills.length > 0 && <ContentList label="Skills" items={c.skills} />}
            {c.hooks.length > 0 && <ContentList label="Hooks" items={c.hooks} />}
            {c.agents.length > 0 && <ContentList label="Agents" items={c.agents} />}
          </>
        ) : (
          <div className="plugin-panel__no-contents">无包含内容</div>
        )}
      </div>

      <div className="plugin-panel__path-section">
        <span className="plugin-panel__path-label">安装路径</span>
        <span className="plugin-panel__path">{plugin.installPath}</span>
      </div>
    </div>
  );
}

export function PluginsPanelScreen({ fx }: { fx: any }): JSX.Element {
  const pl: PluginsPayload = fx.plugins ?? { error: null, items: [], selectedId: null };
  const grouped = groupByMarketplace(pl.items);
  const selected = pl.items.find((p) => p.id === pl.selectedId) ?? null;

  return (
    <div className="plugins-panel-overlay">
      <div className="plugin-panel">
        {/* 左：插件列表（按 marketplace 分组） */}
        <div className="plugin-panel__left" style={{ width: 280 }}>
          <div className="plugin-panel__header">
            <span>插件</span>
            <span className="plugin-panel__count">{pl.items.length}</span>
          </div>
          <div className="plugin-panel__list">
            {pl.loading ? (
              <div className="plugin-panel__loading">加载中...</div>
            ) : pl.error ? (
              <div className="plugin-panel__empty">Error: {pl.error}</div>
            ) : pl.items.length === 0 ? (
              <div className="plugin-panel__empty">暂无已安装插件</div>
            ) : (
              Object.entries(grouped).map(([marketplace, items]) => (
                <div key={marketplace} className="plugin-panel__group">
                  <div className="plugin-panel__group-title">{marketplace || 'Unknown'}</div>
                  {items.map((p) => (
                    <div
                      key={p.id}
                      className={`plugin-panel__item${selected?.id === p.id ? ' plugin-panel__item--active' : ''}`}
                    >
                      <span
                        className={`plugin-panel__dot ${p.enabled ? 'plugin-panel__dot--enabled' : 'plugin-panel__dot--disabled'}`}
                      />
                      <span className="plugin-panel__item-name">{p.name}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="plugin-panel__resize-handle" />

        {/* 右：详情 */}
        <div className="plugin-panel__right">
          {selected ? (
            <PluginDetail plugin={selected} />
          ) : (
            <div className="plugin-panel__placeholder">
              <span>选择插件查看详情</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
