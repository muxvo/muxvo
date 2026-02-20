import { useState, useRef, useEffect } from 'react';
import type { SearchAddon } from '@xterm/addon-search';

interface Props {
  searchAddon: SearchAddon;
  visible: boolean;
  onClose: () => void;
}

export function TerminalSearchBar({ searchAddon, visible, onClose }: Props): JSX.Element | null {
  if (!visible) return null;

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query) searchAddon.findNext(query);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      searchAddon.clearDecorations();
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        searchAddon.findPrevious(query);
      } else {
        searchAddon.findNext(query);
      }
    }
  }

  return (
    <div className="terminal-search-bar">
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
        />
      </form>
      <button onClick={() => searchAddon.findPrevious(query)} title="Previous (Shift+Enter)">&#9650;</button>
      <button onClick={() => searchAddon.findNext(query)} title="Next (Enter)">&#9660;</button>
      <button onClick={() => { searchAddon.clearDecorations(); onClose(); }} title="Close (Esc)">&#10005;</button>
    </div>
  );
}
