type EditorModeState = 'RichEditor' | 'RawTerminal';

const ASB_ENTER = '\x1b[?1049h';
const ASB_EXIT = '\x1b[?1049l';

export function createEditorModeMachine() {
  let state: EditorModeState = 'RichEditor';

  function send(
    event: string | { type: string; signal?: string; [key: string]: unknown },
  ) {
    const eventType = typeof event === 'string' ? event : event.type;

    if (eventType === 'TOGGLE_MODE') {
      state = state === 'RichEditor' ? 'RawTerminal' : 'RichEditor';
      return;
    }

    if (eventType === 'ASB_SIGNAL') {
      const signal = typeof event === 'object' ? event.signal : undefined;
      if (signal === ASB_ENTER && state === 'RichEditor') {
        state = 'RawTerminal';
      } else if (signal === ASB_EXIT && state === 'RawTerminal') {
        state = 'RichEditor';
      }
    }
  }

  return {
    get state() {
      return state;
    },
    send,
  };
}
