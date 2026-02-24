/**
 * CreateTerminalStep -- Lets the user pick a working directory and create a terminal.
 */

import { useState, useEffect } from 'react';

interface CreateTerminalStepProps {
  t: (...args: any[]) => string;
  onSelectDirectory: () => void;
  onQuickPath: (path: string) => void;
  terminalCreated: boolean;
  selectedDir?: string;
}

export function CreateTerminalStep({
  t,
  onSelectDirectory,
  onQuickPath,
  terminalCreated,
  selectedDir,
}: CreateTerminalStepProps): JSX.Element {
  const [homePath, setHomePath] = useState<string>('~');

  useEffect(() => {
    window.api.app.getHomePath().then((p: string) => setHomePath(p));
  }, []);

  const quickPaths = [
    { label: 'Home (~)', path: homePath },
    { label: 'Desktop', path: `${homePath}/Desktop` },
    { label: 'Documents', path: `${homePath}/Documents` },
  ];

  return (
    <div className="terminal-step">
      <h2 className="terminal-step-title">{t('onboard.terminal.title')}</h2>
      <p className="terminal-step-desc">{t('onboard.terminal.desc')}</p>

      {terminalCreated ? (
        <div className="terminal-created-msg">
          <span>{t('onboard.terminal.created')}</span>
          {selectedDir && <span className="terminal-created-path">{selectedDir}</span>}
        </div>
      ) : (
        <>
          <button className="terminal-select-btn" onClick={onSelectDirectory}>
            {t('onboard.terminal.selectDir')}
          </button>
          <div className="terminal-or-text">{t('onboard.terminal.or')}</div>
          <div className="terminal-quick-label">{t('onboard.terminal.quickLabel')}</div>
          <div className="terminal-quick-paths">
            {quickPaths.map((qp) => (
              <button
                key={qp.label}
                className="terminal-quick-path-btn"
                onClick={() => onQuickPath(qp.path)}
              >
                {qp.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
