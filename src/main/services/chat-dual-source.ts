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

  /**
   * Parse a single JSONL line into a SessionMessage (or null if not user/assistant).
   */
  function parseMessageLine(line: string, sessionId: string): SessionMessage | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    try {
      const entry = JSON.parse(trimmed);
      const type = entry.type as string;
      if (type !== 'user' && type !== 'assistant' && type !== 'queue-operation') return null;

      let normalizedContent: string | SessionMessage['content'];
      if (type === 'queue-operation') {
        // queue-operation: content is at entry.content (top-level string)
        normalizedContent = typeof entry.content === 'string' ? entry.content : '';
      } else if (type === 'user') {
        const msgContent = (entry.message as Record<string, unknown>)?.content;
        if (typeof msgContent === 'string') {
          normalizedContent = msgContent;
        } else if (Array.isArray(msgContent)) {
          const blocks = msgContent as Array<Record<string, unknown>>;
          const hasOnlyToolResults = blocks.length > 0 && blocks.every(b => b.type === 'tool_result');
          if (hasOnlyToolResults) return null;
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

      // Detect system messages and resolve type
      let resolvedType: 'user' | 'assistant' | 'system' = type as 'user' | 'assistant';

      if (type === 'queue-operation') {
        // queue-operation is always a system message
        resolvedType = 'system';
      } else if (type === 'user') {
        // Check for system message markers on user-type entries
        if (entry.isCompactSummary === true) {
          resolvedType = 'system';
        } else if (entry.isMeta === true) {
          resolvedType = 'system';
        } else {
          const contentStr = typeof normalizedContent === 'string' ? normalizedContent : '';
          const trimmedContent = contentStr.trimStart();
          if (
            trimmedContent.startsWith('<task-notification>') ||
            trimmedContent.startsWith('<command-message>') ||
            trimmedContent.startsWith('<command-name>')
          ) {
            resolvedType = 'system';
          }
        }
      }

      return {
        uuid: (entry.uuid as string) || '',
        type: resolvedType,
        sessionId: (entry.sessionId as string) || sessionId,
        cwd: (entry.cwd as string) || '',
        gitBranch: entry.gitBranch as string | undefined,
        timestamp: (entry.timestamp as string) || '',
        content: normalizedContent,
      };
    } catch {
      return null;
    }
  }

  return {
    /**
     * Scan all projects under ~/.claude/projects/
     * Uses directory stat for lastActivity (avoids stating every file).
     */
    async getProjects(): Promise<ProjectInfo[]> {
      // Return cached data if still valid
      if (projectsCache.data && Date.now() < projectsCache.expiry) {
        return projectsCache.data;
      }

      try {
        const dirs = await fsp.readdir(projectsDir, { withFileTypes: true });
        const projectDirs = dirs.filter(d => d.isDirectory());

        // Parallel: readdir + stat each project directory
        const projectResults = await Promise.all(
          projectDirs.map(async (dir) => {
            const projectHash = dir.name;
            const projectPath = join(projectsDir, projectHash);
            try {
              const [files, dirStat] = await Promise.all([
                fsp.readdir(projectPath),
                fsp.stat(projectPath),
              ]);
              const jsonlCount = files.filter((f) => f.endsWith('.jsonl')).length;
              if (jsonlCount === 0) return null;

              // Extract last meaningful segment from hash like "-Users-rl-...-muxvo"
              const segments = projectHash.split('-').filter(s => s.length > 0);
              const displayName = segments.length > 0 ? segments[segments.length - 1] : projectHash;

              return {
                projectHash,
                displayPath: '',
                displayName,
                sessionCount: jsonlCount,
                lastActivity: dirStat.mtimeMs,
              } as ProjectInfo;
            } catch {
              return null;
            }
          })
        );

        const projects = projectResults.filter((p): p is ProjectInfo => p !== null);

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
     * Stats files first, sorts by mtime, then only extracts summaries for top N.
     */
    async getSessionsForProject(projectHash: string, limit = 50): Promise<SessionSummary[]> {
      const projectPath = join(projectsDir, projectHash);

      try {
        const files = await fsp.readdir(projectPath);
        const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

        // Parallel stat all files (lightweight — only mtime, no content read)
        const fileStats = await Promise.all(
          jsonlFiles.map(async (f) => {
            try {
              const stat = await fsp.stat(join(projectPath, f));
              return { fileName: f, mtime: stat.mtimeMs };
            } catch {
              return null;
            }
          })
        );

        // Sort by mtime descending, take top N for summary extraction
        const validStats = fileStats.filter((s): s is { fileName: string; mtime: number } => s !== null);
        validStats.sort((a, b) => b.mtime - a.mtime);
        const topFiles = validStats.slice(0, limit);

        // Extract summaries only for top N (use cache where possible)
        const sessions: SessionSummary[] = [];
        for (const file of topFiles) {
          const cacheKey = projectHash + '/' + file.fileName;
          const cached = summaryCache.get(cacheKey);
          if (cached && Date.now() < cached.expiry) {
            sessions.push(cached.data);
            continue;
          }

          try {
            const summary = await extractSessionSummary(projectHash, join(projectPath, file.fileName), file.fileName);
            summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
            sessions.push(summary);
          } catch {
            // skip unreadable file
          }
        }

        // Already sorted by mtime
        return sessions;
      } catch {
        return [];
      }
    },

    /**
     * Get recent sessions across all projects.
     * Only scans the most recently active project directories to avoid stating all files.
     */
    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      try {
        const dirs = await fsp.readdir(projectsDir, { withFileTypes: true });
        const projectDirs = dirs.filter(d => d.isDirectory());

        // Phase 1: Stat project directories to find most active ones
        const dirStats = await Promise.all(
          projectDirs.map(async (dir) => {
            try {
              const projectPath = join(projectsDir, dir.name);
              const stat = await fsp.stat(projectPath);
              return { projectHash: dir.name, projectPath, mtime: stat.mtimeMs };
            } catch {
              return null;
            }
          })
        );

        const validDirs = dirStats.filter((d): d is { projectHash: string; projectPath: string; mtime: number } => d !== null);
        validDirs.sort((a, b) => b.mtime - a.mtime);

        // Phase 2: Only scan top N projects (most likely to contain recent sessions)
        // Scan more projects than limit to ensure we get enough files
        const maxProjectsToScan = Math.min(validDirs.length, Math.max(10, Math.ceil(limit / 5)));
        const topProjects = validDirs.slice(0, maxProjectsToScan);

        // Phase 3: Stat files within selected projects
        const allFiles: { projectHash: string; fileName: string; filePath: string; mtime: number }[] = [];

        await Promise.all(
          topProjects.map(async (proj) => {
            try {
              const files = await fsp.readdir(proj.projectPath);
              const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

              const fileStats = await Promise.all(
                jsonlFiles.map(async (f) => {
                  try {
                    const filePath = join(proj.projectPath, f);
                    const stat = await fsp.stat(filePath);
                    return { projectHash: proj.projectHash, fileName: f, filePath, mtime: stat.mtimeMs };
                  } catch {
                    return null;
                  }
                })
              );

              for (const fs of fileStats) {
                if (fs) allFiles.push(fs);
              }
            } catch {
              // skip unreadable dir
            }
          })
        );

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
     * Read and normalize messages from a session file.
     * When limit is set, reads only the tail of large files for speed.
     */
    async readSession(projectHash: string, sessionId: string, options?: { limit?: number }): Promise<SessionMessage[]> {
      const filePath = join(projectsDir, projectHash, `${sessionId}.jsonl`);
      const limit = options?.limit;

      try {
        await fsp.access(filePath);
        const stat = await fsp.stat(filePath);

        // Tail-read optimization: for large files with a limit, read from end
        const TAIL_BYTES = 2 * 1024 * 1024; // 2MB — enough for ~200+ messages
        const readFromTail = limit && stat.size > TAIL_BYTES;
        const startPos = readFromTail ? stat.size - TAIL_BYTES : 0;

        const messages: SessionMessage[] = [];
        let skipFirstLine = readFromTail; // First line from mid-file may be incomplete

        await new Promise<void>((resolve) => {
          const stream = createReadStream(filePath, {
            encoding: 'utf-8',
            start: startPos,
          });

          stream.on('error', () => resolve());

          const rl = createInterface({ input: stream, crlfDelay: Infinity });

          rl.on('line', (line) => {
            if (skipFirstLine) {
              skipFirstLine = false;
              return;
            }

            const msg = parseMessageLine(line, sessionId);
            if (msg) messages.push(msg);
          });

          rl.on('close', () => resolve());
        });

        // Return only the last N messages when limit is set
        if (limit && messages.length > limit) {
          return messages.slice(-limit);
        }

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
