/**
 * ShortcutsStep -- Displays key shortcuts and interactions the user should know.
 */

interface ShortcutsStepProps {
  t: (...args: any[]) => string;
}

export function ShortcutsStep({ t }: ShortcutsStepProps): JSX.Element {
  const shortcuts = [
    { key: 'Double Click', desc: 'Enter focus mode' },
    { key: 'Esc', desc: 'Back to tiling view' },
    { key: 'Click Path', desc: 'Switch working directory' },
    { key: '+ Button', desc: 'Create new terminal' },
  ];

  return (
    <div className="shortcuts-step">
      <h2 className="shortcuts-step-title">{t('onboard.shortcuts.title')}</h2>
      <p className="shortcuts-step-desc">{t('onboard.shortcuts.desc')}</p>
      <div className="shortcut-list">
        {shortcuts.map((s, i) => (
          <div className="shortcut-card" key={i}>
            <span className="shortcut-key">{s.key}</span>
            <span className="shortcut-arrow">&rarr;</span>
            <span className="shortcut-desc">{s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
