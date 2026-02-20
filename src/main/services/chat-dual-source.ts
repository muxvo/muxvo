/**
 * Chat Project Reader
 *
 * Scans ~/.claude/projects/ to build project/session/message data.
 */

import { promises as fsp, createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join, basename } from 'path';
import { parseJsonl } from './jsonl-parser';
import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
  SearchResult,
} from '@/shared/types/chat.types';

interface ChatProjectReaderOpts {
  ccBasePath: string;
}

export function createChatProjectReader(opts: ChatProjectReaderOpts) {
  const projectsDir = join(opts.ccBasePath, 'projects');

  // Memory cache
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const projectsCache = { data: null as ProjectInfo[] | null, expiry: 0 };
  const summaryCache = new Map<string, { data: SessionSummary; expiry: number }>();

  function clearProjectsCache() {
    projectsCache.data = null;
    projectsCache.expiry = 0;
  }

  function clearSummaryCache(projectHash?: string) {
    if (projectHash) {
      // Clear only matching entries
      for (const [key] of summaryCache) {
        if (key.startsWith(projectHash + '/')) {
          summaryCache.delete(key);
        }
      }
    } else {
      summaryCache.clear();
    }
  }

  /**
   * Read the first N lines of a file using streaming (without reading the entire file).
   */
  async function readFirstLines(filePath: string, maxLines: number): Promise<string[]> {
    return new Promise((resolve) => {
      const lines: string[] = [];
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        lines.push(line);
        if (lines.length >= maxLines) {
          rl.close();
          stream.destroy();
        }
      });

      rl.on('close', () => resolve(lines));
      stream.on('error', () => resolve(lines));
    });
  }

  /**
   * Extract a SessionSummary from a single .jsonl file.
   * Uses streaming for title/startedAt and file size estimation for messageCount.
   */
  async function extractSessionSummary(
    projectHash: string,
    filePath: string,
    fileName: string,
  ): Promise<SessionSummary> {
    const sessionId = fileName.replace(/\.jsonl$/, '');
    const stat = await fsp.stat(filePath);
    const lastModified = stat.mtimeMs;

    let title = '';
    let startedAt = '';
    // Estimate message count from file size (~2KB per message on average)
    const messageCount = Math.max(1, Math.round(stat.size / 2048));

    try {
      const lines = await readFirstLines(filePath, 20);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === 'user') {
            const rawContent = typeof obj.message?.content === 'string'
              ? obj.message.content
              : typeof obj.content === 'string'
                ? obj.content
                : '';
            title = rawContent.slice(0, 100);
            startedAt = obj.timestamp || '';
            break;
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // file read error - return defaults
    }

    return {
      sessionId,
      projectHash,
      title,
      startedAt,
      lastModified,
      messageCount,
    };
  }

  return {
    /**
     * Scan all projects under ~/.claude/projects/
     */
    async getProjects(): Promise<ProjectInfo[]> {
      // Return cached data if still valid
      if (projectsCache.data && Date.now() < projectsCache.expiry) {
        return projectsCache.data;
      }

      try {
        const dirs = await fsp.readdir(projectsDir, { withFileTypes: true });
        const projects: ProjectInfo[] = [];

        for (const dir of dirs) {
          if (!dir.isDirectory()) continue;

          const projectHash = dir.name;
          const projectPath = join(projectsDir, projectHash);

          try {
            const files = await fsp.readdir(projectPath);
            const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

            if (jsonlFiles.length === 0) continue;

            // Parallel stat for all jsonl files
            const statResults = await Promise.all(
              jsonlFiles.map(async (f) => {
                try {
                  const stat = await fsp.stat(join(projectPath, f));
                  return stat.mtimeMs;
                } catch {
                  return 0;
                }
              })
            );
            const lastActivity = Math.max(...statResults, 0);

            // Extract last meaningful segment from hash like "-Users-rl-...-muxvo"
            const segments = projectHash.split('-').filter(s => s.length > 0);
            const displayName = segments.length > 0 ? segments[segments.length - 1] : projectHash;
            const displayPath = ''; // No longer reading file for this

            projects.push({
              projectHash,
              displayPath,
              displayName,
              sessionCount: jsonlFiles.length,
              lastActivity,
            });
          } catch {
            // skip unreadable project dir
          }
        }

        // Sort by lastActivity descending
        projects.sort((a, b) => b.lastActivity - a.lastActivity);

        // Update cache
        projectsCache.data = projects;
        projectsCache.expiry = Date.now() + CACHE_TTL;

        return projects;
      } catch {
        // projectsDir doesn't exist or is unreadable
        return [];
      }
    },

    /**
     * List sessions for a specific project.
     */
    async getSessionsForProject(projectHash: string): Promise<SessionSummary[]> {
      const projectPath = join(projectsDir, projectHash);

      try {
        const files = await fsp.readdir(projectPath);
        const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

        const sessions: SessionSummary[] = [];
        for (const f of jsonlFiles) {
          const cacheKey = projectHash + '/' + f;
          const cached = summaryCache.get(cacheKey);
          if (cached && Date.now() < cached.expiry) {
            sessions.push(cached.data);
            continue;
          }

          try {
            const summary = await extractSessionSummary(projectHash, join(projectPath, f), f);
            summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
            sessions.push(summary);
          } catch {
            // skip unreadable file
          }
        }

        // Sort by lastModified descending
        sessions.sort((a, b) => b.lastModified - a.lastModified);
        return sessions;
      } catch {
        return [];
      }
    },

    /**
     * Get recent sessions across all projects.
     */
    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      try {
        const dirs = await fsp.readdir(projectsDir, { withFileTypes: true });

        // Collect all jsonl files with their mtime
        const allFiles: { projectHash: string; fileName: string; filePath: string; mtime: number }[] = [];

        for (const dir of dirs) {
          if (!dir.isDirectory()) continue;
          const projectHash = dir.name;
          const projectPath = join(projectsDir, projectHash);

          try {
            const files = await fsp.readdir(projectPath);
            for (const f of files) {
              if (!f.endsWith('.jsonl')) continue;
              try {
                const filePath = join(projectPath, f);
                const stat = await fsp.stat(filePath);
                allFiles.push({ projectHash, fileName: f, filePath, mtime: stat.mtimeMs });
              } catch {
                // skip
              }
            }
          } catch {
            // skip unreadable dir
          }
        }

        // Sort by mtime descending, take top N
        allFiles.sort((a, b) => b.mtime - a.mtime);
        const topFiles = allFiles.slice(0, limit);

        // Extract summaries (use cache where possible)
        const sessions: SessionSummary[] = [];
        for (const file of topFiles) {
          const cacheKey = file.projectHash + '/' + file.fileName;
          const cached = summaryCache.get(cacheKey);
          if (cached && Date.now() < cached.expiry) {
            sessions.push(cached.data);
            continue;
          }

          try {
            const summary = await extractSessionSummary(file.projectHash, file.filePath, file.fileName);
            summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
            sessions.push(summary);
          } catch {
            // skip
          }
        }

        return sessions;
      } catch {
        return [];
      }
    },

    /**
     * Read and normalize all messages from a session file using streaming.
     */
    async readSession(projectHash: string, sessionId: string): Promise<SessionMessage[]> {
      const filePath = join(projectsDir, projectHash, `${sessionId}.jsonl`);

      try {
        // Check file exists before creating stream to avoid uncaught ENOENT
        await fsp.access(filePath);

        const messages: SessionMessage[] = [];

        await new Promise<void>((resolve) => {
          const stream = createReadStream(filePath, { encoding: 'utf-8' });

          // Register error handler immediately to prevent uncaught exceptions
          stream.on('error', () => {
            resolve();
          });

          const rl = createInterface({ input: stream, crlfDelay: Infinity });

          rl.on('line', (line) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            try {
              const entry = JSON.parse(trimmed);
              const type = entry.type as string;
              if (type !== 'user' && type !== 'assistant') return;

              // Normalize content
              let normalizedContent: string | SessionMessage['content'];
              if (type === 'user') {
                const msgContent = (entry.message as Record<string, unknown>)?.content;
                if (typeof msgContent === 'string') {
                  normalizedContent = msgContent;
                } else if (Array.isArray(msgContent)) {
                  // Check if this is a pure tool_result array (API internal, not user input)
                  const blocks = msgContent as Array<Record<string, unknown>>;
                  const hasOnlyToolResults = blocks.length > 0 && blocks.every(b => b.type === 'tool_result');
                  if (hasOnlyToolResults) {
                    return; // Skip — not real user input
                  }
                  // Extract text from text blocks (interrupted messages, text+image, etc.)
                  const textParts = blocks
                    .filter(b => b.type === 'text' && typeof b.text === 'string')
                    .map(b => b.text as string);
                  normalizedContent = textParts.join('\n') || '';
                } else if (typeof entry.content === 'string') {
                  normalizedContent = entry.content;
                } else {
                  normalizedContent = '';
                }
              } else {
                // Assistant content: prefer message.content (array), fallback to entry.content
                const msgContent = (entry.message as Record<string, unknown>)?.content;
                if (Array.isArray(msgContent)) {
                  normalizedContent = msgContent as SessionMessage['content'];
                } else if (Array.isArray(entry.content)) {
                  normalizedContent = entry.content as SessionMessage['content'];
                } else if (typeof msgContent === 'string') {
                  normalizedContent = msgContent;
                } else if (typeof entry.content === 'string') {
                  normalizedContent = entry.content;
                } else {
                  normalizedContent = '';
                }
              }

              messages.push({
                uuid: (entry.uuid as string) || '',
                type: type as 'user' | 'assistant',
                sessionId: (entry.sessionId as string) || sessionId,
                cwd: (entry.cwd as string) || '',
                gitBranch: entry.gitBranch as string | undefined,
                timestamp: (entry.timestamp as string) || '',
                content: normalizedContent,
              });
            } catch {
              // skip malformed line
            }
          });

          rl.on('close', () => resolve());
        });

        return messages;
      } catch {
        return [];
      }
    },

    /**
     * Search across all sessions for a query string.
     */
    async search(query: string): Promise<SearchResult[]> {
      const results: SearchResult[] = [];
      const q = query.toLowerCase();

      try {
        const dirs = await fsp.readdir(projectsDir, { withFileTypes: true });

        for (const dir of dirs) {
          if (!dir.isDirectory()) continue;
          const projectHash = dir.name;
          const projectPath = join(projectsDir, projectHash);

          try {
            const files = await fsp.readdir(projectPath);

            for (const f of files) {
              if (!f.endsWith('.jsonl')) continue;
              const sessionId = f.replace(/\.jsonl$/, '');

              try {
                const content = await fsp.readFile(join(projectPath, f), 'utf-8');
                const lines = content.split('\n');

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed) continue;

                  try {
                    const obj = JSON.parse(trimmed);
                    if (obj.type !== 'user') continue;

                    const text = typeof obj.message?.content === 'string'
                      ? obj.message.content
                      : typeof obj.content === 'string'
                        ? obj.content
                        : '';

                    if (text.toLowerCase().includes(q)) {
                      results.push({
                        projectHash,
                        sessionId,
                        snippet: text.slice(0, 200),
                        timestamp: obj.timestamp || '',
                      });
                    }
                  } catch {
                    // skip malformed line
                  }
                }
              } catch {
                // skip unreadable file
              }
            }
          } catch {
            // skip unreadable dir
          }
        }
      } catch {
        // projectsDir doesn't exist
      }

      return results;
    },

    /**
     * Clear cached data. Optionally scope to a specific project.
     */
    clearCache(projectHash?: string) {
      clearProjectsCache();
      clearSummaryCache(projectHash);
    },
  };
}
