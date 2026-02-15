/**
 * TerminalTile — Single terminal tile with status indicator + xterm rendering area
 * DEV-PLAN A4: Terminal tile component
 */

import { XTermRenderer } from './XTermRenderer';
import { getTerminalProcessUI } from '@/renderer/stores/terminal-process-ui-map';

interface Props {
  id: string;
  state: string;
}

export function TerminalTile({ id, state }: Props): JSX.Element {
  const ui = getTerminalProcessUI(state);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: '#1e1e1e',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 8px',
        background: '#252526',
        borderBottom: '1px solid #3c3c3c',
        fontSize: '11px',
        color: '#858585',
        flexShrink: 0,
      }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: ui.statusDotColor,
          display: 'inline-block',
        }} />
        <span>{id}</span>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <XTermRenderer terminalId={id} />
      </div>
    </div>
  );
}
