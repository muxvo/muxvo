/**
 * FeatureTourStep -- Shows a grid of key features the user can explore.
 */

interface FeatureTourStepProps {
  t: (...args: any[]) => string;
}

export function FeatureTourStep({ t }: FeatureTourStepProps): JSX.Element {
  const features = [
    { icon: '>_', titleKey: 'onboard.tour.terminals', descKey: 'onboard.tour.terminalsDesc' },
    { icon: '\u2637', titleKey: 'onboard.tour.chat', descKey: 'onboard.tour.chatDesc' },
    { icon: '\u26A1', titleKey: 'onboard.tour.skills', descKey: 'onboard.tour.skillsDesc' },
    { icon: '\u2699', titleKey: 'onboard.tour.mcp', descKey: 'onboard.tour.mcpDesc' },
    { icon: '\u21BB', titleKey: 'onboard.tour.hooks', descKey: 'onboard.tour.hooksDesc' },
  ];

  return (
    <div className="tour-step">
      <h2 className="tour-step-title">{t('onboard.tour.title')}</h2>
      <p className="tour-step-desc">{t('onboard.tour.desc')}</p>
      <div className="tour-grid">
        {features.map((f) => (
          <div className="tour-card" key={f.titleKey}>
            <div className="tour-card-icon">{f.icon}</div>
            <div className="tour-card-title">{t(f.titleKey)}</div>
            <div className="tour-card-desc">{t(f.descKey)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
