/**
 * BottomBar — Bottom control bar for terminal management
 * DEV-PLAN A1: 底部控制栏
 * DEV-PLAN A4: Terminal count display + new terminal button
 */

import './BottomBar.css';

interface Props {
  terminalCount?: number;
  onAddTerminal?: () => void;
  maxReached?: boolean;
}

export function BottomBar({ terminalCount = 0, onAddTerminal, maxReached }: Props): JSX.Element {
  return (
    <footer className="bottom-bar">
      <span className="bottom-bar-info">
        {terminalCount === 0 ? 'No terminals' : `${terminalCount} terminal${terminalCount > 1 ? 's' : ''}`}
      </span>
      {onAddTerminal && (
        <button
          className={`bottom-bar-add${maxReached ? ' bottom-bar-add--disabled' : ''}`}
          onClick={onAddTerminal}
          disabled={maxReached}
          title={maxReached ? 'Maximum 20 terminals reached' : 'New terminal'}
        >
          +
        </button>
      )}
    </footer>
  );
}
