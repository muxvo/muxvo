/**
 * Gemini CLI Chat Source Reader
 *
 * Reads Gemini CLI chat sessions from ~/.gemini/tmp/<project_hash>/chats/*.json
 * and converts them to Muxvo's unified SessionMessage format.
 *
 * API mirrors codex-chat-source.ts for use with chat-multi-source aggregator.
 *
 * Key differences from CC/Codex:
 * - Session files are JSON (not JSONL)
 * - Messages use { role: "user"|"model", parts: [...] }
 * - project_hash is SHA-256 of project root (not cwd encoding)
 * - cwd must be discovered from logs.json or inferred
 */

import { promises as fsp } from 'fs';
import { join, basename } from 'path';
import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
  SearchResult,
  AssistantContentBlock,
} from '@/shared/types/chat.types';

interface GeminiChatReaderOpts {
  geminiBasePath: string; // ~/.gemini
}

/** Session index entry */
interface SessionIndexEntry {
  filePath: string;
  sessionId: string;
  mtime: number;
  size: number;
  cwd: string;
  geminiHash: string; // Original SHA-256 project hash directory name
  title: string;
}

/** Encode cwd to CC-compatible projectHash: /Users/rl/path → -Users-rl-path */
function encodeProjectHash(cwd: string): string {
  if (!cwd) return '';
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Extract text content from Gemini message parts */
function extractTextFromParts(parts: unknown[]): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { text: string } => typeof p === 'object' && p !== null && 'text' in p)
    .map((p) => p.text)
    .join('\n');
}

