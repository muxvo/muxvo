/**
 * PluginPanel — Two-column plugin management panel
 *
 * Left: plugin list grouped by marketplace
 * Right: plugin detail view with toggle / info / contents
 *
 * Escape: close panel.
 */

import { useState, useEffect, useCallback } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { usePluginConfig } from '@/renderer/hooks/usePluginConfig';
import { useI18n } from '@/renderer/i18n';
import type { PluginEntry } from '@/shared/types/plugin.types';
import './PluginPanel.css';

export function PluginPanel(): JSX.Element {
  const { dispatch } = usePanelContext();
  const { t } = useI18n();
  const { plugins, loading, error, toggleEnabled, reload } = usePluginConfig();

  const [selected, setSelected] = useState<PluginEntry | null>(null);
  const [leftWidth, setLeftWidth] = useState(280);

  // Keep selected in sync after reload
  useEffect(() => {
    if (selected) {
      const fresh = plugins.find((p) => p.id === selected.id);
      if (fresh) setSelected(fresh);
      else setSelected(null);
    }
  }, [plugins]);

  // Keyboard: Escape closes panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_PLUGINS_PANEL' });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

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

  // Group plugins by marketplace
  const grouped = groupByMarketplace(plugins);

  return (
    <div className="plugin-panel">
      {/* Left: plugin list */}
      <div className="plugin-panel__left" style={{ width: leftWidth }}>
        <div className="plugin-panel__header">
          <span>{t('plugins.title')}</span>
          <span className="plugin-panel__count">{plugins.length}</span>
        </div>
        <div className="plugin-panel__list">
          {loading ? (
            <div className="plugin-panel__loading">{t('plugins.loading')}</div>
          ) : error ? (
            <div className="plugin-panel__empty">{error}</div>
          ) : plugins.length === 0 ? (
            <div className="plugin-panel__empty">{t('plugins.noPlugins')}</div>
          ) : (
            Object.entries(grouped).map(([marketplace, items]) => (
              <div key={marketplace} className="plugin-panel__group">
                <div className="plugin-panel__group-title">{marketplace || 'Unknown'}</div>
                {items.map((p) => (
                  <div
                    key={p.id}
                    className={`plugin-panel__item${selected?.id === p.id ? ' plugin-panel__item--active' : ''}`}
                    onClick={() => setSelected(p)}
                  >
                    <span className={`plugin-panel__dot ${p.enabled ? 'plugin-panel__dot--enabled' : 'plugin-panel__dot--disabled'}`} />
                    <span className="plugin-panel__item-name">{p.name}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="plugin-panel__resize-handle" onMouseDown={handleResizeStart} />

      {/* Right: detail */}
      <div className="plugin-panel__right">
        {selected ? (
          <PluginDetail plugin={selected} onToggle={toggleEnabled} t={t} />
        ) : (
          <div className="plugin-panel__placeholder">
            <span>{t('plugins.selectPlugin')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function PluginDetail({
  plugin,
  onToggle,
  t,
}: {
  plugin: PluginEntry;
  onToggle: (pluginId: string, enabled: boolean) => Promise<void>;
  t: (...args: any[]) => string;
}): JSX.Element {
  const handleToggle = useCallback(() => {
    onToggle(plugin.id, !plugin.enabled);
  }, [plugin.id, plugin.enabled, onToggle]);

  const hasContents =
    plugin.contents &&
    (plugin.contents.commands.length > 0 ||
      plugin.contents.skills.length > 0 ||
      plugin.contents.hooks.length > 0 ||
      plugin.contents.agents.length > 0);

  return (
    <div className="plugin-panel__detail">
      {/* Header */}
      <div className="plugin-panel__detail-header">
        <h3 className="plugin-panel__detail-name">{plugin.name}</h3>
        <span className="plugin-panel__tag">{plugin.marketplace || 'Unknown'}</span>
      </div>

      {/* Toggle */}
      <div className="plugin-panel__toggle-row">
        <span className="plugin-panel__toggle-label">
          {plugin.enabled ? t('plugins.enabled') : t('plugins.disabled')}
        </span>
        <label className="plugin-panel__toggle">
          <input
            type="checkbox"
            checked={plugin.enabled}
            onChange={handleToggle}
          />
          <span className="plugin-panel__toggle-slider" />
        </label>
      </div>

      {/* Info */}
      <div className="plugin-panel__detail-body">
        <InfoRow label={t('plugins.version')} value={plugin.version} />
        <InfoRow label={t('plugins.scope')} value={plugin.scope} />
        <InfoRow label={t('plugins.installedAt')} value={formatDate(plugin.installedAt)} />
        <InfoRow label={t('plugins.lastUpdated')} value={formatDate(plugin.lastUpdated)} />

        {plugin.manifest?.description && (
          <InfoRow label={t('plugins.description')} value={plugin.manifest.description} />
        )}
        {plugin.manifest?.author?.name && (
          <InfoRow label={t('plugins.author')} value={plugin.manifest.author.name} />
        )}
      </div>

      {/* Contents */}
      <div className="plugin-panel__contents-section">
        <div className="plugin-panel__contents-title">{t('plugins.contents')}</div>
        {hasContents ? (
          <>
            {plugin.contents!.commands.length > 0 && (
              <ContentList label="Commands" items={plugin.contents!.commands} />
            )}
            {plugin.contents!.skills.length > 0 && (
              <ContentList label="Skills" items={plugin.contents!.skills} />
            )}
            {plugin.contents!.hooks.length > 0 && (
              <ContentList label="Hooks" items={plugin.contents!.hooks} />
            )}
            {plugin.contents!.agents.length > 0 && (
              <ContentList label="Agents" items={plugin.contents!.agents} />
            )}
          </>
        ) : (
          <div className="plugin-panel__no-contents">{t('plugins.noContents')}</div>
        )}
      </div>

      {/* Install path */}
      <div className="plugin-panel__path-section">
        <span className="plugin-panel__path-label">{t('plugins.installPath')}</span>
        <span className="plugin-panel__path">{plugin.installPath}</span>
      </div>
    </div>
  );
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

// ── Helpers ──

function groupByMarketplace(plugins: PluginEntry[]): Record<string, PluginEntry[]> {
  const result: Record<string, PluginEntry[]> = {};
  for (const p of plugins) {
    const key = p.marketplace || '';
    if (!result[key]) result[key] = [];
    result[key].push(p);
  }
  return result;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
