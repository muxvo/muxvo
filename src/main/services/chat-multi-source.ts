/**
 * Chat Multi-Source Aggregator
 *
 * Merges Claude Code (CC), Codex, and Gemini CLI chat readers into a single API.
 * Same project directory (same projectHash) merges sessions from all sources.
 * readSession: tries CC first, falls back to Codex, then Gemini.
 */

import type {
  ProjectInfo,
  SessionSummary,
  SessionMessage,
  SearchResult,
} from '@/shared/types/chat.types';

/** Minimal reader interface shared by CC and Codex readers */
interface ChatReader {
  getProjects(): Promise<ProjectInfo[]>;
  getSessionsForProject(projectHash: string, limit?: number): Promise<SessionSummary[]>;
  getAllRecentSessions(limit: number): Promise<SessionSummary[]>;
  readSession(
    projectHash: string,
    sessionId: string,
    options?: { limit?: number },
  ): Promise<SessionMessage[]>;
  search(query: string): Promise<SearchResult[]>;
}

interface MultiSourceOpts {
  ccReader: ChatReader;
  codexReader: ChatReader | null; // null if ~/.codex doesn't exist
  geminiReader: ChatReader | null; // null if ~/.gemini doesn't exist
}

export function createChatMultiSource(opts: MultiSourceOpts) {
  const { ccReader, codexReader, geminiReader } = opts;

  return {
    async getProjects(): Promise<ProjectInfo[]> {
      const tasks: Promise<ProjectInfo[]>[] = [ccReader.getProjects()];
      if (codexReader) tasks.push(codexReader.getProjects());
      if (geminiReader) tasks.push(geminiReader.getProjects());

      const results = await Promise.all(tasks);
      const all = results.flat();

      // Merge projects with same projectHash (same cwd)
      const map = new Map<string, ProjectInfo>();
      for (const p of all) {
        const existing = map.get(p.projectHash);
        if (existing) {
          existing.sessionCount += p.sessionCount;
          existing.totalSize = (existing.totalSize || 0) + (p.totalSize || 0);
          existing.lastActivity = Math.max(existing.lastActivity, p.lastActivity);
        } else {
          map.set(p.projectHash, { ...p });
        }
      }

      const merged = Array.from(map.values());
      merged.sort((a, b) => b.lastActivity - a.lastActivity);
      return merged;
    },

    async getSessionsForProject(
      projectHash: string,
      limit = 50,
    ): Promise<SessionSummary[]> {
      // Query all readers, merge sessions
      const tasks: Promise<SessionSummary[]>[] = [
        ccReader.getSessionsForProject(projectHash, limit),
      ];
      if (codexReader) tasks.push(codexReader.getSessionsForProject(projectHash, limit));
      if (geminiReader) tasks.push(geminiReader.getSessionsForProject(projectHash, limit));

      const results = await Promise.all(tasks);
      const merged = results.flat();
      // Deduplicate by sessionId (first occurrence wins = CC priority)
      const seen = new Set<string>();
      const deduped = merged.filter(s => {
        if (seen.has(s.sessionId)) return false;
        seen.add(s.sessionId);
        return true;
      });
      deduped.sort((a, b) => b.lastModified - a.lastModified);
      return deduped.slice(0, limit);
    },

    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      const tasks: Promise<SessionSummary[]>[] = [
        ccReader.getAllRecentSessions(limit),
      ];
      if (codexReader) tasks.push(codexReader.getAllRecentSessions(limit));
      if (geminiReader) tasks.push(geminiReader.getAllRecentSessions(limit));

      const results = await Promise.all(tasks);
      const merged = results.flat();
      // Deduplicate by sessionId (first occurrence wins = CC priority)
      const seen2 = new Set<string>();
      const deduped = merged.filter(s => {
        if (seen2.has(s.sessionId)) return false;
        seen2.add(s.sessionId);
        return true;
      });
      deduped.sort((a, b) => b.lastModified - a.lastModified);
      return deduped.slice(0, limit);
    },

    async readSession(
      projectHash: string,
      sessionId: string,
      options?: { limit?: number },
    ): Promise<SessionMessage[]> {
      // Try CC first, fall back to Codex, then Gemini
      const ccMessages = await ccReader.readSession(projectHash, sessionId, options);
      if (ccMessages.length > 0) return ccMessages;
      if (codexReader) {
        const codexMessages = await codexReader.readSession(projectHash, sessionId, options);
        if (codexMessages.length > 0) return codexMessages;
      }
      if (geminiReader) {
        return geminiReader.readSession(projectHash, sessionId, options);
      }
      return [];
    },

    async search(query: string): Promise<SearchResult[]> {
      const tasks: Promise<SearchResult[]>[] = [ccReader.search(query)];
      if (codexReader) tasks.push(codexReader.search(query));
      if (geminiReader) tasks.push(geminiReader.search(query));

      const results = await Promise.all(tasks);
      return results.flat().slice(0, 500);
    },
  };
}
