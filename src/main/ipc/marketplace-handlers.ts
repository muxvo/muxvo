/**
 * Marketplace IPC Handlers
 *
 * Handles marketplace:fetch-sources, marketplace:search, marketplace:install,
 * marketplace:uninstall, marketplace:get-installed, marketplace:check-updates
 * IPC channels. Push events: install-progress, packages-loaded, update-available.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { join } from 'path';
import { homedir } from 'os';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import { fetchSources as fetchMarketplaceSources } from '@/modules/marketplace/aggregator';
import { getInstalledPackages } from '@/modules/marketplace/registry';
import { uninstallPackage } from '@/modules/marketplace/uninstaller';
import { installSkill } from '@/main/services/marketplace/installer';
import { getDefaultSortOrder } from '@/modules/marketplace/sort-strategy';
import type { InstallRequest } from '@/shared/types/marketplace.types';

function pushToAllWindows(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

export function createMarketplaceHandlers() {
  return {
    async fetchSources(): Promise<Record<string, unknown>> {
      try {
        const result = await fetchMarketplaceSources();
        pushToAllWindows(IPC_CHANNELS.MARKETPLACE.PACKAGES_LOADED, {
          packages: result.sources,
          source: getDefaultSortOrder()[0],
        });
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'MARKETPLACE_FETCH_ERROR', message } };
      }
    },

    async search(params: { query: string; filters?: Record<string, unknown> }): Promise<Record<string, unknown>> {
      try {
        const { sources } = await fetchMarketplaceSources();
        const query = params.query.toLowerCase();
        const filtered = sources.filter((src: Record<string, unknown>) => {
          const name = String(src.name ?? '').toLowerCase();
          const description = String(src.description ?? '').toLowerCase();
          const tags = Array.isArray(src.tags)
            ? src.tags.map((t: unknown) => String(t).toLowerCase())
            : [];
          return (
            name.includes(query) ||
            description.includes(query) ||
            tags.some((t: string) => t.includes(query))
          );
        });
        return { success: true, data: { sources: filtered, totalCount: filtered.length } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'MARKETPLACE_SEARCH_ERROR', message } };
      }
    },

    async install(params: InstallRequest): Promise<Record<string, unknown>> {
      try {
        pushToAllWindows(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, {
          name: params.name,
          progress: 0,
          status: 'downloading',
        });

        const targetDir = join(
          homedir(),
          '.claude',
          params.type === 'hook' ? 'hooks' : 'skills',
        );

        pushToAllWindows(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, {
          name: params.name,
          progress: 50,
          status: 'installing',
        });

        const result = installSkill({ skillId: params.name, targetDir });

        pushToAllWindows(IPC_CHANNELS.MARKETPLACE.INSTALL_PROGRESS, {
          name: params.name,
          progress: 100,
          status: 'complete',
        });

        if (!result.success) {
          return {
            success: false,
            error: { code: 'MARKETPLACE_INSTALL_ERROR', message: result.error?.message ?? 'Install failed' },
          };
        }
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'MARKETPLACE_INSTALL_ERROR', message } };
      }
    },

    async uninstall(params: { name: string; type?: 'hook' | 'skill' }): Promise<Record<string, unknown>> {
      try {
        const result = await uninstallPackage({
          name: params.name,
          type: params.type ?? 'skill',
        });
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'MARKETPLACE_UNINSTALL_ERROR', message } };
      }
    },

    async getInstalled(): Promise<Record<string, unknown>> {
      try {
        const result = await getInstalledPackages();
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'MARKETPLACE_GET_INSTALLED_ERROR', message } };
      }
    },

    async checkUpdates(): Promise<Record<string, unknown>> {
      try {
        const updates: unknown[] = [];
        pushToAllWindows(IPC_CHANNELS.MARKETPLACE.UPDATE_AVAILABLE, { packages: updates });
        return { success: true, data: { updates } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'MARKETPLACE_CHECK_UPDATES_ERROR', message } };
      }
    },
  };
}

// Legacy export for tests
export const marketplaceHandlers = createMarketplaceHandlers();

export function registerMarketplaceHandlers(): void {
  const handlers = createMarketplaceHandlers();

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE.FETCH_SOURCES, async () => {
    return handlers.fetchSources();
  });

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE.SEARCH, async (_event, params: { query: string; filters?: Record<string, unknown> }) => {
    return handlers.search(params);
  });

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE.INSTALL, async (_event, params: InstallRequest) => {
    return handlers.install(params);
  });

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE.UNINSTALL, async (_event, params: { name: string; type?: 'hook' | 'skill' }) => {
    return handlers.uninstall(params);
  });

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE.GET_INSTALLED, async () => {
    return handlers.getInstalled();
  });

  ipcMain.handle(IPC_CHANNELS.MARKETPLACE.CHECK_UPDATES, async () => {
    return handlers.checkUpdates();
  });
}
