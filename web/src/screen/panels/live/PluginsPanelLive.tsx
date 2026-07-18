/**
 * Plugins 面板 live 包装（plugins-panel.md）：golden PluginsPanelScreen 纯 props 复用，
 * 交互经委托点击（选中 / 启停开关 setPluginEnabled）。仅此面板有 error 分支（顶层拉取失败）。
 */
import { useCallback, useState } from 'react';
import type { MouseEvent } from 'react';
import { useConfigApi } from '../../../config/ConfigContext';
import { registerLivePanel, type LivePanelProps } from '../../live/panelRegistry';
import { PluginsPanelScreen } from '../PluginsPanelScreen';
import { pluginViewToFixture, type FixturePluginItem } from './mappers';
import { useConfigData } from './shared';
import './panels-live.css';

interface PluginsData {
  items: FixturePluginItem[];
  error: string | null;
}

// Plugins 无编辑/dirty → 不拦 Esc（LiveChrome bubble-close 直接关面板）；onClose 由 LiveChrome 提供不自用。
export function PluginsPanelLive({}: LivePanelProps): JSX.Element {
  const api = useConfigApi();
  const [{ items, error }] = useConfigData<PluginsData>(
    api,
    async (a) => {
      const r = await a.request({ kind: 'plugins' });
      if (r.kind === 'plugins') return { items: r.items.map(pluginViewToFixture), error: null };
      if (r.kind === 'rejected') return { items: [], error: r.message };
      return { items: [], error: null };
    },
    { items: [], error: null },
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onClick = useCallback(
    (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      const toggle = target.closest('.plugin-panel__toggle, .plugin-panel__toggle-row');
      if (toggle && selectedId && api) {
        const cur = items.find((p) => p.id === selectedId);
        if (cur) void api.request({ kind: 'setPluginEnabled', pluginId: cur.id, enabled: !cur.enabled }).catch(() => {});
        return;
      }
      const item = target.closest('.plugin-panel__item');
      if (item) {
        const name = item.querySelector('.plugin-panel__item-name')?.textContent ?? '';
        const p = items.find((x) => x.name === name);
        if (p) setSelectedId(p.id);
      }
    },
    [api, items, selectedId],
  );

  return (
    <div className="plugins-panel-live" onClick={onClick}>
      <PluginsPanelScreen fx={{ screen: 'plugins-panel', theme: 'dark', plugins: { error, items, selectedId } }} />
    </div>
  );
}

registerLivePanel('plugins', PluginsPanelLive);
