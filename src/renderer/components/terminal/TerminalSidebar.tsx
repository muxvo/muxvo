import { TerminalTile } from './TerminalTile';
import './TerminalSidebar.css';

interface TerminalInfo {
  id: string;
  state: string;
  cwd: string;
  customName?: string;
}

interface TerminalSidebarProps {
  terminals: TerminalInfo[];
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function TerminalSidebar({ terminals, onSelect, onClose, className, style }: TerminalSidebarProps) {
  const visibleCount = Math.min(terminals.length, 3);
  return (
    <div className={`terminal-sidebar ${className ?? ''}`} style={style}>
      {terminals.map((t) => (
        <div
          key={t.id}
          className="terminal-sidebar__item"
          style={{ height: `${100 / visibleCount}%` }}
          onClick={() => onSelect?.(t.id)}
        >
          <TerminalTile
            id={t.id}
            state={t.state}
            cwd={t.cwd}
            customName={t.customName}
            compact
            onClose={onClose ? () => onClose(t.id) : undefined}
          />
        </div>
      ))}
    </div>
  );
}
