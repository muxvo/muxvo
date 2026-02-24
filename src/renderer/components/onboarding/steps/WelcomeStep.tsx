/**
 * WelcomeStep -- First onboarding step showing welcome message and feature highlights.
 */

interface WelcomeStepProps {
  t: (...args: any[]) => string;
}

export function WelcomeStep({ t }: WelcomeStepProps): JSX.Element {
  return (
    <div className="welcome-step">
      <h2 className="welcome-title">{t('onboard.welcome.title')}</h2>
      <p className="welcome-desc">{t('onboard.welcome.desc')}</p>
      <div className="welcome-features">
        <div className="welcome-feature-item">
          <span className="welcome-feature-icon">&#9654;</span>
          <span>{t('onboard.welcome.feature1')}</span>
        </div>
        <div className="welcome-feature-item">
          <span className="welcome-feature-icon">&#9654;</span>
          <span>{t('onboard.welcome.feature2')}</span>
        </div>
        <div className="welcome-feature-item">
          <span className="welcome-feature-icon">&#9654;</span>
          <span>{t('onboard.welcome.feature3')}</span>
        </div>
      </div>
    </div>
  );
}
