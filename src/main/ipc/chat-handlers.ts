/**
 * Chat IPC Handlers
 *
 * Handles chat:get-history, chat:get-session, chat:search, chat:export IPC channels.
 */

export const chatHandlers = {
  async getHistory(opts?: { forceFail?: boolean }): Promise<Record<string, unknown>> {
    if (opts?.forceFail) {
      return {
        sessions: [],
        error: { code: 'FILE_NOT_FOUND', message: 'CC files and mirror both unavailable' },
      };
    }
    return {
      sessions: [],
    };
  },

  async getSession(_params: { sessionId: string }): Promise<Record<string, unknown>> {
    return {
      messages: [],
    };
  },

  async search(_params: { query: string }): Promise<Record<string, unknown>> {
    return {
      results: [],
    };
  },

  async export(_params: { sessionId: string; format: string }): Promise<Record<string, unknown>> {
    return {
      outputPath: '/tmp/export/session.md',
    };
  },
};
