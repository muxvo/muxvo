/**
 * Chat Project Reader
 *
 * Scans ~/.claude/projects/ to build project/session/message data.
 */

import { promises as fsp } from 'fs';
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

  /**
   * Read the first N lines of a file (without reading the entire file for large ones).
   */
  async function readFirstLines(filePath: string, maxLines: number): Promise<string[]> {
    const content = await fsp.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(0, maxLines);
  }

  /**
   * Find the cwd from the first user message in a JSONL file.
   */
  async function extractCwdFromFile(filePath: string): Promise<string> {
    try {
      const lines = await readFirstLines(filePath, 20);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === 'user' && obj.cwd) {
            return obj.cwd;
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // file read error
    }
    return '';
  }

  /**
   * Extract a SessionSummary from a single .jsonl file.
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
    let messageCount = 0;

    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const contentLines = content.split('\n');

      // Count messages and find first user message
      let foundFirstUser = false;
      for (const line of contentLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.includes('"type":"user"') || trimmed.includes('"type": "user"')) {
          messageCount++;
          if (!foundFirstUser) {
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
                foundFirstUser = true;
              }
            } catch {
              // skip
            }
          }
        } else if (trimmed.includes('"type":"assistant"') || trimmed.includes('"type": "assistant"')) {
          messageCount++;
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

            // Get lastActivity from most recent file
            let lastActivity = 0;
            for (const f of jsonlFiles) {
              try {
                const stat = await fsp.stat(join(projectPath, f));
                if (stat.mtimeMs > lastActivity) {
                  lastActivity = stat.mtimeMs;
                }
              } catch {
                // skip unreadable file
              }
            }

            // Get displayPath from first user message in the first jsonl file
            const displayPath = await extractCwdFromFile(join(projectPath, jsonlFiles[0]));
            const displayName = displayPath ? basename(displayPath) : projectHash;

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
          try {
            const summary = await extractSessionSummary(projectHash, join(projectPath, f), f);
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

        // Extract summaries
        const sessions: SessionSummary[] = [];
        for (const file of topFiles) {
          try {
            const summary = await extractSessionSummary(file.projectHash, file.filePath, file.fileName);
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
     * Read and normalize all messages from a session file.
     */
    async readSession(projectHash: string, sessionId: string): Promise<SessionMessage[]> {
      const filePath = join(projectsDir, projectHash, `${sessionId}.jsonl`);

      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        const parsed = parseJsonl(content);
        const messages: SessionMessage[] = [];

        for (const entry of parsed.entries) {
          const type = entry.type as string;
          if (type !== 'user' && type !== 'assistant') continue;

          // Normalize content
          let normalizedContent: string | SessionMessage['content'];
          if (type === 'user') {
            // User content: string for normal input, array for tool_result/interrupted messages
            const msgContent = (entry.message as Record<string, unknown>)?.content;
            if (typeof msgContent === 'string') {
              normalizedContent = msgContent;
            } else if (Array.isArray(msgContent)) {
              normalizedContent = msgContent as SessionMessage['content'];
            } else if (typeof entry.content === 'string') {
              normalizedContent = entry.content;
            } else if (Array.isArray(entry.content)) {
              normalizedContent = entry.content as SessionMessage['content'];
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
  };
}
