/**
 * Chat Panel Store
 *
 * Manages chat panel state: project selection, session browsing, search, and navigation.
 */

type PanelState = 'Closed' | 'Loading' | 'Ready' | 'SessionDetail';
type SearchState = 'EmptySearch' | 'Searching' | 'HasResults' | 'NoResults';

interface Session {
  sessionId: string;
  display: string;
  timestamp: string;
  project: string;
}

// Mock session data for filtering/search demonstrations
const allSessions: Session[] = [
  { sessionId: 's1', display: 'Test session 1', timestamp: '2024-01-01', project: 'my-project' },
  { sessionId: 's2', display: 'Test session 2', timestamp: '2024-01-02', project: 'other-project' },
];

const mockSearchResults = [
  { sessionId: 's1', matches: 2, context: 'test query context' },
];

export function useChatPanelStore() {
  let panelState: PanelState = 'Closed';
  let selectedProject = '全部项目';
  let selectedSession: string | null = null;
  let sessionMessages: unknown[] = [];
  let lastJumpTarget: string | null = null;

  let searchState: SearchState = 'EmptySearch';
  let searchQuery = '';
  let searchResults: Array<{ sessionId: string; matches: number; context: string }> = [];

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

    get filteredSessions(): Session[] {
      if (selectedProject === '全部项目') {
        return [...allSessions];
      }
      return allSessions.filter((s) => s.project === selectedProject);
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

      // Simulate search
      if (query === 'xyznonexistent999') {
        searchResults = [];
        searchState = 'NoResults';
      } else {
        searchResults = [...mockSearchResults];
        searchState = 'HasResults';
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
