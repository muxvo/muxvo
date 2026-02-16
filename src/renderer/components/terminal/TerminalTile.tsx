/**
 * TerminalTile — Single terminal tile with status indicator + xterm rendering area
 * DEV-PLAN A4: Terminal tile component
 * DEV-PLAN B2/B3: Focus mode interactions + 3D visual effects
 */

import { XTermRenderer } from './XTermRenderer';
import { getTerminalProcessUI } from '@/renderer/stores/terminal-process-ui-map';
import { useTileEffects } from './useTileEffects';
import './TileEffects.css';

interface Props {
  id: string;
  state: string;
  onDoubleClick?: () => void;
  onClick?: () => void;
  compact?: boolean;
  focused?: boolean;
  selected?: boolean;
  staggerIndex?: number;
}

export function TerminalTile({ id, state, onDoubleClick, onClick, compact, focused, selected, staggerIndex }: Props): JSX.Element {
  const ui = getTerminalProcessUI(state);
  const { containerRef, handleMouseMove, handleMouseLeave } = useTileEffects({
    enabled: !compact,
  });

  const classNames = [
    'tile-3d',
    !compact ? 'tile-enter' : '',
    focused ? 'tile-focused' : '',
    selected ? 'tile-selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      className={classNames}
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#1e1e1e',
        height: '100%',
        '--stagger-index': staggerIndex ?? 0,
      } as React.CSSProperties}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
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
        <span
          className={state === 'Running' ? 'status-dot-pulse' : ''}
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: ui.statusDotColor,
            display: 'inline-block',
          }}
        />
        <span>{id}</span>
      </div>
      <div className="tile-3d-inner" style={{ flex: 1, overflow: 'hidden' }}>
        <XTermRenderer terminalId={id} />
      </div>
    </div>
  );
}
