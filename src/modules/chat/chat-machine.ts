/**
 * Chat history state machine
 *
 * States: Closed -> Loading -> Ready
 * Views: EmptySearch | Searching | Results | SessionDetail
 */

type ChatState = 'Closed' | 'Loading' | 'Ready';
type ChatView = 'List' | 'EmptySearch' | 'Searching' | 'Results' | 'SessionDetail';

interface ChatContext {
  view: ChatView;
  query: string;
  results: unknown[];
  readStrategy: string;
}

export function createChatMachine() {
  let _state: ChatState = 'Closed';
  const _context: ChatContext = {
    view: 'List',
    query: '',
    results: [],
    readStrategy: 'cc',
  };

  return {
    get state() {
      return _state;
    },
    get context() {
      return _context;
    },
    send(event: string, payload?: Record<string, unknown>) {
      switch (event) {
        case 'OPEN':
          if (_state === 'Closed') _state = 'Loading';
          break;
        case 'LOADED':
          if (_state === 'Loading') _state = 'Ready';
          break;
        case 'SEARCH': {
          const query = (payload?.query as string) ?? '';
          _context.query = query;
          if (query === '') {
            _context.view = 'EmptySearch';
          } else {
            _context.view = 'Searching';
          }
          break;
        }
        case 'SEARCH_COMPLETE':
          _context.view = 'Results';
          _context.results = (payload?.results as unknown[]) ?? [];
          break;
        case 'VIEW_SESSION':
          _context.view = 'SessionDetail';
          _context.readStrategy = 'cc';
          break;
      }
    },
  };
}
