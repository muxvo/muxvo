/**
 * usePluginConfig — Read installed plugins and toggle enabled state
 *
 * Data sources:
 *   Installed list:  ~/.claude/plugins/installed_plugins.json
 *   Enabled state:   ~/.claude/settings.json → enabledPlugins
 *   Manifest:        {installPath}/.claude-plugin/plugin.json (fallback: marketplace dir)
 *   Contents:        {pluginDir}/commands/, skills/, hooks/, agents/
 */

import { useState, useEffect, useCallback } from 'react';
import type {
  PluginEntry,
  PluginManifest,
  PluginContents,
  PluginInstallRecord,
} from '@/shared/types/plugin.types';

interface UsePluginConfigReturn {
  plugins: PluginEntry[];
  loading: boolean;
  error: string | null;
  toggleEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  reload: () => void;
}

/** Read plugin.json from installPath or marketplace fallback directory */
async function readPluginManifest(
  installPath: string,
  marketplace: string,
  name: string,
  homePath: string,
): Promise<PluginManifest | undefined> {
  // Try installPath first
  const primaryPath = `${installPath}/.claude-plugin/plugin.json`;
  try {
    const result = await window.api.fs.readFile(primaryPath);
    if (result?.success && result.data?.content) {
      return JSON.parse(result.data.content) as PluginManifest;
    }
  } catch { /* ignore */ }

  // Fallback: marketplace directory
  const fallbackPath = `${homePath}/.claude/plugins/marketplaces/${marketplace}/plugins/${name}/.claude-plugin/plugin.json`;
  try {
    const result = await window.api.fs.readFile(fallbackPath);
    if (result?.success && result.data?.content) {
      return JSON.parse(result.data.content) as PluginManifest;
    }
  } catch { /* ignore */ }

  return undefined;
}

/** Scan plugin directory for bundled content (commands, skills, hooks, agents) */
async function scanPluginContents(pluginDir: string): Promise<PluginContents> {
  const contents: PluginContents = { commands: [], skills: [], hooks: [], agents: [] };

  // commands/ — .md files, use filename without extension
  try {
    const result = await window.api.fs.readDir(`${pluginDir}/commands`);
    if (result?.success && result.data) {
      const entries = result.data as Array<{ name: string; isDirectory: boolean }>;
      contents.commands = entries
        .filter((e) => !e.isDirectory && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    }
  } catch { /* ignore */ }

  // skills/ — subdirectory names
  try {
    const result = await window.api.fs.readDir(`${pluginDir}/skills`);
    if (result?.success && result.data) {
      const entries = result.data as Array<{ name: string; isDirectory: boolean }>;
      contents.skills = entries.filter((e) => e.isDirectory).map((e) => e.name);
    }
  } catch { /* ignore */ }

  // hooks/ — all file names
  try {
    const result = await window.api.fs.readDir(`${pluginDir}/hooks`);
    if (result?.success && result.data) {
      const entries = result.data as Array<{ name: string; isDirectory: boolean }>;
      contents.hooks = entries.filter((e) => !e.isDirectory).map((e) => e.name);
    }
  } catch { /* ignore */ }

  // agents/ — .md files, use filename without extension
  try {
    const result = await window.api.fs.readDir(`${pluginDir}/agents`);
    if (result?.success && result.data) {
      const entries = result.data as Array<{ name: string; isDirectory: boolean }>;
      contents.agents = entries
        .filter((e) => !e.isDirectory && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    }
  } catch { /* ignore */ }

  return contents;
}

export function usePluginConfig(): UsePluginConfigReturn {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const homePath = window.api.app.getHomePath();
  const installedPath = `${homePath}/.claude/plugins/installed_plugins.json`;

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 1. Read installed_plugins.json
        const installResult = await window.api.fs.readFile(installedPath);
        if (!installResult?.success || !installResult.data?.content) {
          if (!cancelled) {
            setPlugins([]);
            setLoading(false);
          }
          return;
        }

        const installData = JSON.parse(installResult.data.content) as {
          version?: number;
          plugins?: Record<string, PluginInstallRecord[]>;
        };
        const pluginsMap = installData.plugins ?? {};

        // 2. Read settings for enabled state
        let enabledPlugins: Record<string, boolean> = {};
        try {
          const settingsResult = await window.api.config.getSettings();
          const settings = settingsResult?.settings as Record<string, unknown> | undefined;
          if (settings?.enabledPlugins && typeof settings.enabledPlugins === 'object') {
            enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
          }
        } catch { /* ignore */ }

        // 3. Build plugin entries with manifest + contents in parallel
        const entries = Object.entries(pluginsMap);
        const pluginEntries = await Promise.all(
          entries.map(async ([key, records]) => {
            if (!records || records.length === 0) return null;

            const record = records[0];
            const atIndex = key.lastIndexOf('@');
            const name = atIndex > 0 ? key.substring(0, atIndex) : key;
            const marketplace = atIndex > 0 ? key.substring(atIndex + 1) : '';

            const [manifest, contents] = await Promise.all([
              readPluginManifest(record.installPath, marketplace, name, homePath),
              scanPluginContents(record.installPath),
            ]);

            const entry: PluginEntry = {
              id: key,
              name,
              marketplace,
              version: record.version,
              scope: record.scope,
              installPath: record.installPath,
              enabled: enabledPlugins[key] === true,
              installedAt: record.installedAt,
              lastUpdated: record.lastUpdated,
              manifest,
              contents,
            };
            return entry;
          }),
        );

        if (!cancelled) {
          setPlugins(pluginEntries.filter((e): e is PluginEntry => e !== null));
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [homePath, installedPath, reloadKey]);

  const toggleEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      // Read current settings
      let settings: Record<string, unknown> = {};
      try {
        const result = await window.api.config.getSettings();
        if (result?.settings) {
          settings = result.settings as Record<string, unknown>;
        }
      } catch { /* ignore */ }

      const enabledPlugins = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
      enabledPlugins[pluginId] = enabled;
      settings.enabledPlugins = enabledPlugins;

      await window.api.config.saveSettings(settings);
      reload();
    },
    [reload],
  );

  return { plugins, loading, error, toggleEnabled, reload };
}
