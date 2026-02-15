/**
 * TerminalGrid — CSS Grid container for multiple terminals
 * DEV-PLAN A4: Uses calculateGridLayout for dynamic row/column calculation
 */

import { calculateGridLayout } from '@/shared/utils/grid-layout';
import { TerminalTile } from './TerminalTile';

interface TerminalInfo {
  id: string;
  state: string;
}

interface Props {
  terminals: TerminalInfo[];
}

export function TerminalGrid({ terminals }: Props): JSX.Element {
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
      {terminals.map((t) => (
        <TerminalTile key={t.id} id={t.id} state={t.state} />
      ))}
    </div>
  );
}
