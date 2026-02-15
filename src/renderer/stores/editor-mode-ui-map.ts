/**
 * Editor mode -> UI state mapping.
 */

interface EditorModeUI {
  richEditorVisible: boolean;
  keyboardTarget: string;
  passthroughKeys?: string[];
  xtermKeyboardAttached: boolean;
  thumbnailVisible?: boolean;
  removeButtonVisible?: boolean;
}

interface EditorModeUIOpts {
  hasAttachedImages?: boolean;
}

export function getEditorModeUI(mode: string, opts?: EditorModeUIOpts): EditorModeUI {
  if (mode === 'RichEditor') {
    const ui: EditorModeUI = {
      richEditorVisible: true,
      keyboardTarget: 'richEditor',
      passthroughKeys: ['Ctrl+C', 'Ctrl+Z', 'Ctrl+D'],
      xtermKeyboardAttached: false,
    };
    if (opts?.hasAttachedImages) {
      ui.thumbnailVisible = true;
      ui.removeButtonVisible = true;
    }
    return ui;
  }

  // RawTerminal
  return {
    richEditorVisible: false,
    keyboardTarget: 'xterm',
    xtermKeyboardAttached: true,
  };
}
