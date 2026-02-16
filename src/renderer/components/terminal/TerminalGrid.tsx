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
}

interface Props {
  terminals: TerminalInfo[];
  viewMode?: 'Tiling' | 'Focused';
  focusedId?: string | null;
  selectedId?: string | null;
  onDoubleClick?: (id: string) => void;
  onSidebarClick?: (id: string) => void;
  onClick?: (id: string) => void;
}

export function TerminalGrid({ terminals, viewMode = 'Tiling', focusedId, selectedId, onDoubleClick, onSidebarClick, onClick }: Props): JSX.Element {
  if (terminals.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        color: '#858585',
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
      return renderTilingGrid(terminals, selectedId, onDoubleClick, onClick);
    }

    return (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* Left: focused terminal 75% */}
        <div style={{ width: '75%', height: '100%' }}>
          <TerminalTile key={focusedId} id={focusedId} state={focusedTerminal.state} focused />
        </div>
        {/* Right: sidebar 25% */}
        <div style={{
          width: '25%',
          height: '100%',
          overflowY: 'auto',
          borderLeft: '1px solid #333',
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
              <TerminalTile id={t.id} state={t.state} compact />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Tiling mode (default)
  return renderTilingGrid(terminals, selectedId, onDoubleClick, onClick);
}

function renderTilingGrid(
  terminals: TerminalInfo[],
  selectedId?: string | null,
  onDoubleClick?: (id: string) => void,
  onClick?: (id: string) => void,
): JSX.Element {
  const { cols, rows } = calculateGridLayout(terminals.length);

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap: '2px',
    width: '100%',
    height: '100%',
    background: '#000',
  };

  return (
    <div style={gridStyle}>
      {terminals.map((t, i) => (
        <TerminalTile
          key={t.id}
          id={t.id}
          state={t.state}
          selected={t.id === selectedId}
          staggerIndex={i}
          onDoubleClick={() => onDoubleClick?.(t.id)}
          onClick={() => onClick?.(t.id)}
        />
      ))}
    </div>
  );
}
