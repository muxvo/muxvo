/**
 * Codex Chat Source Reader
 *
 * Reads Codex chat sessions from ~/.codex/sessions/YYYY/MM/DD/*.jsonl
 * and converts them to Muxvo's unified SessionMessage format.
 *
 * API mirrors chat-dual-source.ts for use with chat-multi-source aggregator.
 */

import { promises as fsp, createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join, basename } from 'path';
import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
  SearchResult,
  AssistantContentBlock,
} from '@/shared/types/chat.types';

interface CodexChatReaderOpts {
  codexBasePath: string; // ~/.codex
}

/** Session index entry: UUID → file metadata */
interface SessionIndexEntry {
  filePath: string;
  sessionId: string;
  mtime: number;
  size: number;
  cwd: string;
  title: string;
}

/** Encode cwd to CC-compatible projectHash: /Users/rl/path → -Users-rl-path
 *  Must match CC's encoding: replace all non-alphanumeric-non-dash chars with '-' */
function encodeProjectHash(cwd: string): string {
  if (!cwd) return '';
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Extract UUID from Codex session filename: rollout-YYYY-MM-DDTHH-MM-SS-{UUID}.jsonl */
function extractSessionId(filename: string): string {
  // UUID is the last 36 chars before .jsonl (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const base = basename(filename, '.jsonl');
  const parts = base.split('-');
  // UUID has 5 groups joined by -, take last 5 groups
  if (parts.length >= 5) {
    return parts.slice(-5).join('-');
  }
  return base;
}

/** Read first line of a file to get session_meta */
async function readSessionMeta(
  filePath: string,
): Promise<{ id: string; cwd: string; timestamp: string } | null> {
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'session_meta' && entry.payload) {
          rl.close();
          return {
            id: entry.payload.id || '',
            cwd: entry.payload.cwd || '',
            timestamp: entry.payload.timestamp || entry.timestamp || '',
          };
        }
      } catch {
        // skip malformed line
      }
      rl.close();
      break;
    }
  } catch {
    // file not readable
  }
  return null;
}

/** Parse a single Codex JSONL line into SessionMessage or null */
function parseCodexMessageLine(
  entry: Record<string, unknown>,
  sessionId: string,
  cwd: string,
  lineIndex: number,
): SessionMessage | null {
  const timestamp = (entry.timestamp as string) || '';
  const type = entry.type as string;
  const payload = entry.payload as Record<string, unknown>;
  if (!payload) return null;

  const payloadType = payload.type as string;

  // 1. User message: event_msg + user_message
  if (type === 'event_msg' && payloadType === 'user_message') {
    const message = (payload.message as string) || '';
    if (!message) return null;
    return {
      uuid: `codex-${sessionId}-user-${lineIndex}`,
      type: 'user',
      sessionId,
      cwd,
      timestamp,
      content: message,
    };
  }

  // 2. Agent reply: event_msg + agent_message
  if (type === 'event_msg' && payloadType === 'agent_message') {
    const message = (payload.message as string) || '';
    if (!message) return null;
    return {
      uuid: `codex-${sessionId}-agent-${lineIndex}`,
      type: 'assistant',
      sessionId,
      cwd,
      timestamp,
      content: message,
    };
  }

  // 3. Tool call: response_item + function_call / custom_tool_call
  if (
    type === 'response_item' &&
    (payloadType === 'function_call' || payloadType === 'custom_tool_call')
  ) {
    const name = (payload.name as string) || payloadType;
    const input =
      payloadType === 'function_call' ? payload.arguments : payload.input;
    return {
      uuid: (payload.call_id as string) || `codex-${sessionId}-tool-${lineIndex}`,
      type: 'assistant',
      sessionId,
      cwd,
      timestamp,
      content: [{ type: 'tool_use', name, input }] as AssistantContentBlock[],
    };
  }

  // 4. Tool result: response_item + function_call_output / custom_tool_call_output
  if (
    type === 'response_item' &&
    (payloadType === 'function_call_output' ||
      payloadType === 'custom_tool_call_output')
  ) {
    const output = (payload.output as string) || '';
    return {
      uuid: `codex-${sessionId}-result-${lineIndex}`,
      type: 'assistant',
      sessionId,
      cwd,
      timestamp,
      content: [
        {
          type: 'tool_result',
          content: output,
          tool_use_id: payload.call_id as string,
        },
      ] as AssistantContentBlock[],
    };
  }

  // Skip: session_meta, turn_context, token_count, reasoning, agent_reasoning, etc.
  return null;
}

