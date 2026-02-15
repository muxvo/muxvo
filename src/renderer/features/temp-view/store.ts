/**
 * Temp View Store
 *
 * State machine for the three-column temporary view:
 *   Hidden -> Active (PreviewMode / EditMode) -> Hidden
 *   With UnsavedPrompt sub-state when dirty edits exist.
 */

type TempViewState = 'Hidden' | 'Active' | 'UnsavedPrompt';
type ViewMode = 'PreviewMode' | 'EditMode';

const MIN_COLUMN_WIDTH = 150;
const MAX_COLUMN_WIDTH = 500;
const DEFAULT_LEFT_WIDTH = 250;
const DEFAULT_RIGHT_WIDTH = 280;

interface TempViewOptions {
  fresh?: boolean;
}

interface TempViewAction {
  type: string;
  fileId?: string;
  width?: number;
}

export function createTempViewStore(options?: TempViewOptions) {
  let state: TempViewState = 'Hidden';
  let mode: ViewMode = 'PreviewMode';
  let currentFile: string | null = null;
  let dirty = false;
  let saved = false;
  let gridVisible = true;
  let leftWidth = options?.fresh ? DEFAULT_LEFT_WIDTH : DEFAULT_LEFT_WIDTH;
  let rightWidth = options?.fresh ? DEFAULT_RIGHT_WIDTH : DEFAULT_RIGHT_WIDTH;
  let persistedLeftWidth: number | null = options?.fresh ? null : null;
  let persistedRightWidth: number | null = options?.fresh ? null : null;

  function clampWidth(width: number): number {
    return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width));
  }

  function dispatch(action: TempViewAction) {
    switch (action.type) {
      case 'ENTER': {
        state = 'Active';
        mode = 'PreviewMode';
        currentFile = action.fileId ?? null;
        dirty = false;
        saved = false;
        gridVisible = false;
        // Restore persisted widths if available
        if (persistedLeftWidth !== null) {
          leftWidth = persistedLeftWidth;
        }
        if (persistedRightWidth !== null) {
          rightWidth = persistedRightWidth;
        }
        break;
      }
      case 'EXIT': {
        state = 'Hidden';
        currentFile = null;
        dirty = false;
        saved = false;
        gridVisible = true;
        break;
      }
      case 'SELECT_FILE': {
        if (state === 'Active') {
          currentFile = action.fileId ?? null;
        }
        break;
      }
      case 'TOGGLE_MODE': {
        if (state === 'Active') {
          if (mode === 'EditMode' && dirty) {
            state = 'UnsavedPrompt';
          } else if (mode === 'PreviewMode') {
            mode = 'EditMode';
          } else if (mode === 'EditMode') {
            mode = 'PreviewMode';
          }
        }
        break;
      }
      case 'MODIFY': {
        if (state === 'Active' && mode === 'EditMode') {
          dirty = true;
          saved = false;
        }
        break;
      }
      case 'SAVE': {
        if (state === 'Active' && mode === 'EditMode') {
          saved = true;
          dirty = false;
        }
        break;
      }
      case 'SAVE_AND_SWITCH': {
        if (state === 'UnsavedPrompt') {
          saved = true;
          dirty = false;
          mode = 'PreviewMode';
          state = 'Active';
        }
        break;
      }
      case 'DISCARD_AND_SWITCH': {
        if (state === 'UnsavedPrompt') {
          dirty = false;
          mode = 'PreviewMode';
          state = 'Active';
        }
        break;
      }
      case 'CANCEL_PROMPT': {
        if (state === 'UnsavedPrompt') {
          state = 'Active';
          // Stay in EditMode, keep dirty state
        }
        break;
      }
      case 'RESIZE_LEFT': {
        if (action.width !== undefined) {
          leftWidth = clampWidth(action.width);
          persistedLeftWidth = leftWidth;
        }
        break;
      }
      case 'RESIZE_RIGHT': {
        if (action.width !== undefined) {
          rightWidth = clampWidth(action.width);
          persistedRightWidth = rightWidth;
        }
        break;
      }
    }
  }

  return {
    getState(): string {
      return state;
    },
    getMode(): ViewMode {
      return mode;
    },
    getCurrentFile(): string | null {
      return currentFile;
    },
    isDirty(): boolean {
      return dirty;
    },
    isSaved(): boolean {
      return saved;
    },
    isGridVisible(): boolean {
      return gridVisible;
    },
    getLeftWidth(): number {
      return leftWidth;
    },
    getRightWidth(): number {
      return rightWidth;
    },
    isUnsavedPromptVisible(): boolean {
      return state === 'UnsavedPrompt';
    },
    getPromptOptions(): string[] {
      return ['save', 'discard', 'cancel'];
    },
    dispatch,
  };
}
