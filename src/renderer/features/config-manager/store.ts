/**
 * Config Manager Store
 *
 * State machine for the configuration manager:
 *   Closed -> Overview -> Various views (SkillsList, HooksList, etc.)
 *   With edit sub-states for Settings and CLAUDE.md.
 */

type ConfigState =
  | 'Closed'
  | 'Overview'
  | 'SkillsList'
  | 'HooksList'
  | 'PlansList'
  | 'TasksList'
  | 'SettingsView'
  | 'SettingsEditing'
  | 'ClaudeMdView'
  | 'ClaudeMdEditing'
  | 'MemoryView'
  | 'McpView'
  | 'ResourcePreview';

// Cards that map to list views
const cardToState: Record<string, ConfigState> = {
  Skills: 'SkillsList',
  Hooks: 'HooksList',
  Plans: 'PlansList',
  Tasks: 'TasksList',
  Settings: 'SettingsView',
  'CLAUDE.md': 'ClaudeMdView',
  Memory: 'MemoryView',
  MCP: 'McpView',
};

// States that support search
const searchableStates = new Set<ConfigState>([
  'SkillsList',
  'HooksList',
  'PlansList',
  'TasksList',
  'MemoryView',
  'McpView',
]);

// States that are editable
const editableStates = new Set<ConfigState>([
  'SettingsView',
  'SettingsEditing',
  'ClaudeMdView',
  'ClaudeMdEditing',
]);

// Read-only cards
const readOnlyCards = new Set(['Skills', 'Hooks', 'Plans', 'Tasks', 'Memory', 'MCP']);

interface Resource {
  name: string;
  path: string;
  type: string;
}

// Mock resources for search testing
const mockResources: Record<string, Resource[]> = {
  SkillsList: [
    { name: 'test-skill', path: '/skills/test-skill', type: 'skill' },
    { name: 'deploy-helper', path: '/skills/deploy-helper', type: 'skill' },
  ],
  HooksList: [
    { name: 'pre-commit', path: '/hooks/pre-commit', type: 'hook' },
  ],
  PlansList: [
    { name: 'deploy-plan', path: '/plans/deploy-plan', type: 'plan' },
    { name: 'test-plan', path: '/plans/test-plan', type: 'plan' },
  ],
  TasksList: [
    { name: 'build-task', path: '/tasks/build-task', type: 'task' },
    { name: 'test-task', path: '/tasks/test-task', type: 'task' },
  ],
  MemoryView: [
    { name: 'project-notes', path: '/memory/project-notes', type: 'memory' },
  ],
  McpView: [
    { name: 'mcp-config', path: '/mcp/config', type: 'mcp' },
  ],
};

interface ConfigAction {
  type: string;
  card?: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  content?: string;
  query?: string;
}

export function createConfigManagerStore() {
  let state: ConfigState = 'Closed';
  let currentCard: string | null = null;
  let selectedResource: string | null = null;
  let previewFormat: string = 'markdown';
  let searchQuery: string = '';
  let previousListState: ConfigState | null = null;

  function dispatch(action: ConfigAction): void | Promise<void> {
    switch (action.type) {
      case 'OPEN': {
        state = 'Overview';
        currentCard = null;
        selectedResource = null;
        searchQuery = '';
        break;
      }
      case 'CLOSE': {
        state = 'Closed';
        currentCard = null;
        selectedResource = null;
        searchQuery = '';
        break;
      }
      case 'SELECT_CARD': {
        if (action.card && cardToState[action.card]) {
          state = cardToState[action.card];
          currentCard = action.card;
          selectedResource = null;
          searchQuery = '';
        }
        break;
      }
      case 'SELECT_RESOURCE': {
        if (action.resourceId) {
          previousListState = state;
          selectedResource = action.resourceId;
          state = 'ResourcePreview';
          previewFormat = 'markdown';
        }
        break;
      }
      case 'BACK': {
        if (state === 'ResourcePreview' && previousListState) {
          state = previousListState;
          selectedResource = null;
          previousListState = null;
        } else {
          state = 'Overview';
          currentCard = null;
        }
        break;
      }
      case 'EDIT_SETTINGS': {
        if (state === 'SettingsView') {
          state = 'SettingsEditing';
        }
        break;
      }
      case 'SAVE_SETTINGS': {
        if (state === 'SettingsEditing') {
          state = 'SettingsView';
        }
        break;
      }
      case 'EDIT_CLAUDE_MD': {
        if (state === 'ClaudeMdView') {
          state = 'ClaudeMdEditing';
        }
        break;
      }
      case 'SAVE_CLAUDE_MD': {
        if (state === 'ClaudeMdEditing') {
          state = 'ClaudeMdView';
        }
        break;
      }
      case 'SEARCH': {
        if (action.query !== undefined) {
          searchQuery = action.query;
        }
        break;
      }
    }
  }

  return {
    getState(): ConfigState {
      return state;
    },
    hasSearchSupport(): boolean {
      return searchableStates.has(state);
    },
    getPreviewFormat(): string {
      return previewFormat;
    },
    isEditable(): boolean {
      if (currentCard && readOnlyCards.has(currentCard)) {
        return false;
      }
      return editableStates.has(state);
    },
    getFilteredResources(): Resource[] {
      const resources = mockResources[state] ?? [];
      if (!searchQuery) return resources;
      return resources.filter((r) =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    },
    dispatch,
  };
}