export function createCodexChatReader(opts: CodexChatReaderOpts) {
  const sessionsDir = join(opts.codexBasePath, 'sessions');
  const globalStatePath = join(opts.codexBasePath, '.codex-global-state.json');

  // Cache
  const CACHE_TTL = 5 * 60 * 1000;
  let indexCache: { data: SessionIndexEntry[]; expiry: number } = {
    data: [],
    expiry: 0,
  };
  let threadTitlesCache: {
    data: Record<string, string>;
    expiry: number;
  } = { data: {}, expiry: 0 };

  /** Read thread titles from .codex-global-state.json */
  async function getThreadTitles(): Promise<Record<string, string>> {
    if (Date.now() < threadTitlesCache.expiry) return threadTitlesCache.data;
    try {
      const raw = await fsp.readFile(globalStatePath, 'utf-8');
      const state = JSON.parse(raw);
      const titles = state?.['thread-titles']?.titles || {};
      threadTitlesCache = { data: titles, expiry: Date.now() + CACHE_TTL };
      return titles;
    } catch {
      return {};
    }
  }

  /** Recursively find all .jsonl files under sessions/ */
  async function findAllSessionFiles(): Promise<string[]> {
    const files: string[] = [];
    try {
      // sessions/YYYY/
      const years = await fsp.readdir(sessionsDir);
      for (const year of years) {
        if (!/^\d{4}$/.test(year)) continue;
        const yearDir = join(sessionsDir, year);
        try {
          const months = await fsp.readdir(yearDir);
          for (const month of months) {
            if (!/^\d{2}$/.test(month)) continue;
            const monthDir = join(yearDir, month);
            try {
              const days = await fsp.readdir(monthDir);
              for (const day of days) {
                if (!/^\d{2}$/.test(day)) continue;
                const dayDir = join(monthDir, day);
                try {
                  const entries = await fsp.readdir(dayDir);
                  for (const entry of entries) {
                    if (entry.endsWith('.jsonl')) {
                      files.push(join(dayDir, entry));
                    }
                  }
                } catch {
                  // skip unreadable day dir
                }
              }
            } catch {
              // skip unreadable month dir
            }
          }
        } catch {
          // skip unreadable year dir
        }
      }
    } catch {
      // sessions dir doesn't exist
    }
    return files;
  }

  /** Build session index: scan all files, read session_meta for cwd */
  async function buildIndex(): Promise<SessionIndexEntry[]> {
    if (Date.now() < indexCache.expiry) return indexCache.data;

    const files = await findAllSessionFiles();
    const titles = await getThreadTitles();
    const entries: SessionIndexEntry[] = [];

    for (const filePath of files) {
      try {
        const fileStat = await fsp.stat(filePath);
        const sessionId = extractSessionId(basename(filePath));
        const meta = await readSessionMeta(filePath);
        const cwd = meta?.cwd || '';
        const title =
          titles[sessionId] ||
          titles[meta?.id || ''] ||
          '';

        entries.push({
          filePath,
          sessionId: meta?.id || sessionId,
          mtime: fileStat.mtimeMs,
          size: fileStat.size,
          cwd,
          title,
        });
      } catch {
        // skip unreadable files
      }
    }

    indexCache = { data: entries, expiry: Date.now() + CACHE_TTL };
    return entries;
  }

  return {
    async getProjects(): Promise<ProjectInfo[]> {
      const entries = await buildIndex();
      // Group by cwd → project
      const projectMap = new Map<
        string,
        { cwd: string; count: number; lastActivity: number }
      >();

      for (const entry of entries) {
        const key = entry.cwd || 'unknown';
        const existing = projectMap.get(key);
        if (existing) {
          existing.count++;
          existing.lastActivity = Math.max(existing.lastActivity, entry.mtime);
        } else {
          projectMap.set(key, {
            cwd: entry.cwd,
            count: 1,
            lastActivity: entry.mtime,
          });
        }
      }

      const projects: ProjectInfo[] = [];
      for (const [, value] of projectMap) {
        const hash = encodeProjectHash(value.cwd);
        const displayPath = value.cwd || 'Unknown';
        const parts = displayPath.split('/').filter(Boolean);
        projects.push({
          projectHash: hash,
          displayPath,
          displayName: parts[parts.length - 1] || 'Unknown',
          sessionCount: value.count,
          lastActivity: value.lastActivity,
          source: 'codex',
        });
      }

      return projects.sort((a, b) => b.lastActivity - a.lastActivity);
    },

    async getSessionsForProject(
      projectHash: string,
      limit = 50,
    ): Promise<SessionSummary[]> {
      const entries = await buildIndex();
      const titles = await getThreadTitles();

      const matching = entries
        .filter((e) => encodeProjectHash(e.cwd) === projectHash)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      const summaries: SessionSummary[] = [];
      for (const entry of matching) {
        // Get title: prefer global state, then try first user message
        let title = entry.title || titles[entry.sessionId] || '';
        if (!title) {
          title = await this._extractFirstUserMessage(entry.filePath);
        }

        summaries.push({
          sessionId: entry.sessionId,
          projectHash,
          title: title || entry.sessionId,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: 'codex',
        });
      }

      return summaries;
    },

    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      const entries = await buildIndex();
      const titles = await getThreadTitles();

      const sorted = [...entries].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      const summaries: SessionSummary[] = [];

      for (const entry of sorted) {
        const projectHash = encodeProjectHash(entry.cwd);
        const title = entry.title || titles[entry.sessionId] || entry.sessionId;

        summaries.push({
          sessionId: entry.sessionId,
          projectHash,
          title,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: 'codex',
        });
      }

      return summaries;
    },

    async readSession(
      _projectHash: string,
      sessionId: string,
      options?: { limit?: number },
    ): Promise<SessionMessage[]> {
      const entries = await buildIndex();
      const entry = entries.find((e) => e.sessionId === sessionId);
      if (!entry) return [];

      const messages: SessionMessage[] = [];
      let lineIndex = 0;
      const cwd = entry.cwd;

      const rl = createInterface({
        input: createReadStream(entry.filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const msg = parseCodexMessageLine(parsed, sessionId, cwd, lineIndex);
          if (msg) messages.push(msg);
        } catch {
          // skip malformed lines
        }
        lineIndex++;
      }

      if (options?.limit && options.limit > 0) {
        return messages.slice(-options.limit);
      }
      return messages;
    },

    async search(query: string): Promise<SearchResult[]> {
      const entries = await buildIndex();
      const results: SearchResult[] = [];
      const lowerQuery = query.toLowerCase();

      for (const entry of entries) {
        try {
          const rl = createInterface({
            input: createReadStream(entry.filePath, { encoding: 'utf-8' }),
            crlfDelay: Infinity,
          });

          for await (const line of rl) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (
                parsed.type === 'event_msg' &&
                parsed.payload?.type === 'user_message'
              ) {
                const message = (parsed.payload.message as string) || '';
                if (message.toLowerCase().includes(lowerQuery)) {
                  const start = message.toLowerCase().indexOf(lowerQuery);
                  const snippet = message.slice(
                    Math.max(0, start - 30),
                    start + query.length + 30,
                  );
                  results.push({
                    projectHash: encodeProjectHash(entry.cwd),
                    sessionId: entry.sessionId,
                    snippet,
                    timestamp: (parsed.timestamp as string) || '',
                  });
                  break; // One match per session
                }
              }
            } catch {
              // skip
            }
          }
        } catch {
          // skip unreadable files
        }

        if (results.length >= 50) break;
      }

      return results;
    },

    /** Extract first user message text from a session file (for title) */
    async _extractFirstUserMessage(filePath: string): Promise<string> {
      try {
        const rl = createInterface({
          input: createReadStream(filePath, { encoding: 'utf-8' }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (
              entry.type === 'event_msg' &&
              entry.payload?.type === 'user_message'
            ) {
              rl.close();
              return ((entry.payload.message as string) || '').slice(0, 100);
            }
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
      return '';
    },

    clearCache() {
      indexCache = { data: [], expiry: 0 };
      threadTitlesCache = { data: {}, expiry: 0 };
    },
  };
}
