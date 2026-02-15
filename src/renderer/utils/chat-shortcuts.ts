/**
 * Chat Shortcut Handler
 *
 * Handles keyboard shortcuts for the chat panel.
 */

interface ShortcutContext {
  panelOpen: boolean;
  searchResults?: string[];
  selectedIndex?: number;
}

interface KeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

interface ShortcutResult {
  action: string;
  focusTarget?: string;
  selectedIndex?: number;
  sessionId?: string;
}

export function createChatShortcutHandler(ctx: ShortcutContext) {
  let selectedIndex = ctx.selectedIndex ?? -1;

  return {
    handle(event: KeyEvent): ShortcutResult {
      // Cmd+F opens panel and focuses search
      if (event.key === 'f' && event.metaKey) {
        return { action: 'openPanel', focusTarget: 'searchInput' };
      }

      // Escape closes panel
      if (event.key === 'Escape' && ctx.panelOpen) {
        return { action: 'closePanel' };
      }

      // Arrow keys navigate search results
      if (event.key === 'ArrowDown' && ctx.panelOpen && ctx.searchResults) {
        const newIndex = Math.min(selectedIndex + 1, ctx.searchResults.length - 1);
        selectedIndex = newIndex;
        return { action: 'selectNext', selectedIndex: newIndex };
      }

      if (event.key === 'ArrowUp' && ctx.panelOpen && ctx.searchResults) {
        const newIndex = Math.max(selectedIndex - 1, 0);
        selectedIndex = newIndex;
        return { action: 'selectPrevious', selectedIndex: newIndex };
      }

      // Enter opens selected session
      if (event.key === 'Enter' && ctx.panelOpen && ctx.searchResults) {
        const sessionId = ctx.searchResults[selectedIndex] ?? null;
        return { action: 'openSession', sessionId: sessionId ?? undefined };
      }

      return { action: 'noop' };
    },
  };
}
