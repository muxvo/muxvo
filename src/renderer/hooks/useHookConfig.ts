/**
 * useHookConfig — Read/write Hook configurations from multiple sources
 *
 * Sources:
 *   Global (writable):       ~/.claude/settings.json → hooks field
 *   Project (read-only):     {cwd}/.claude/settings.json → hooks field
 *   Project-local (read-only): {cwd}/.claude/settings.local.json → hooks field
 *
 * The nested Hook structure (Event → MatcherGroup[] → Handler[]) is flattened
 * to HookEntry[] for easy UI rendering.
 */

import { useState, useEffect, useCallback } from 'react';
import type {
  HookEntry,
  HookEventName,
  HookMatcherGroup,
  HookHandler,
  HookConfigScope,
} from '@/shared/types/hook.types';

interface UseHookConfigReturn {
  hooks: HookEntry[];
  loading: boolean;
  error: string | null;
  add: (event: HookEventName, matcher: string | undefined, handler: HookHandler) => Promise<void>;
  update: (id: string, event: HookEventName, matcher: string | undefined, handler: HookHandler) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reload: () => void;
}

/** Flatten the nested hooks structure into HookEntry[] */
function flattenHooks(
  hooksObj: Record<string, HookMatcherGroup[]>,
  scope: HookConfigScope,
  configPath: string,
): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      if (!Array.isArray(group.hooks)) return;
      group.hooks.forEach((handler, hi) => {
        entries.push({
          id: `${scope}:${event}:${gi}:${hi}`,
          event: event as HookEventName,
          matcher: group.matcher,
          handler,
          scope,
          configPath,
        });
      });
    });
  }
  return entries;
}

/** Read hooks from a settings file */
async function readHooksFromFile(
  filePath: string,
  scope: HookConfigScope,
): Promise<HookEntry[]> {
  try {
    const result = await window.api.fs.readFile(filePath);
    if (!result?.success || !result.data?.content) return [];
    const json = JSON.parse(result.data.content);
    if (!json.hooks || typeof json.hooks !== 'object') return [];
    return flattenHooks(json.hooks, scope, filePath);
  } catch {
    return [];
  }
}

export function useHookConfig(projectCwd?: string): UseHookConfigReturn {
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const homePath = window.api.app.getHomePath();
  const globalPath = `${homePath}/.claude/settings.json`;

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const promises: Promise<HookEntry[]>[] = [];

    // Global: use config.getSettings() API — returns { settings: {...} }
    promises.push(
      window.api.config
        .getSettings()
        .then((result: any) => {
          if (!result?.settings?.hooks) return [];
          return flattenHooks(
            result.settings.hooks as Record<string, HookMatcherGroup[]>,
            'global',
            globalPath,
          );
        })
        .catch(() => [] as HookEntry[]),
    );

    // Project-scoped files
    if (projectCwd) {
      promises.push(
        readHooksFromFile(`${projectCwd}/.claude/settings.json`, 'project'),
      );
      promises.push(
        readHooksFromFile(`${projectCwd}/.claude/settings.local.json`, 'project-local'),
      );
    }

    Promise.all(promises)
      .then((results) => {
        if (cancelled) return;
        setHooks(results.flat());
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [globalPath, projectCwd, reloadKey]);

  /** Read global settings, mutate hooks, write back */
  const mutateGlobal = useCallback(
    async (mutator: (hooks: Record<string, HookMatcherGroup[]>) => Record<string, HookMatcherGroup[]>) => {
      // Read current settings — getSettings() returns { settings: {...} }
      let settings: Record<string, unknown> = {};
      try {
        const result = await window.api.config.getSettings();
        if (result?.settings) {
          settings = result.settings as Record<string, unknown>;
        }
      } catch { /* may not exist */ }

      const currentHooks = (settings.hooks ?? {}) as Record<string, HookMatcherGroup[]>;
      settings.hooks = mutator(currentHooks);

      const saveResult = await window.api.config.saveSettings(settings);
      if (!saveResult?.success) {
        throw new Error('Failed to save settings');
      }
      reload();
    },
    [reload],
  );

  const add = useCallback(
    async (event: HookEventName, matcher: string | undefined, handler: HookHandler) => {
      await mutateGlobal((currentHooks) => {
        const updated = { ...currentHooks };
        const groups = updated[event] ? [...updated[event]] : [];

        // Find existing group with same matcher, or create new one
        const matcherStr = matcher || undefined;
        const existingIdx = groups.findIndex((g) =>
          (g.matcher ?? undefined) === matcherStr,
        );

        if (existingIdx >= 0) {
          groups[existingIdx] = {
            ...groups[existingIdx],
            hooks: [...groups[existingIdx].hooks, handler],
          };
        } else {
          const newGroup: HookMatcherGroup = { hooks: [handler] };
          if (matcherStr) newGroup.matcher = matcherStr;
          groups.push(newGroup);
        }

        updated[event] = groups;
        return updated;
      });
    },
    [mutateGlobal],
  );

  const update = useCallback(
    async (id: string, event: HookEventName, matcher: string | undefined, handler: HookHandler) => {
      // Parse the ID to find original location
      const parts = id.split(':');
      if (parts.length < 4 || parts[0] !== 'global') return;
      const origEvent = parts[1];
      const origGi = parseInt(parts[2], 10);
      const origHi = parseInt(parts[3], 10);

      await mutateGlobal((currentHooks) => {
        const updated = { ...currentHooks };

        // Remove from original location
        if (updated[origEvent]) {
          const groups = [...updated[origEvent]];
          if (groups[origGi]) {
            const hooks = [...groups[origGi].hooks];
            hooks.splice(origHi, 1);
            if (hooks.length === 0) {
              groups.splice(origGi, 1);
            } else {
              groups[origGi] = { ...groups[origGi], hooks };
            }
            if (groups.length === 0) {
              delete updated[origEvent];
            } else {
              updated[origEvent] = groups;
            }
          }
        }

        // Add to new location
        const targetGroups = updated[event] ? [...updated[event]] : [];
        const matcherStr = matcher || undefined;
        const existingIdx = targetGroups.findIndex((g) =>
          (g.matcher ?? undefined) === matcherStr,
        );

        if (existingIdx >= 0) {
          targetGroups[existingIdx] = {
            ...targetGroups[existingIdx],
            hooks: [...targetGroups[existingIdx].hooks, handler],
          };
        } else {
          const newGroup: HookMatcherGroup = { hooks: [handler] };
          if (matcherStr) newGroup.matcher = matcherStr;
          targetGroups.push(newGroup);
        }

        updated[event] = targetGroups;
        return updated;
      });
    },
    [mutateGlobal],
  );

  const remove = useCallback(
    async (id: string) => {
      const parts = id.split(':');
      if (parts.length < 4 || parts[0] !== 'global') return;
      const origEvent = parts[1];
      const origGi = parseInt(parts[2], 10);
      const origHi = parseInt(parts[3], 10);

      await mutateGlobal((currentHooks) => {
        const updated = { ...currentHooks };
        if (!updated[origEvent]) return updated;

        const groups = [...updated[origEvent]];
        if (!groups[origGi]) return updated;

        const hooks = [...groups[origGi].hooks];
        hooks.splice(origHi, 1);
        if (hooks.length === 0) {
          groups.splice(origGi, 1);
        } else {
          groups[origGi] = { ...groups[origGi], hooks };
        }

        if (groups.length === 0) {
          delete updated[origEvent];
        } else {
          updated[origEvent] = groups;
        }

        return updated;
      });
    },
    [mutateGlobal],
  );

  return { hooks, loading, error, add, update, remove, reload };
}
