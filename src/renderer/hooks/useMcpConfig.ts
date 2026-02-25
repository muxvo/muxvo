/**
 * useMcpConfig — Read/write MCP server configurations from multiple sources
 *
 * Sources:
 *   Global (writable):   ~/.claude.json
 *   Project (read-only): {cwd}/.mcp.json
 *   Desktop (read-only): ~/Library/Application Support/Claude/claude_desktop_config.json
 *   Codex (read-only):   ~/.codex/config.toml
 *   Gemini (read-only):  ~/.gemini/settings.json
 *   Codex project (read-only): {cwd}/.codex/config.toml
 *   Gemini project (read-only): {cwd}/.gemini/settings.json
 */

import { useState, useEffect, useCallback } from 'react';
import { parse as parseToml } from '@iarna/toml';
import type { McpServerConfig, McpServerType, McpConfigScope } from '@/shared/types/mcp.types';

interface UseMcpConfigReturn {
  servers: McpServerConfig[];
  loading: boolean;
  error: string | null;
  add: (server: Omit<McpServerConfig, 'scope' | 'configPath'>) => Promise<void>;
  update: (name: string, server: Omit<McpServerConfig, 'scope' | 'configPath'>) => Promise<void>;
  remove: (name: string) => Promise<void>;
  reload: () => void;
}

/** Determine server type from its raw config object */
function inferType(raw: Record<string, unknown>): McpServerType {
  if (raw.url) return typeof raw.url === 'string' && raw.url.includes('/sse') ? 'sse' : 'http';
  return 'stdio';
}

/** Parse mcpServers object from a raw config JSON */
function parseMcpServers(
  raw: Record<string, unknown>,
  scope: McpConfigScope,
  configPath: string,
): McpServerConfig[] {
  const mcpServers = (raw.mcpServers ?? raw) as Record<string, Record<string, unknown>>;
  if (!mcpServers || typeof mcpServers !== 'object') return [];

  return Object.entries(mcpServers)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([name, cfg]) => {
      const type = inferType(cfg);
      return {
        name,
        type,
        scope,
        command: cfg.command as string | undefined,
        args: cfg.args as string[] | undefined,
        env: cfg.env as Record<string, string> | undefined,
        url: cfg.url as string | undefined,
        headers: cfg.headers as Record<string, string> | undefined,
        configPath,
      };
    });
}

/** Read and parse a config file (JSON or TOML), return empty array on failure */
async function readConfigFile(
  filePath: string,
  scope: McpConfigScope,
): Promise<McpServerConfig[]> {
  try {
    const result = await window.api.fs.readFile(filePath);
    if (!result?.success || !result.data?.content) return [];

    let raw: Record<string, unknown>;
    if (filePath.endsWith('.toml')) {
      const parsed = parseToml(result.data.content) as Record<string, unknown>;
      // Codex TOML uses mcp_servers (underscore) as key
      raw = { mcpServers: parsed.mcp_servers ?? {} };
    } else {
      raw = JSON.parse(result.data.content);
    }
    return parseMcpServers(raw, scope, filePath);
  } catch {
    return [];
  }
}

export function useMcpConfig(projectCwd?: string): UseMcpConfigReturn {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const homePath = window.api.app.getHomePath();
  const globalPath = `${homePath}/.claude.json`;
  const desktopPath = `${homePath}/Library/Application Support/Claude/claude_desktop_config.json`;
  const codexGlobalPath = `${homePath}/.codex/config.toml`;
  const geminiGlobalPath = `${homePath}/.gemini/settings.json`;

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const promises: Promise<McpServerConfig[]>[] = [
      readConfigFile(globalPath, 'global'),
      readConfigFile(desktopPath, 'desktop'),
      readConfigFile(codexGlobalPath, 'codex'),
      readConfigFile(geminiGlobalPath, 'gemini'),
    ];

    if (projectCwd) {
      promises.push(readConfigFile(`${projectCwd}/.mcp.json`, 'project'));
      promises.push(readConfigFile(`${projectCwd}/.codex/config.toml`, 'codex-project'));
      promises.push(readConfigFile(`${projectCwd}/.gemini/settings.json`, 'gemini-project'));
    }

    Promise.all(promises)
      .then((results) => {
        if (cancelled) return;
        setServers(results.flat());
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [globalPath, desktopPath, codexGlobalPath, geminiGlobalPath, projectCwd, reloadKey]);

  /** Read global config, apply mutation, write back */
  const mutateGlobal = useCallback(
    async (mutator: (mcpServers: Record<string, unknown>) => Record<string, unknown>) => {
      let json: Record<string, unknown> = {};
      try {
        const result = await window.api.fs.readFile(globalPath);
        if (result?.success && result.data?.content) {
          json = JSON.parse(result.data.content);
        }
      } catch { /* file may not exist */ }

      const mcpServers = (json.mcpServers ?? {}) as Record<string, unknown>;
      json.mcpServers = mutator(mcpServers);

      const writeResult = await window.api.fs.writeFile(globalPath, JSON.stringify(json, null, 2));
      if (!writeResult?.success) {
        throw new Error('Failed to write MCP config');
      }
      reload();
    },
    [globalPath, reload],
  );

  const add = useCallback(
    async (server: Omit<McpServerConfig, 'scope' | 'configPath'>) => {
      await mutateGlobal((mcpServers) => {
        const entry: Record<string, unknown> = {};
        if (server.type === 'stdio') {
          if (server.command) entry.command = server.command;
          if (server.args?.length) entry.args = server.args;
        } else {
          if (server.url) entry.url = server.url;
          if (server.headers && Object.keys(server.headers).length) entry.headers = server.headers;
        }
        if (server.env && Object.keys(server.env).length) entry.env = server.env;
        return { ...mcpServers, [server.name]: entry };
      });
    },
    [mutateGlobal],
  );

  const update = useCallback(
    async (originalName: string, server: Omit<McpServerConfig, 'scope' | 'configPath'>) => {
      await mutateGlobal((mcpServers) => {
        const updated = { ...mcpServers };
        // Remove old name if renamed
        if (originalName !== server.name) {
          delete updated[originalName];
        }
        const entry: Record<string, unknown> = {};
        if (server.type === 'stdio') {
          if (server.command) entry.command = server.command;
          if (server.args?.length) entry.args = server.args;
        } else {
          if (server.url) entry.url = server.url;
          if (server.headers && Object.keys(server.headers).length) entry.headers = server.headers;
        }
        if (server.env && Object.keys(server.env).length) entry.env = server.env;
        updated[server.name] = entry;
        return updated;
      });
    },
    [mutateGlobal],
  );

  const remove = useCallback(
    async (name: string) => {
      await mutateGlobal((mcpServers) => {
        const updated = { ...mcpServers };
        delete updated[name];
        return updated;
      });
    },
    [mutateGlobal],
  );

  return { servers, loading, error, add, update, remove, reload };
}
