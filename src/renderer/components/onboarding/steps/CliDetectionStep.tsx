/**
 * CliDetectionStep -- Displays CLI tool detection results during onboarding.
 */

interface CliDetectionStepProps {
  t: (...args: any[]) => string;
  results: { name: string; installed: boolean; path?: string }[];
  detecting: boolean;
}

export function CliDetectionStep({ t, results, detecting }: CliDetectionStepProps): JSX.Element {
  const noneInstalled = !detecting && results.length > 0 && results.every((r) => !r.installed);

  return (
    <div className="cli-step">
      <h2 className="cli-step-title">{t('onboard.cli.title')}</h2>
      <p className="cli-step-desc">{t('onboard.cli.desc')}</p>
      <div className="cli-tool-list">
        {detecting ? (
          <div className="cli-tool-row">
            <span className="cli-detecting-spinner" />
            <span>{t('onboard.cli.detecting')}</span>
          </div>
        ) : (
          results.map((tool) => (
            <div className="cli-tool-row" key={tool.name}>
              <span
                className={`cli-status-dot ${tool.installed ? 'installed' : ''}`}
              />
              <span className="cli-tool-name">{tool.name}</span>
              <span className="cli-tool-status">
                {tool.installed ? t('onboard.cli.installed') : t('onboard.cli.notInstalled')}
              </span>
              {tool.installed && tool.path && (
                <span className="cli-tool-path">{tool.path}</span>
              )}
            </div>
          ))
        )}
      </div>
      {noneInstalled && (
        <p className="cli-none-hint">{t('onboard.cli.none')}</p>
      )}
    </div>
  );
}
