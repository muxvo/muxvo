/**
 * Chat Multi-Source Aggregator
 *
 * Merges Claude Code (CC) and Codex chat readers into a single API.
 * Routes by projectHash prefix: "codex-" → Codex reader, else → CC reader.
 * "__all__" queries both sources in parallel.
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
}

function isCodexProject(projectHash: string): boolean {
  return projectHash.startsWith('codex-');
}

export function createChatMultiSource(opts: MultiSourceOpts) {
  const { ccReader, codexReader } = opts;

  /** Route to the correct reader by projectHash */
  function routeReader(projectHash: string): ChatReader {
    if (isCodexProject(projectHash) && codexReader) return codexReader;
    return ccReader;
  }

  return {
    async getProjects(): Promise<ProjectInfo[]> {
      const tasks: Promise<ProjectInfo[]>[] = [ccReader.getProjects()];
      if (codexReader) tasks.push(codexReader.getProjects());

      const results = await Promise.all(tasks);
      const merged = results.flat();
      merged.sort((a, b) => b.lastActivity - a.lastActivity);
      return merged;
    },

    async getSessionsForProject(
      projectHash: string,
      limit = 50,
    ): Promise<SessionSummary[]> {
      const reader = routeReader(projectHash);
      return reader.getSessionsForProject(projectHash, limit);
    },

    async getAllRecentSessions(limit: number): Promise<SessionSummary[]> {
      const tasks: Promise<SessionSummary[]>[] = [
        ccReader.getAllRecentSessions(limit),
      ];
      if (codexReader) tasks.push(codexReader.getAllRecentSessions(limit));

      const results = await Promise.all(tasks);
      const merged = results.flat();
      merged.sort((a, b) => b.lastModified - a.lastModified);
      return merged.slice(0, limit);
    },

    async readSession(
      projectHash: string,
      sessionId: string,
      options?: { limit?: number },
    ): Promise<SessionMessage[]> {
      const reader = routeReader(projectHash);
      return reader.readSession(projectHash, sessionId, options);
    },

    async search(query: string): Promise<SearchResult[]> {
      const tasks: Promise<SearchResult[]>[] = [ccReader.search(query)];
      if (codexReader) tasks.push(codexReader.search(query));

      const results = await Promise.all(tasks);
      return results.flat().slice(0, 100);
    },
  };
}
