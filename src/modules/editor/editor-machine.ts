/**
 * Editor mode state machine
 *
 * States: RichEditor | RawTerminal
 * Transitions driven by ASB signals and manual switches
 */

interface EditorContext {
  keyboardPassthrough: boolean;
  lastPassthrough: string | null;
  editorContentPreserved: boolean;
}

export function createEditorMachine() {
  let _state: 'RichEditor' | 'RawTerminal' = 'RichEditor';
  const _context: EditorContext = {
    keyboardPassthrough: false,
    lastPassthrough: null,
    editorContentPreserved: true,
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
        case 'ASB_SIGNAL': {
          const signal = payload?.signal as string;
          if (signal === '\x1b[?1049h') {
            // Enter raw mode (e.g., vim)
            _state = 'RawTerminal';
            _context.keyboardPassthrough = true;
          } else if (signal === '\x1b[?1049l') {
            // Exit raw mode
            _state = 'RichEditor';
            _context.keyboardPassthrough = false;
          }
          break;
        }
        case 'CTRL_C': {
          _context.lastPassthrough = 'SIGINT';
          _context.editorContentPreserved = true;
          break;
        }
        case 'MANUAL_SWITCH': {
          const target = payload?.target as string;
          if (target === 'RawTerminal') {
            _state = 'RawTerminal';
            _context.keyboardPassthrough = true;
          } else if (target === 'RichEditor') {
            _state = 'RichEditor';
            _context.keyboardPassthrough = false;
          }
          break;
        }
      }
    },
  };
}
