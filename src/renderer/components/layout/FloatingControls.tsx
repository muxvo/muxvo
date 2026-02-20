/**
 * FloatingControls — Bottom floating pill bar for terminal management
 * Displays add/remove buttons and terminal count.
 */

import { useI18n } from '@/renderer/i18n';
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
  const { t } = useI18n();
  return (
    <div className="floating-controls">
      <button
        className="floating-controls__btn floating-controls__btn--accent"
        onClick={onAddTerminal}
        disabled={maxReached}
      >
        {t('floating.newTerminal')}
      </button>
      <div className="floating-controls__count">
        {t('terminal.count', { count: terminalCount })}
      </div>
    </div>
  );
}
