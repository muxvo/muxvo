/**
 * Terminal view mode manager - handles focus/tiling mode switching
 */

export function createViewModeManager() {
  let _mode: 'tiling' | 'focused' = 'tiling';
  let _focusedIndex: number | null = null;

  return {
    get mode() {
      return _mode;
    },
    get focusedIndex() {
      return _focusedIndex;
    },
    focusTerminal(index: number) {
      _mode = 'focused';
      _focusedIndex = index;
    },
    handleEsc() {
      _mode = 'tiling';
      _focusedIndex = null;
    },
  };
}
