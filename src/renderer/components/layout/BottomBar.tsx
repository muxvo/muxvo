/**
 * BottomBar — Bottom control bar for terminal management
 * DEV-PLAN A1: 底部控制栏
 * DEV-PLAN A4: Terminal count display + new terminal button
 */

import { useI18n } from '@/renderer/i18n';
import './BottomBar.css';

interface Props {
  terminalCount?: number;
  onAddTerminal?: () => void;
  maxReached?: boolean;
}

export function BottomBar({ terminalCount = 0, onAddTerminal, maxReached }: Props): JSX.Element {
  const { t } = useI18n();
  return (
    <footer className="bottom-bar">
      <span className="bottom-bar-info">
        {terminalCount === 0 ? t('terminal.noTerminals') : t('terminal.count', { count: terminalCount })}
      </span>
      {onAddTerminal && (
        <button
          className={`bottom-bar-add${maxReached ? ' bottom-bar-add--disabled' : ''}`}
          onClick={onAddTerminal}
          disabled={maxReached}
          title={maxReached ? t('terminal.maxReached') : t('menu.newTerminal')}
        >
          +
        </button>
      )}
    </footer>
  );
}
