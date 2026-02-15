/**
 * File browsing/editing state machine
 */

interface FileContext {
  panelVisible: boolean;
  transitionMs: number;
  view: 'Default' | 'ThreeColumn';
  editing: boolean;
  saved: boolean;
  currentFile: string | null;
}

export function createFileMachine() {
  const _context: FileContext = {
    panelVisible: false,
    transitionMs: 300,
    view: 'Default',
    editing: false,
    saved: false,
    currentFile: null,
  };

  return {
    get context() {
      return _context;
    },
    send(event: string, payload?: Record<string, unknown>) {
      switch (event) {
        case 'OPEN_PANEL':
          _context.panelVisible = true;
          break;
        case 'OPEN_FILE': {
          const path = payload?.path as string;
          _context.currentFile = path;
          _context.view = 'ThreeColumn';
          _context.editing = false;
          _context.saved = false;
          break;
        }
        case 'EDIT':
          _context.editing = true;
          _context.saved = false;
          break;
        case 'SAVE':
          _context.editing = false;
          _context.saved = true;
          break;
        case 'ESC':
          _context.view = 'Default';
          _context.editing = false;
          _context.currentFile = null;
          break;
      }
    },
  };
}
