/**
 * ShortcutsStep -- Displays key shortcuts and interactions the user should know.
 */

interface ShortcutsStepProps {
  t: (...args: any[]) => string;
}

export function ShortcutsStep({ t }: ShortcutsStepProps): JSX.Element {
  const shortcuts = [
    { key: t('onboard.shortcuts.dblClickTerminal'), desc: t('onboard.shortcuts.focusMode') },
    { key: 'Esc', desc: t('onboard.shortcuts.tileView') },
    { key: t('onboard.shortcuts.clickPath'), desc: t('onboard.shortcuts.switchCwd') },
    { key: t('onboard.shortcuts.plusBtn'), desc: t('onboard.shortcuts.newTerminal') },
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
