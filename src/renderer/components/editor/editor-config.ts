/**
 * Editor default configuration.
 */

export interface EditorDefaults {
  mode: string;
  sendKey: {
    send: string[];
    newline: string;
  };
  technology: string;
}

export function getEditorDefaults(): EditorDefaults {
  return {
    mode: 'RichEditor',
    sendKey: {
      send: ['Enter', 'Cmd+Enter'],
      newline: 'Shift+Enter',
    },
    technology: 'contenteditable div',
  };
}
