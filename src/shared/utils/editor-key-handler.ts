/**
 * Editor key handler - determines action for keyboard events in the editor
 */

interface EditorKeyOpts {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  editorMode: string;
  editorState: string;
  currentContent?: string;
}

interface EditorKeyResult {
  action: string;
  ptySignal?: string;
  clearEditor?: boolean;
  editorHandled?: boolean;
  char?: string;
  preserveContent?: boolean;
}

export function handleEditorKey(opts: EditorKeyOpts): EditorKeyResult {
  const { key, ctrlKey, metaKey, shiftKey, currentContent } = opts;

  // Ctrl+C: passthrough to PTY (interrupt)
  if (ctrlKey && key === 'c') {
    return {
      action: 'passthrough',
      ptySignal: '\x03',
      clearEditor: false,
      ...(currentContent ? { preserveContent: true } : {}),
    };
  }

  // Ctrl+Z: passthrough to PTY (suspend)
  if (ctrlKey && key === 'z') {
    return {
      action: 'passthrough',
      ptySignal: '\x1a',
      clearEditor: false,
    };
  }

  // Ctrl+D: passthrough to PTY (EOF)
  if (ctrlKey && key === 'd') {
    return {
      action: 'passthrough',
      ptySignal: '\x04',
      editorHandled: false,
    };
  }

  // Shift+Enter: newline
  if (key === 'Enter' && shiftKey) {
    return {
      action: 'newline',
      editorHandled: true,
    };
  }

  // Enter or Cmd+Enter: submit
  if (key === 'Enter' && (!ctrlKey && !shiftKey)) {
    return {
      action: 'submit',
      editorHandled: true,
    };
  }

  // Normal character input
  return {
    action: 'input',
    editorHandled: true,
    char: key,
  };
}
