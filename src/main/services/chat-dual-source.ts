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
  archivePath?: string;
}

export function createChatProjectReader(opts: ChatProjectReaderOpts) {
  const projectsDir = join(opts.ccBasePath, 'projects');
  const archiveProjectsDir = opts.archivePath || null;

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
   * Uses streaming for title/startedAt, stat for fileSize.
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

    try {
      const lines = await readFirstLines(filePath, 20);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === 'user') {
            let rawContent = '';
            const msgContent = obj.message?.content ?? obj.content;
            if (typeof msgContent === 'string') {
              rawContent = msgContent;
            } else if (Array.isArray(msgContent)) {
              rawContent = msgContent
                .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
                .map((b: any) => b.text)
                .join('\n');
            }
            if (!startedAt) startedAt = obj.timestamp || '';
            const trimmedContent = rawContent.trim();
            // Skip internal command messages (e.g. /commit skill)
            if (trimmedContent && !trimmedContent.startsWith('<command-message>') && !trimmedContent.startsWith('<local-command-caveat>') && !trimmedContent.startsWith('<teammate-message') && !trimmedContent.startsWith('<system-reminder>')) {
              title = trimmedContent.slice(0, 100);
              break;
            }
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
      fileSize: stat.size,
      source: 'claude-code' as const,
    };
  }

  /**
   * Parse a single JSONL line into a SessionMessage (or null if not user/assistant).
   */
  const PROTOCOL_TYPES = new Set(['idle_notification', 'teammate_terminated', 'shutdown_approved', 'shutdown_rejected']);

  /** Check if text content is only protocol JSON (idle_notification etc.) */
  function isProtocolJson(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;
    return trimmed.split('\n').every(line => {
      const l = line.trim();
      if (!l) return true;
      try { return PROTOCOL_TYPES.has(JSON.parse(l).type); }
      catch { return false; }
    });
  }

  /**
   * Split concatenated <teammate-message> blocks into individual SessionMessage entries.
   * Protocol-only blocks (idle_notification etc.) are filtered out.
   */
  function splitTeammateMessages(
    content: string,
    base: { uuid: string; sessionId: string; cwd: string; gitBranch?: string; timestamp: string },
  ): SessionMessage[] {
    const blockRe = /<teammate-message[^>]*>[\s\S]*?<\/teammate-message>/g;
    const blocks = content.match(blockRe);
    if (!blocks || blocks.length === 0) return [];

    const results: SessionMessage[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const inner = block
        .replace(/<teammate-message[^>]*>\n?/, '')
        .replace(/<\/teammate-message>\s*$/, '')
        .trim();
      if (isProtocolJson(inner)) continue; // skip protocol noise
      results.push({
        uuid: `${base.uuid}-tm${i}`,
        type: 'system',
        sessionId: base.sessionId,
        cwd: base.cwd,
        gitBranch: base.gitBranch,
        timestamp: base.timestamp,
        content: block, // keep full <teammate-message> tag for renderer to extract name
      });
    }
    return results;
  }

  function parseMessageLine(line: string, sessionId: string): SessionMessage[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    try {
      const entry = JSON.parse(trimmed);
      const type = entry.type as string;
      if (type !== 'user' && type !== 'assistant' && type !== 'queue-operation') return [];

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
          if (hasOnlyToolResults) return [];
          // Check if user message contains images
          const hasImages = blocks.some(b => b.type === 'image');
          if (hasImages) {
            // Preserve as content block array (text + image blocks)
            normalizedContent = blocks
              .filter(b => b.type === 'text' || b.type === 'image')
              .map(b => {
                if (b.type === 'image') {
                  return { type: 'image', source: b.source };
                }
                return { type: 'text', text: b.text as string };
              }) as SessionMessage['content'];
          } else {
            const textParts = blocks
              .filter(b => b.type === 'text' && typeof b.text === 'string')
              .map(b => b.text as string);
            normalizedContent = textParts.join('\n') || '';
          }
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
            trimmedContent.startsWith('<system-reminder>') ||
            trimmedContent.startsWith('<task-notification>') ||
            trimmedContent.startsWith('<command-message>') ||
            trimmedContent.startsWith('<command-name>')
          ) {
            resolvedType = 'system';
          } else if (trimmedContent.startsWith('<teammate-message')) {
            // Split concatenated teammate blocks into individual messages
            const baseFields = {
              uuid: (entry.uuid as string) || '',
              sessionId: (entry.sessionId as string) || sessionId,
              cwd: (entry.cwd as string) || '',
              gitBranch: entry.gitBranch as string | undefined,
              timestamp: (entry.timestamp as string) || '',
            };
            return splitTeammateMessages(trimmedContent, baseFields);
          }
        }
      }

      return [{
        uuid: (entry.uuid as string) || '',
        type: resolvedType,
        sessionId: (entry.sessionId as string) || sessionId,
        cwd: (entry.cwd as string) || '',
        gitBranch: entry.gitBranch as string | undefined,
        timestamp: (entry.timestamp as string) || '',
        content: normalizedContent,
      }];
    } catch {
      return [];
    }
  }

  /**
   * Scan projects from a single base directory.
   */
  async function scanProjectsFromDir(baseDir: string): Promise<ProjectInfo[]> {
    try {
      const dirs = await fsp.readdir(baseDir, { withFileTypes: true });
      const projectDirs = dirs.filter(d => d.isDirectory());

      const projectResults = await Promise.all(
        projectDirs.map(async (dir) => {
          const projectHash = dir.name;
          const projectPath = join(baseDir, projectHash);
          try {
            const [files, dirStat] = await Promise.all([
              fsp.readdir(projectPath),
              fsp.stat(projectPath),
            ]);
            const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
            if (jsonlFiles.length === 0) return null;

            // Calculate total size of all .jsonl files
            const fileStats = await Promise.all(
              jsonlFiles.map(f => fsp.stat(join(projectPath, f)).catch(() => null))
            );
            const totalSize = fileStats.reduce((sum, s) => sum + (s?.size || 0), 0);

            // Extract cwd from first session file to populate displayPath
            let displayPath = '';
            if (jsonlFiles.length > 0) {
              try {
                const lines = await readFirstLines(join(projectPath, jsonlFiles[0]), 10);
                for (const line of lines) {
                  try {
                    const obj = JSON.parse(line.trim());
                    if (obj.cwd) { displayPath = obj.cwd; break; }
                  } catch { /* skip non-JSON lines */ }
                }
              } catch { /* skip read errors */ }
            }

            const segments = projectHash.split('-').filter(s => s.length > 0);
            const fallbackName = segments.length > 0 ? segments[segments.length - 1] : projectHash;
            const displayName = displayPath
              ? displayPath.split('/').filter(Boolean).pop() || fallbackName
              : fallbackName;

            return {
              projectHash,
              displayPath,
              displayName,
              sessionCount: jsonlFiles.length,
              totalSize,
              lastActivity: dirStat.mtimeMs,
              source: 'claude-code',
            } as ProjectInfo;
          } catch {
            return null;
          }
        })
      );

      return projectResults.filter((p): p is ProjectInfo => p !== null);
    } catch {
      return [];
    }
  }

  /**
   * Scan sessions (file stats) from a single project directory.
   */
  async function scanSessionFilesFromDir(projectPath: string): Promise<{ fileName: string; mtime: number }[]> {
    try {
      const files = await fsp.readdir(projectPath);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

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

      return fileStats.filter((s): s is { fileName: string; mtime: number } => s !== null);
    } catch {
      return [];
    }
  }

  return {
    /**
     * Scan all projects under ~/.claude/projects/ and archive.
     * Uses directory stat for lastActivity (avoids stating every file).
     */
    async getProjects(): Promise<ProjectInfo[]> {
      // Return cached data if still valid
      if (projectsCache.data && Date.now() < projectsCache.expiry) {
        return projectsCache.data;
      }

      const ccProjects = await scanProjectsFromDir(projectsDir);

      // Merge archive projects (archive supplements CC, does not override)
      if (archiveProjectsDir) {
        const archiveProjects = await scanProjectsFromDir(archiveProjectsDir);
        const ccHashSet = new Set(ccProjects.map(p => p.projectHash));

        for (const ap of archiveProjects) {
          if (ccHashSet.has(ap.projectHash)) {
            // CC already has this project; add archive session count
            const existing = ccProjects.find(p => p.projectHash === ap.projectHash)!;
            existing.sessionCount = Math.max(existing.sessionCount, ap.sessionCount);
          } else {
            ccProjects.push(ap);
          }
        }
      }

      // Sort by lastActivity descending
      ccProjects.sort((a, b) => b.lastActivity - a.lastActivity);

      // Update cache
      projectsCache.data = ccProjects;
      projectsCache.expiry = Date.now() + CACHE_TTL;

      return ccProjects;
    },

    /**
     * List sessions for a specific project.
     * Stats files first, sorts by mtime, then only extracts summaries for top N.
     * Merges CC and archive sources (CC takes priority for duplicate sessions).
     */
    async getSessionsForProject(projectHash: string, limit = 50): Promise<SessionSummary[]> {
      const ccProjectPath = join(projectsDir, projectHash);

      // Scan CC source
      const ccStats = await scanSessionFilesFromDir(ccProjectPath);
      const ccFileNames = new Set(ccStats.map(s => s.fileName));

      // Scan archive source, add files not already in CC
      let allStats = [...ccStats];
      if (archiveProjectsDir) {
        const archiveProjectPath = join(archiveProjectsDir, projectHash);
        const archiveStats = await scanSessionFilesFromDir(archiveProjectPath);
        for (const archiveStat of archiveStats) {
          if (!ccFileNames.has(archiveStat.fileName)) {
            allStats.push(archiveStat);
          }
        }
      }

      // Sort by mtime descending, take top N for summary extraction
      allStats.sort((a, b) => b.mtime - a.mtime);
      const topFiles = allStats.slice(0, limit);

      // Extract summaries for top N in parallel (use cache where possible)
      const results = await Promise.all(
        topFiles.map(async (file) => {
          const cacheKey = projectHash + '/' + file.fileName;
          const cached = summaryCache.get(cacheKey);
          if (cached && Date.now() < cached.expiry) {
            return cached.data.title ? cached.data : null;
          }

          const filePath = ccFileNames.has(file.fileName)
            ? join(ccProjectPath, file.fileName)
            : join(archiveProjectsDir!, projectHash, file.fileName);

          try {
            const summary = await extractSessionSummary(projectHash, filePath, file.fileName);
            summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
            return summary.title ? summary : null;
          } catch {
            return null;
          }
        })
      );

      // Already sorted by mtime (order preserved from topFiles)
      return results.filter((s): s is SessionSummary => s !== null);
    },

    /**
     * Get recent sessions across all projects.
     * Scans both CC and archive sources, merging results.
     */
    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      /**
       * Collect file entries from a base directory (CC or archive).
       */
      async function collectFilesFromBase(baseDir: string): Promise<{ projectHash: string; fileName: string; filePath: string; mtime: number }[]> {
        const collected: { projectHash: string; fileName: string; filePath: string; mtime: number }[] = [];
        try {
          const dirs = await fsp.readdir(baseDir, { withFileTypes: true });
          const projectDirs = dirs.filter(d => d.isDirectory());

          const dirStats = await Promise.all(
            projectDirs.map(async (dir) => {
              try {
                const projectPath = join(baseDir, dir.name);
                const stat = await fsp.stat(projectPath);
                return { projectHash: dir.name, projectPath, mtime: stat.mtimeMs };
              } catch {
                return null;
              }
            })
          );

          const validDirs = dirStats.filter((d): d is { projectHash: string; projectPath: string; mtime: number } => d !== null);
          validDirs.sort((a, b) => b.mtime - a.mtime);

          const maxProjectsToScan = Math.min(validDirs.length, Math.max(10, Math.ceil(limit / 5)));
          const topProjects = validDirs.slice(0, maxProjectsToScan);

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
                  if (fs) collected.push(fs);
                }
              } catch {
                // skip unreadable dir
              }
            })
          );
        } catch {
          // base dir doesn't exist
        }
        return collected;
      }

      const ccFiles = await collectFilesFromBase(projectsDir);

      // Merge archive files (CC takes priority for same projectHash+fileName)
      if (archiveProjectsDir) {
        const archiveFiles = await collectFilesFromBase(archiveProjectsDir);
        const ccKeySet = new Set(ccFiles.map(f => f.projectHash + '/' + f.fileName));
        for (const af of archiveFiles) {
          if (!ccKeySet.has(af.projectHash + '/' + af.fileName)) {
            ccFiles.push(af);
          }
        }
      }

      // Sort by mtime descending, take top N
      ccFiles.sort((a, b) => b.mtime - a.mtime);
      const topFiles = ccFiles.slice(0, limit);

      // Extract summaries in parallel (use cache where possible)
      const results = await Promise.all(
        topFiles.map(async (file) => {
          const cacheKey = file.projectHash + '/' + file.fileName;
          const cached = summaryCache.get(cacheKey);
          if (cached && Date.now() < cached.expiry) {
            return cached.data.title ? cached.data : null;
          }

          try {
            const summary = await extractSessionSummary(file.projectHash, file.filePath, file.fileName);
            summaryCache.set(cacheKey, { data: summary, expiry: Date.now() + CACHE_TTL });
            return summary.title ? summary : null;
          } catch {
            return null;
          }
        })
      );

      return results.filter((s): s is SessionSummary => s !== null);
    },

    /**
     * Read and normalize messages from a session file.
     * When limit is set, reads only the tail of large files for speed.
     * Falls back to archive source if CC source doesn't have the file.
     */
    async readSession(projectHash: string, sessionId: string, options?: { limit?: number }): Promise<SessionMessage[]> {
      const ccFilePath = join(projectsDir, projectHash, `${sessionId}.jsonl`);
      const limit = options?.limit;

      // Determine which file to read: stat doubles as existence check (1 syscall instead of access+stat)
      let filePath = ccFilePath;
      let resolvedStat = await fsp.stat(ccFilePath).catch(() => null);
      if (!resolvedStat) {
        if (archiveProjectsDir) {
          const archiveFilePath = join(archiveProjectsDir, projectHash, `${sessionId}.jsonl`);
          resolvedStat = await fsp.stat(archiveFilePath).catch(() => null);
          if (resolvedStat) {
            filePath = archiveFilePath;
          } else {
            return [];
          }
        } else {
          return [];
        }
      }

      try {
        const stat = resolvedStat;

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

            const msgs = parseMessageLine(line, sessionId);
            if (msgs.length > 0) messages.push(...msgs);
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
     * Searches both CC and archive sources.
     */
    async search(query: string): Promise<SearchResult[]> {
      /** Extract searchable text from a JSONL entry (user or assistant). */
      function extractSearchableText(obj: Record<string, unknown>): string {
        const mc = (obj.message as Record<string, unknown>)?.content ?? obj.content;
        if (typeof mc === 'string') return mc;
        if (Array.isArray(mc)) {
          return (mc as Array<Record<string, unknown>>)
            .map(block => {
              if (block.type === 'text' && typeof block.text === 'string') return block.text;
              return '';
            })
            .filter(Boolean)
            .join('\n');
        }
        return '';
      }

      const results: SearchResult[] = [];
      const q = query.toLowerCase();
      // Track seen sessions to avoid duplicate results from both sources
      const seenSessions = new Set<string>();

      /** Stream-search a single JSONL file; resolves when match found or EOF. */
      async function searchFile(filePath: string, projectHash: string, sessionId: string): Promise<void> {
        return new Promise<void>((resolve) => {
          let found = false;
          const stream = createReadStream(filePath, { encoding: 'utf-8' });
          const rl = createInterface({ input: stream, crlfDelay: Infinity });
          stream.on('error', () => resolve());
          rl.on('line', (line) => {
            if (found) return;
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
              const obj = JSON.parse(trimmed);
              if (obj.type !== 'user' && obj.type !== 'assistant') return;
              const text = extractSearchableText(obj);
              if (text.toLowerCase().includes(q)) {
                const idx = text.toLowerCase().indexOf(q);
                const snippetStart = Math.max(0, idx - 30);
                const snippetEnd = Math.min(text.length, idx + query.length + 170);
                results.push({ projectHash, sessionId, snippet: text.slice(snippetStart, snippetEnd), timestamp: obj.timestamp || '' });
                found = true;
                rl.close();
                stream.destroy();
              }
            } catch { /* skip malformed line */ }
          });
          rl.on('close', () => resolve());
        });
      }

      async function searchInDir(baseDir: string) {
        try {
          const dirs = await fsp.readdir(baseDir, { withFileTypes: true });

          for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            const projectHash = dir.name;
            const projectPath = join(baseDir, projectHash);

            try {
              const files = await fsp.readdir(projectPath);
              const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

              // Process files in concurrent batches
              const CONCURRENCY = 10;
              for (let i = 0; i < jsonlFiles.length; i += CONCURRENCY) {
                const batch = jsonlFiles.slice(i, i + CONCURRENCY);
                await Promise.all(batch.map(async (f) => {
                  const sessionId = f.replace(/\.jsonl$/, '');
                  const sessionKey = projectHash + '/' + sessionId;
                  if (seenSessions.has(sessionKey)) return;
                  seenSessions.add(sessionKey);
                  try {
                    await searchFile(join(projectPath, f), projectHash, sessionId);
                  } catch (err) {
                    console.warn('[chat:search] skip file:', f, err);
                  }
                }));
              }
            } catch {
              // skip unreadable dir
            }
          }
        } catch {
          // baseDir doesn't exist
        }
      }

      // Search CC source first (so CC sessions get priority in seenSessions),
      // then archive in parallel for non-overlapping sessions
      await searchInDir(projectsDir);
      if (archiveProjectsDir) {
        // Sequential here because seenSessions dedup depends on CC finishing first
        await searchInDir(archiveProjectsDir);
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
