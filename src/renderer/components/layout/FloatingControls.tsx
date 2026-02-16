/**
 * FloatingControls — Bottom floating pill bar for terminal management
 * Displays add/remove buttons and terminal count.
 */

import './FloatingControls.css';

interface FloatingControlsProps {
  terminalCount: number;
  onAddTerminal: () => void;
  onRemoveTerminal: () => void;
}

export function FloatingControls({
  terminalCount,
  onAddTerminal,
  onRemoveTerminal,
}: FloatingControlsProps): JSX.Element {
  return (
    <div className="floating-controls">
      <button
        className="floating-controls__btn floating-controls__btn--accent"
        onClick={onAddTerminal}
      >
        + New
      </button>
      <button className="floating-controls__btn" onClick={onRemoveTerminal}>
        - Remove
      </button>
      <div className="floating-controls__count">
        {terminalCount} terminal{terminalCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
