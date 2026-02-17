/**
 * TerminalGrid — CSS Grid container for multiple terminals
 * DEV-PLAN A4: Uses calculateGridLayout for dynamic row/column calculation
 * DEV-PLAN B1: Focused mode layout (75% main + 25% sidebar)
 */

import { calculateGridLayout } from '@/shared/utils/grid-layout';
import { TerminalTile } from './TerminalTile';

interface TerminalInfo {
  id: string;
  state: string;
  cwd: string;
}

interface Props {
  terminals: TerminalInfo[];
  viewMode?: 'Tiling' | 'Focused';
  focusedId?: string | null;
  selectedId?: string | null;
  onDoubleClick?: (id: string) => void;
  onSidebarClick?: (id: string) => void;
  onClick?: (id: string) => void;
  onClose?: (id: string) => void;
  onCwdChange?: (id: string, newCwd: string) => void;
}

export function TerminalGrid({ terminals, viewMode = 'Tiling', focusedId, selectedId, onDoubleClick, onSidebarClick, onClick, onClose, onCwdChange }: Props): JSX.Element {
  if (terminals.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        color: 'var(--text-secondary)',
        fontSize: '13px',
      }}>
        No terminals. Click + to create one.
      </div>
    );
  }

  // Focused mode layout
  if (viewMode === 'Focused' && focusedId) {
    const focusedTerminal = terminals.find((t) => t.id === focusedId);
    const sidebarTerminals = terminals.filter((t) => t.id !== focusedId);

    if (!focusedTerminal) {
      // Fallback to tiling if focused terminal not found
      return renderTilingGrid(terminals, selectedId, onDoubleClick, onClick, onClose, onCwdChange);
    }

    return (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* Left: focused terminal 75% */}
        <div style={{ width: '75%', height: '100%' }}>
          <TerminalTile key={focusedId} id={focusedId} state={focusedTerminal.state} cwd={focusedTerminal.cwd} focused onClose={onClose} onCwdChange={onCwdChange} />
        </div>
        {/* Right: sidebar 25% */}
        <div style={{
          width: '25%',
          height: '100%',
          overflowY: 'auto',
          borderLeft: '1px solid var(--border)',
        }}>
          {sidebarTerminals.map((t) => (
            <div
              key={t.id}
              style={{
                height: `${100 / Math.min(sidebarTerminals.length, 3)}%`,
                minHeight: '150px',
                cursor: 'pointer',
              }}
              onClick={() => onSidebarClick?.(t.id)}
            >
              <TerminalTile id={t.id} state={t.state} cwd={t.cwd} compact />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Tiling mode (default)
  return renderTilingGrid(terminals, selectedId, onDoubleClick, onClick, onClose, onCwdChange);
}

function renderTilingGrid(
  terminals: TerminalInfo[],
  selectedId?: string | null,
  onDoubleClick?: (id: string) => void,
  onClick?: (id: string) => void,
  onClose?: (id: string) => void,
  onCwdChange?: (id: string, newCwd: string) => void,
): JSX.Element {
  const { cols, rows } = calculateGridLayout(terminals.length);

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap: '6px',
    padding: '6px',
    width: '100%',
    height: '100%',
    perspective: '1200px',
  };

  return (
    <div style={gridStyle}>
      {terminals.map((t, i) => (
        <TerminalTile
          key={t.id}
          id={t.id}
          state={t.state}
          cwd={t.cwd}
          selected={t.id === selectedId}
          staggerIndex={i}
          onDoubleClick={() => onDoubleClick?.(t.id)}
          onClick={() => onClick?.(t.id)}
          onClose={onClose}
          onCwdChange={onCwdChange}
        />
      ))}
    </div>
  );
}
