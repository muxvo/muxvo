/**
 * FloatingControls — Bottom floating pill bar for terminal management
 * Displays add/remove buttons and terminal count.
 */

import './FloatingControls.css';

interface FloatingControlsProps {
  terminalCount: number;
  onAddTerminal: () => void;
  maxReached?: boolean;
}

export function FloatingControls({
  terminalCount,
  onAddTerminal,
  maxReached,
}: FloatingControlsProps): JSX.Element {
  return (
    <div className="floating-controls">
      <button
        className="floating-controls__btn floating-controls__btn--accent"
        onClick={onAddTerminal}
        disabled={maxReached}
      >
        + 新建终端
      </button>
      <div className="floating-controls__count">
        {terminalCount} 个终端
      </div>
    </div>
  );
}
