/**
 * TerminalTile — Single terminal tile with status indicator + xterm rendering area
 * DEV-PLAN A4: Terminal tile component
 * DEV-PLAN B2/B3: Focus mode interactions + 3D visual effects
 * Module I: I1 Tile Header改造 + I4 自定义名称编辑
 */

import { useState, useRef, useEffect } from 'react';
import { XTermRenderer } from './XTermRenderer';
import { getTerminalProcessUI } from '@/renderer/stores/terminal-process-ui-map';
import { useTileEffects } from './useTileEffects';
import { createNamingMachine } from '@/shared/machines/terminal-naming';
import { CwdPicker } from './CwdPicker';
import './TileEffects.css';

interface Props {
  id: string;
  state: string;
  cwd: string;
  onDoubleClick?: () => void;
  onClick?: () => void;
  onCwdChange?: (id: string, newCwd: string) => void;
  compact?: boolean;
  focused?: boolean;
  selected?: boolean;
  staggerIndex?: number;
}

export function TerminalTile({
  id,
  state,
  cwd,
  onDoubleClick,
  onClick,
  onCwdChange,
  compact,
  focused,
  selected,
  staggerIndex
}: Props): JSX.Element {
  const ui = getTerminalProcessUI(state);
  const { containerRef, handleMouseMove, handleMouseLeave } = useTileEffects({
    enabled: !compact,
  });

  // Naming machine state
  const namingRef = useRef(createNamingMachine());
  const [namingState, setNamingState] = useState(namingRef.current.state);
  const [namingContext, setNamingContext] = useState(namingRef.current.context);
  const [inputValue, setInputValue] = useState('');

  function sendNaming(event: string | { type: string; value?: string }) {
    namingRef.current.send(event);
    setNamingState(namingRef.current.state);
    setNamingContext(namingRef.current.context);
  }

  // Initialize input value when entering Editing state
  useEffect(() => {
    if (namingState === 'Editing') {
      setInputValue(namingContext.editValue);
    }
  }, [namingState, namingContext.editValue]);

  const classNames = [
    'tile-3d',
    !compact ? 'tile-enter' : '',
    focused ? 'tile-focused' : '',
    selected ? 'tile-selected' : '',
  ].filter(Boolean).join(' ');

  function shortenPath(path: string): string {
    const home = typeof process !== 'undefined' && process.env?.HOME ? process.env.HOME : '';
    if (home && path.startsWith(home)) {
      return '~' + path.slice(home.length);
    }
    return path;
  }

  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);

  const handleCwdClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!compact) setCwdPickerOpen(true);
  };

  const handlePlaceholderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendNaming('CLICK_PLACEHOLDER');
  };

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendNaming('CLICK_NAME');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendNaming({ type: 'ENTER', value: inputValue });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      sendNaming('ESC');
    }
  };

  const handleInputBlur = () => {
    sendNaming({ type: 'BLUR', value: inputValue });
  };

  const handleFocusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.();
  };

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
      {/* Header: [status-dot] [cwd] [· name-area] [⤢] */}
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
        {/* Status dot */}
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

        {/* Cwd path (clickable) */}
        <span style={{ cursor: 'pointer', color: '#858585' }} onClick={handleCwdClick}>
          {shortenPath(cwd)}
        </span>

        {/* Name area (only in non-compact mode) */}
        {!compact && (
          <>
            {namingState === 'Editing' ? (
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onBlur={handleInputBlur}
                autoFocus
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#ccc',
                  fontSize: '11px',
                  padding: '0',
                  width: '100px',
                  borderBottom: '1px solid #007acc',
                }}
              />
            ) : namingState === 'DisplayNamed' ? (
              <>
                <span style={{ color: '#555' }}> · </span>
                <span style={{ cursor: 'pointer', color: '#ccc' }} onClick={handleNameClick}>
                  {namingContext.displayText}
                </span>
              </>
            ) : (
              <span
                style={{ cursor: 'pointer', color: '#555', fontStyle: 'italic' }}
                onClick={handlePlaceholderClick}
              >
                命名...
              </span>
            )}

            {/* Spacer */}
            <span style={{ flex: 1 }} />

            {/* Focus button */}
            <span
              style={{ cursor: 'pointer', fontSize: '12px', color: '#858585' }}
              onClick={handleFocusClick}
            >
              ⤢
            </span>
          </>
        )}
      </div>

      {/* CwdPicker popup */}
      {!compact && (
        <CwdPicker
          terminalId={id}
          currentCwd={cwd}
          open={cwdPickerOpen}
          onClose={() => setCwdPickerOpen(false)}
          onCwdChange={(newCwd) => onCwdChange?.(id, newCwd)}
        />
      )}

      {/* Terminal content */}
      <div className="tile-3d-inner" style={{ flex: 1, overflow: 'hidden' }}>
        <XTermRenderer terminalId={id} />
      </div>
    </div>
  );
}
