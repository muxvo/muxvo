/**
 * Chat Panel Store
 *
 * Manages chat panel state: project selection, session browsing, search, and navigation.
 */

import type { SessionSummary } from '@/shared/types/chat.types';

type PanelState = 'Closed' | 'Loading' | 'Ready' | 'SessionDetail';
type SearchState = 'EmptySearch' | 'Searching' | 'HasResults' | 'NoResults';

export function useChatPanelStore() {
  let panelState: PanelState = 'Closed';
  let selectedProject = '全部项目';
  let selectedSession: string | null = null;
  let sessionMessages: unknown[] = [];
  let lastJumpTarget: string | null = null;

  let searchState: SearchState = 'EmptySearch';
  let searchQuery = '';
  let searchResults: Array<{ sessionId: string; matches: number; context: string }> = [];

  let allSessions: SessionSummary[] = [];

  const store = {
    get panelState() { return panelState; },
    get selectedProject() { return selectedProject; },
    get selectedSession() { return selectedSession; },
    get sessionMessages() { return sessionMessages; },
    get lastJumpTarget() { return lastJumpTarget; },
    get searchState() { return searchState; },
    get searchQuery() { return searchQuery; },
    get searchResults() { return searchResults; },
    get totalSessionCount() { return allSessions.length; },

    get filteredSessions(): SessionSummary[] {
      if (selectedProject === '全部项目') {
        return [...allSessions];
      }
      return allSessions.filter((s) => s.project === selectedProject);
    },

    async loadSessions(sessions: SessionSummary[]) {
      allSessions = sessions;
    },

    selectProject(project: string) {
      selectedProject = project;
      selectedSession = null;
      sessionMessages = [];
    },

    async selectSession(sessionId: string) {
      selectedSession = sessionId;
      sessionMessages = [];
      panelState = 'SessionDetail';
    },

    async jumpToTerminal(sessionId: string) {
      lastJumpTarget = sessionId;
      panelState = 'Closed';
    },

    goBack() {
      selectedSession = null;
      sessionMessages = [];
      panelState = 'Ready';
    },

    async search(query: string) {
      searchQuery = query;
      searchState = 'Searching';

      // Simulate search - in real implementation this calls IPC
      if (query === 'xyznonexistent999') {
        searchResults = [];
        searchState = 'NoResults';
      } else {
        searchResults = allSessions
          .filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
          .map((s) => ({ sessionId: s.sessionId, matches: 1, context: s.title }));
        searchState = searchResults.length > 0 ? 'HasResults' : 'NoResults';
      }
    },

    updateSearchQuery(query: string) {
      searchQuery = query;
      searchState = 'Searching';
    },

    clearSearch() {
      searchQuery = '';
      searchResults = [];
      searchState = 'EmptySearch';
    },

    async open() {
      panelState = 'Ready';
    },

    close() {
      panelState = 'Closed';
    },
  };

  return store;
}
