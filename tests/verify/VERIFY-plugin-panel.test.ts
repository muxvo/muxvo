/**
 * VERIFY-plugin-panel — Verification test for Plugin Tab feature
 *
 * Verifies:
 * 1. plugin.types.ts exists and exports expected types
 * 2. usePluginConfig hook file exists with expected exports
 * 3. PanelContext has pluginsPanel state/actions/reducer
 * 4. MenuBar has Plugins tab
 * 5. App.tsx imports PluginPanel and renders plugins-panel-overlay
 * 6. PluginPanel component files exist
 * 7. i18n keys for plugins exist in both zh and en
 * 8. installed_plugins.json can be parsed correctly
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SRC = path.resolve(__dirname, '../../src');

describe('VERIFY Plugin Panel', () => {
  // ── 1. Type definitions ──

  describe('plugin.types.ts', () => {
    test('file exists', () => {
      const filePath = path.join(SRC, 'shared/types/plugin.types.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('exports PluginEntry, PluginManifest, PluginContents, PluginScope', () => {
      const filePath = path.join(SRC, 'shared/types/plugin.types.ts');
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('export type PluginScope');
      expect(content).toContain('export interface PluginEntry');
      expect(content).toContain('export interface PluginManifest');
      expect(content).toContain('export interface PluginContents');
    });

    test('PluginEntry has required fields', () => {
      const filePath = path.join(SRC, 'shared/types/plugin.types.ts');
      const content = fs.readFileSync(filePath, 'utf-8');
      const requiredFields = ['id:', 'name:', 'marketplace:', 'version:', 'scope:', 'installPath:', 'enabled:', 'installedAt:', 'lastUpdated:'];
      for (const field of requiredFields) {
        expect(content, `Missing field: ${field}`).toContain(field);
      }
    });
  });

  // ── 2. usePluginConfig hook ──

  describe('usePluginConfig hook', () => {
    test('file exists', () => {
      const filePath = path.join(SRC, 'renderer/hooks/usePluginConfig.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('exports usePluginConfig function', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/hooks/usePluginConfig.ts'), 'utf-8');
      expect(content).toContain('export function usePluginConfig');
    });

    test('reads installed_plugins.json', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/hooks/usePluginConfig.ts'), 'utf-8');
      expect(content).toContain('installed_plugins.json');
    });

    test('reads enabledPlugins from settings', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/hooks/usePluginConfig.ts'), 'utf-8');
      expect(content).toContain('enabledPlugins');
    });

    test('provides toggleEnabled method', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/hooks/usePluginConfig.ts'), 'utf-8');
      expect(content).toContain('toggleEnabled');
    });
  });

  // ── 3. PanelContext ──

  describe('PanelContext pluginsPanel', () => {
    test('PanelState has pluginsPanel field', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/contexts/PanelContext.tsx'), 'utf-8');
      expect(content).toContain('pluginsPanel');
    });

    test('has OPEN_PLUGINS_PANEL action', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/contexts/PanelContext.tsx'), 'utf-8');
      expect(content).toContain('OPEN_PLUGINS_PANEL');
    });

    test('has CLOSE_PLUGINS_PANEL action', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/contexts/PanelContext.tsx'), 'utf-8');
      expect(content).toContain('CLOSE_PLUGINS_PANEL');
    });

    test('reducer handles OPEN and CLOSE cases', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/contexts/PanelContext.tsx'), 'utf-8');
      // Should have case statements for both
      expect(content).toMatch(/case\s+['"]OPEN_PLUGINS_PANEL['"]/);
      expect(content).toMatch(/case\s+['"]CLOSE_PLUGINS_PANEL['"]/);
    });
  });

  // ── 4. MenuBar ──

  describe('MenuBar Plugins tab', () => {
    test('TabId includes plugins', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/components/layout/MenuBar.tsx'), 'utf-8');
      expect(content).toContain("'plugins'");
    });

    test('has Plugins button in JSX', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/components/layout/MenuBar.tsx'), 'utf-8');
      expect(content).toContain('Plugins');
      expect(content).toContain('OPEN_PLUGINS_PANEL');
    });

    test('Plugins tab is between Hooks and Chat', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/components/layout/MenuBar.tsx'), 'utf-8');
      const hooksIndex = content.indexOf("handleTabClick('hooks')");
      const pluginsIndex = content.indexOf("handleTabClick('plugins')");
      const chatIndex = content.indexOf("handleTabClick('chat')");
      expect(hooksIndex).toBeLessThan(pluginsIndex);
      expect(pluginsIndex).toBeLessThan(chatIndex);
    });
  });

  // ── 5. App.tsx ──

  describe('App.tsx integration', () => {
    test('imports PluginPanel', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/App.tsx'), 'utf-8');
      expect(content).toContain("import { PluginPanel }");
    });

    test('renders plugins-panel-overlay', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/App.tsx'), 'utf-8');
      expect(content).toContain('plugins-panel-overlay');
      expect(content).toContain('pluginsPanel.open');
    });
  });

  // ── 6. PluginPanel component ──

  describe('PluginPanel component files', () => {
    test('PluginPanel.tsx exists', () => {
      expect(fs.existsSync(path.join(SRC, 'renderer/components/plugin/PluginPanel.tsx'))).toBe(true);
    });

    test('PluginPanel.css exists', () => {
      expect(fs.existsSync(path.join(SRC, 'renderer/components/plugin/PluginPanel.css'))).toBe(true);
    });

    test('PluginPanel uses usePluginConfig hook', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/components/plugin/PluginPanel.tsx'), 'utf-8');
      expect(content).toContain('usePluginConfig');
    });

    test('PluginPanel uses usePanelContext', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/components/plugin/PluginPanel.tsx'), 'utf-8');
      expect(content).toContain('usePanelContext');
    });

    test('PluginPanel has Escape key handler', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/components/plugin/PluginPanel.tsx'), 'utf-8');
      expect(content).toContain('Escape');
      expect(content).toContain('CLOSE_PLUGINS_PANEL');
    });

    test('PluginPanel has toggle enabled functionality', () => {
      const content = fs.readFileSync(path.join(SRC, 'renderer/components/plugin/PluginPanel.tsx'), 'utf-8');
      expect(content).toContain('toggleEnabled');
    });
  });

  // ── 7. i18n ──

  describe('plugins i18n keys', () => {
    const requiredKeys = [
      'plugins.title', 'plugins.selectPlugin', 'plugins.noPlugins',
      'plugins.enabled', 'plugins.disabled', 'plugins.version',
      'plugins.marketplace', 'plugins.installedAt', 'plugins.description',
      'plugins.author', 'plugins.installPath', 'plugins.commands',
      'plugins.skills', 'plugins.hooks', 'plugins.agents',
      'plugins.contents', 'plugins.noContents',
    ];

    test('zh locale has all plugins keys', () => {
      const { zh } = require('@/renderer/i18n/locales/zh');
      for (const key of requiredKeys) {
        expect(zh[key], `Missing zh key: ${key}`).toBeDefined();
      }
    });

    test('en locale has all plugins keys', () => {
      const { en } = require('@/renderer/i18n/locales/en');
      for (const key of requiredKeys) {
        expect(en[key], `Missing en key: ${key}`).toBeDefined();
      }
    });
  });

  // ── 8. Real data parsing ──

  describe('installed_plugins.json parsing', () => {
    test('can parse real installed_plugins.json structure', () => {
      const installedPath = path.join(os.homedir(), '.claude/plugins/installed_plugins.json');
      if (!fs.existsSync(installedPath)) {
        // Skip if file doesn't exist (CI environment)
        return;
      }

      const raw = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
      expect(raw).toHaveProperty('version');
      expect(raw).toHaveProperty('plugins');
      expect(typeof raw.plugins).toBe('object');

      // Verify at least one plugin key has correct structure
      const keys = Object.keys(raw.plugins);
      if (keys.length > 0) {
        const firstKey = keys[0];
        expect(firstKey).toContain('@'); // "name@marketplace" format
        const records = raw.plugins[firstKey];
        expect(Array.isArray(records)).toBe(true);
        if (records.length > 0) {
          expect(records[0]).toHaveProperty('installPath');
          expect(records[0]).toHaveProperty('version');
          expect(records[0]).toHaveProperty('installedAt');
        }
      }
    });

    test('enabledPlugins in settings.json has correct format', () => {
      const settingsPath = path.join(os.homedir(), '.claude/settings.json');
      if (!fs.existsSync(settingsPath)) return;

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.enabledPlugins) {
        expect(typeof settings.enabledPlugins).toBe('object');
        for (const [key, val] of Object.entries(settings.enabledPlugins)) {
          expect(key).toContain('@'); // "name@marketplace" format
          expect(typeof val).toBe('boolean');
        }
      }
    });
  });
});