/** Parse Gemini parts into AssistantContentBlock[] for tool calls */
function parseGeminiParts(parts: unknown[]): AssistantContentBlock[] {
  if (!Array.isArray(parts)) return [{ type: 'text', text: '' }];

  const blocks: AssistantContentBlock[] = [];
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Record<string, unknown>;

    if ('text' in p && typeof p.text === 'string') {
      blocks.push({ type: 'text', text: p.text });
    } else if ('functionCall' in p) {
      const fc = p.functionCall as Record<string, unknown>;
      blocks.push({
        type: 'tool_use',
        name: (fc.name as string) || 'unknown',
        input: fc.args,
      });
    } else if ('functionResponse' in p) {
      const fr = p.functionResponse as Record<string, unknown>;
      blocks.push({
        type: 'tool_result',
        content: fr.response,
        tool_use_id: fr.name as string,
      });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
}

/**
 * Try to read cwd from logs.json in a Gemini project temp directory.
 * Gemini stores logs.json alongside chats/ in the project hash dir.
 * We look for cwd-like paths in the data.
 */
async function extractCwdFromGeminiProject(projectDir: string): Promise<string | null> {
  const logsPath = join(projectDir, 'logs.json');
  try {
    const raw = await fsp.readFile(logsPath, 'utf-8');
    const data = JSON.parse(raw);

    // logs.json may contain a cwd or projectRoot field
    if (typeof data === 'object' && data !== null) {
      if (data.cwd) return data.cwd;
      if (data.projectRoot) return data.projectRoot;
      if (data.workingDirectory) return data.workingDirectory;
    }

    // If it's an array (log entries), look for cwd in entries
    if (Array.isArray(data)) {
      for (const entry of data.slice(0, 20)) {
        if (typeof entry === 'object' && entry !== null) {
          if (entry.cwd) return entry.cwd;
          if (entry.projectRoot) return entry.projectRoot;
        }
      }
    }
  } catch {
    // logs.json doesn't exist or is not parseable
  }

  // Try reading .gemini-project-info or similar metadata
  const infoPath = join(projectDir, 'project-info.json');
  try {
    const raw = await fsp.readFile(infoPath, 'utf-8');
    const info = JSON.parse(raw);
    if (info.cwd) return info.cwd;
    if (info.projectRoot) return info.projectRoot;
  } catch {
    // not found
  }

  return null;
}

export function createGeminiChatReader(opts: GeminiChatReaderOpts) {
  const tmpDir = join(opts.geminiBasePath, 'tmp');

  // Cache
  const CACHE_TTL = 5 * 60 * 1000;
  let indexCache: { data: SessionIndexEntry[]; expiry: number } = {
    data: [],
    expiry: 0,
  };

  /** Find all project hash directories under tmp/ */
  async function findProjectDirs(): Promise<Array<{ dir: string; hash: string }>> {
    const dirs: Array<{ dir: string; hash: string }> = [];
    try {
      const entries = await fsp.readdir(tmpDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push({ dir: join(tmpDir, entry.name), hash: entry.name });
        }
      }
    } catch {
      // tmp dir doesn't exist
    }
    return dirs;
  }

  /** Find all chat session JSON files under a project's chats/ directory */
  async function findChatFiles(projectDir: string): Promise<string[]> {
    const chatsDir = join(projectDir, 'chats');
    const files: string[] = [];
    try {
      const entries = await fsp.readdir(chatsDir);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          files.push(join(chatsDir, entry));
        }
      }
    } catch {
      // chats dir doesn't exist
    }
    return files;
  }

  /** Extract first user message text from a session JSON file for title */
  async function extractFirstUserMessage(filePath: string): Promise<string> {
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const messages = Array.isArray(data) ? data : data?.messages || data?.history || [];

      for (const msg of messages) {
        if (msg?.role === 'user') {
          const text = extractTextFromParts(msg.parts || []);
          return text.slice(0, 100);
        }
      }
    } catch {
      // skip
    }
    return '';
  }

  /** Build session index */
  async function buildIndex(): Promise<SessionIndexEntry[]> {
    if (Date.now() < indexCache.expiry) return indexCache.data;

    const projectDirs = await findProjectDirs();
    const entries: SessionIndexEntry[] = [];

    for (const { dir: projectDir, hash: geminiHash } of projectDirs) {
      const cwd = (await extractCwdFromGeminiProject(projectDir)) || '';
      const chatFiles = await findChatFiles(projectDir);

      for (const filePath of chatFiles) {
        try {
          const fileStat = await fsp.stat(filePath);
          const sessionId = basename(filePath, '.json');

          entries.push({
            filePath,
            sessionId: `gemini-${sessionId}`,
            mtime: fileStat.mtimeMs,
            size: fileStat.size,
            cwd,
            geminiHash,
            title: '',
          });
        } catch {
          // skip unreadable files
        }
      }
    }

    indexCache = { data: entries, expiry: Date.now() + CACHE_TTL };
    return entries;
  }

  return {
    async getProjects(): Promise<ProjectInfo[]> {
      const entries = await buildIndex();

      // Group by geminiHash (since cwd might not be available for all)
      const projectMap = new Map<
        string,
        { cwd: string; geminiHash: string; count: number; totalSize: number; lastActivity: number }
      >();

      for (const entry of entries) {
        const key = entry.geminiHash;
        const existing = projectMap.get(key);
        if (existing) {
          existing.count++;
          existing.totalSize += entry.size;
          existing.lastActivity = Math.max(existing.lastActivity, entry.mtime);
        } else {
          projectMap.set(key, {
            cwd: entry.cwd,
            geminiHash: entry.geminiHash,
            count: 1,
            totalSize: entry.size,
            lastActivity: entry.mtime,
          });
        }
      }

      const projects: ProjectInfo[] = [];
      for (const [, value] of projectMap) {
        // Use CC-compatible projectHash if cwd is known, otherwise use gemini hash prefix
        const hash = value.cwd
          ? encodeProjectHash(value.cwd)
          : `gemini-${value.geminiHash.slice(0, 16)}`;
        const displayPath = value.cwd || `Gemini (${value.geminiHash.slice(0, 8)}...)`;
        const parts = displayPath.split('/').filter(Boolean);
        projects.push({
          projectHash: hash,
          displayPath,
          displayName: value.cwd ? parts[parts.length - 1] || 'Unknown' : `Gemini ${value.geminiHash.slice(0, 8)}`,
          sessionCount: value.count,
          totalSize: value.totalSize,
          lastActivity: value.lastActivity,
          source: 'gemini',
        });
      }

      return projects.sort((a, b) => b.lastActivity - a.lastActivity);
    },

    async getSessionsForProject(
      projectHash: string,
      limit = 50,
    ): Promise<SessionSummary[]> {
      const entries = await buildIndex();

      const matching = entries
        .filter((e) => {
          const hash = e.cwd
            ? encodeProjectHash(e.cwd)
            : `gemini-${e.geminiHash.slice(0, 16)}`;
          return hash === projectHash;
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      const summaries: SessionSummary[] = [];
      for (const entry of matching) {
        let title = entry.title;
        if (!title) {
          title = await extractFirstUserMessage(entry.filePath);
        }
        const hash = entry.cwd
          ? encodeProjectHash(entry.cwd)
          : `gemini-${entry.geminiHash.slice(0, 16)}`;

        summaries.push({
          sessionId: entry.sessionId,
          projectHash: hash,
          title: title || entry.sessionId,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: 'gemini',
        });
      }

      return summaries;
    },

    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      const entries = await buildIndex();
      const sorted = [...entries].sort((a, b) => b.mtime - a.mtime).slice(0, limit);

      const summaries: SessionSummary[] = [];
      for (const entry of sorted) {
        let title = entry.title;
        if (!title) {
          title = await extractFirstUserMessage(entry.filePath);
        }
        const hash = entry.cwd
          ? encodeProjectHash(entry.cwd)
          : `gemini-${entry.geminiHash.slice(0, 16)}`;

        summaries.push({
          sessionId: entry.sessionId,
          projectHash: hash,
          title: title || entry.sessionId,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: 'gemini',
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
      try {
        const raw = await fsp.readFile(entry.filePath, 'utf-8');
        const data = JSON.parse(raw);
        const msgArray = Array.isArray(data) ? data : data?.messages || data?.history || [];

        for (let i = 0; i < msgArray.length; i++) {
          const msg = msgArray[i];
          if (!msg || !msg.role) continue;

          const parts = msg.parts || [];
          const timestamp = msg.timestamp || msg.createTime || new Date(entry.mtime).toISOString();

          if (msg.role === 'user') {
            const text = extractTextFromParts(parts);
            if (!text) continue;
            messages.push({
              uuid: `gemini-${sessionId}-user-${i}`,
              type: 'user',
              sessionId,
              cwd: entry.cwd,
              timestamp,
              content: text,
            });
          } else if (msg.role === 'model') {
            // Model messages may contain text, tool calls, or both
            const blocks = parseGeminiParts(parts);
            const hasOnlyText = blocks.every((b) => b.type === 'text');

            if (hasOnlyText) {
              const text = blocks.map((b) => b.text || '').join('\n');
              if (!text) continue;
              messages.push({
                uuid: `gemini-${sessionId}-model-${i}`,
                type: 'assistant',
                sessionId,
                cwd: entry.cwd,
                timestamp,
                content: text,
              });
            } else {
              messages.push({
                uuid: `gemini-${sessionId}-model-${i}`,
                type: 'assistant',
                sessionId,
                cwd: entry.cwd,
                timestamp,
                content: blocks,
              });
            }
          }
        }
      } catch {
        // skip unreadable/malformed files
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
          const raw = await fsp.readFile(entry.filePath, 'utf-8');
          const data = JSON.parse(raw);
          const msgArray = Array.isArray(data) ? data : data?.messages || data?.history || [];

          for (const msg of msgArray) {
            if (msg?.role === 'user') {
              const text = extractTextFromParts(msg.parts || []);
              if (text.toLowerCase().includes(lowerQuery)) {
                const start = text.toLowerCase().indexOf(lowerQuery);
                const snippet = text.slice(
                  Math.max(0, start - 30),
                  start + query.length + 30,
                );
                const hash = entry.cwd
                  ? encodeProjectHash(entry.cwd)
                  : `gemini-${entry.geminiHash.slice(0, 16)}`;
                results.push({
                  projectHash: hash,
                  sessionId: entry.sessionId,
                  snippet,
                  timestamp: msg.timestamp || '',
                });
                break; // One match per session
              }
            }
          }
        } catch {
          // skip
        }

        if (results.length >= 50) break;
      }

      return results;
    },

    clearCache() {
      indexCache = { data: [], expiry: 0 };
    },
  };
}
