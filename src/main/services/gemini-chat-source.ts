/**
 * Gemini CLI Chat Source Reader
 *
 * Reads Gemini CLI chat sessions from ~/.gemini/tmp/<project_folder_name>/chats/*.json
 * and converts them to Muxvo's unified SessionMessage format.
 *
 * API mirrors codex-chat-source.ts for use with chat-multi-source aggregator.
 *
 * Actual Gemini CLI data format (verified):
 * - Project dirs: ~/.gemini/tmp/<project_folder_name>/ (not SHA-256 hash)
 * - cwd: read from .project_root file in project dir
 * - Session JSON: { sessionId, projectHash, startTime, lastUpdated, messages: [...] }
 * - Messages use { type: "user"|"gemini", content: ... }
 * - User content: [{ text: "..." }] (array of objects)
 * - Gemini content: "plain string"
 */

import { promises as fsp } from 'fs';
import { join, basename } from 'path';
import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
  SearchResult,
} from '@/shared/types/chat.types';

interface GeminiChatReaderOpts {
  geminiBasePath: string; // ~/.gemini
}

/** Session index entry */
interface SessionIndexEntry {
  filePath: string;
  sessionId: string;
  mtime: number; // file mtime (lightweight, no JSON read needed)
  size: number;
  cwd: string;
  folderName: string; // Project folder name under tmp/
  title: string;
}

/** Encode cwd to CC-compatible projectHash: /Users/rl/path → -Users-rl-path */
function encodeProjectHash(cwd: string): string {
  if (!cwd) return '';
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Extract text from user content (array of {text} objects) */
function extractTextFromUserContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p): p is { text: string } => typeof p === 'object' && p !== null && 'text' in p)
    .map((p) => p.text)
    .join('\n');
}

/**
 * Read cwd from .project_root file in a Gemini project temp directory.
 * .project_root contains the full absolute path to the project root.
 */
async function extractCwdFromGeminiProject(projectDir: string): Promise<string | null> {
  const projectRootPath = join(projectDir, '.project_root');
  try {
    const cwd = (await fsp.readFile(projectRootPath, 'utf-8')).trim();
    if (cwd) return cwd;
  } catch {
    // .project_root doesn't exist
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

  /** Find all project directories under tmp/ */
  async function findProjectDirs(): Promise<Array<{ dir: string; folderName: string }>> {
    const dirs: Array<{ dir: string; folderName: string }> = [];
    try {
      const entries = await fsp.readdir(tmpDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push({ dir: join(tmpDir, entry.name), folderName: entry.name });
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
      const messages = data?.messages || [];

      for (const msg of messages) {
        if (msg?.type === 'user') {
          const text = extractTextFromUserContent(msg.content);
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

    for (const { dir: projectDir, folderName } of projectDirs) {
      const cwd = (await extractCwdFromGeminiProject(projectDir)) || '';
      const chatFiles = await findChatFiles(projectDir);

      for (const filePath of chatFiles) {
        try {
          const fileStat = await fsp.stat(filePath);
          // Use filename as sessionId (lightweight, no JSON read)
          const sessionId = basename(filePath, '.json');

          entries.push({
            filePath,
            sessionId: `gemini-${sessionId}`,
            mtime: fileStat.mtimeMs,
            size: fileStat.size,
            cwd,
            folderName,
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

      // Group by cwd (or folderName if cwd unknown)
      const projectMap = new Map<
        string,
        { cwd: string; folderName: string; count: number; totalSize: number; lastActivity: number }
      >();

      for (const entry of entries) {
        const key = entry.cwd || entry.folderName;
        const existing = projectMap.get(key);
        if (existing) {
          existing.count++;
          existing.totalSize += entry.size;
          existing.lastActivity = Math.max(existing.lastActivity, entry.mtime);
        } else {
          projectMap.set(key, {
            cwd: entry.cwd,
            folderName: entry.folderName,
            count: 1,
            totalSize: entry.size,
            lastActivity: entry.mtime,
          });
        }
      }

      const projects: ProjectInfo[] = [];
      for (const [, value] of projectMap) {
        // Use CC-compatible projectHash if cwd is known, otherwise use folder name prefix
        const hash = value.cwd
          ? encodeProjectHash(value.cwd)
          : `gemini-${value.folderName}`;
        const displayPath = value.cwd || `Gemini (${value.folderName})`;
        const parts = displayPath.split('/').filter(Boolean);
        projects.push({
          projectHash: hash,
          displayPath,
          displayName: value.cwd ? parts[parts.length - 1] || 'Unknown' : `Gemini ${value.folderName}`,
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
            : `gemini-${e.folderName}`;
          return hash === projectHash;
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      return Promise.all(matching.map(async (entry) => {
        const title = entry.title || await extractFirstUserMessage(entry.filePath);
        const hash = entry.cwd
          ? encodeProjectHash(entry.cwd)
          : `gemini-${entry.folderName}`;
        return {
          sessionId: entry.sessionId,
          projectHash: hash,
          title: title || entry.sessionId,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: 'gemini' as const,
        };
      }));
    },

    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      const entries = await buildIndex();
      const sorted = [...entries].sort((a, b) => b.mtime - a.mtime).slice(0, limit);

      return Promise.all(sorted.map(async (entry) => {
        const title = entry.title || await extractFirstUserMessage(entry.filePath);
        const hash = entry.cwd
          ? encodeProjectHash(entry.cwd)
          : `gemini-${entry.folderName}`;
        return {
          sessionId: entry.sessionId,
          projectHash: hash,
          title: title || entry.sessionId,
          startedAt: new Date(entry.mtime).toISOString(),
          lastModified: entry.mtime,
          fileSize: entry.size,
          source: 'gemini' as const,
        };
      }));
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
        const msgArray = data?.messages || [];

        for (let i = 0; i < msgArray.length; i++) {
          const msg = msgArray[i];
          if (!msg || !msg.type) continue;

          const timestamp = msg.timestamp || new Date(entry.mtime).toISOString();
          const uuid = msg.id ? `gemini-${msg.id}` : `gemini-${sessionId}-${i}`;

          if (msg.type === 'user') {
            const text = extractTextFromUserContent(msg.content);
            if (!text) continue;
            messages.push({
              uuid,
              type: 'user',
              sessionId,
              cwd: entry.cwd,
              timestamp,
              content: text,
            });
          } else if (msg.type === 'gemini') {
            // Gemini model replies: content is a plain string
            const text = typeof msg.content === 'string'
              ? msg.content
              : extractTextFromUserContent(msg.content);
            if (!text) continue;
            messages.push({
              uuid,
              type: 'assistant',
              sessionId,
              cwd: entry.cwd,
              timestamp,
              content: text,
            });
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
          const msgArray = data?.messages || [];

          for (const msg of msgArray) {
            if (msg?.type === 'user') {
              const text = extractTextFromUserContent(msg.content);
              if (text.toLowerCase().includes(lowerQuery)) {
                const start = text.toLowerCase().indexOf(lowerQuery);
                const snippet = text.slice(
                  Math.max(0, start - 30),
                  start + query.length + 30,
                );
                const hash = entry.cwd
                  ? encodeProjectHash(entry.cwd)
                  : `gemini-${entry.folderName}`;
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
