/**
 * OnboardingModal — First-run onboarding wizard (5 steps).
 * Reads `onboardingCompleted` from app config; if true, renders nothing.
 */

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';
import { WelcomeStep } from './steps/WelcomeStep';
import { CliDetectionStep } from './steps/CliDetectionStep';
import { CreateTerminalStep } from './steps/CreateTerminalStep';
import { FeatureTourStep } from './steps/FeatureTourStep';
import { ShortcutsStep } from './steps/ShortcutsStep';
import './OnboardingModal.css';

interface OnboardingModalProps {
  onCreateTerminal: (cwd: string) => void;
}

const TOTAL_STEPS = 5;

export function OnboardingModal({ onCreateTerminal }: OnboardingModalProps): JSX.Element | null {
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  // CLI detection (Step 2)
  const [cliResults, setCliResults] = useState<{ name: string; installed: boolean; path?: string }[]>([]);
  const [detecting, setDetecting] = useState(false);

  // Terminal creation (Step 3)
  const [terminalCreated, setTerminalCreated] = useState(false);
  const [selectedDir, setSelectedDir] = useState('');

  // Check onboarding status on mount
  useEffect(() => {
    window.api.app.getConfig().then((config) => {
      if (!config.onboardingCompleted) {
        setShow(true);
      }
      setLoading(false);
    });
  }, []);

  // Run CLI detection when entering Step 2
  useEffect(() => {
    if (currentStep === 2) {
      setDetecting(true);
      window.api.app.detectCliTools().then((results) => {
        setCliResults(results);
        setDetecting(false);
      });
    }
  }, [currentStep]);

  const handleComplete = useCallback(() => {
    window.api.app.saveConfig({ onboardingCompleted: true });
    setShow(false);
  }, []);

  const handleNext = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
  }, []);

  const handlePrev = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }, []);

  const handleSelectDirectory = useCallback(async () => {
    const path = await window.api.fs.selectDirectory();
    if (path) {
      onCreateTerminal(path);
      setSelectedDir(path);
      setTerminalCreated(true);
    }
  }, [onCreateTerminal]);

  const handleQuickPath = useCallback((path: string) => {
    onCreateTerminal(path);
    setSelectedDir(path);
    setTerminalCreated(true);
  }, [onCreateTerminal]);

  if (loading || !show) return null;

  const renderStep = (): JSX.Element => {
    switch (currentStep) {
      case 1:
        return <WelcomeStep t={t} onNext={handleNext} />;
      case 2:
        return (
          <CliDetectionStep
            t={t}
            onNext={handleNext}
            cliResults={cliResults}
            detecting={detecting}
          />
        );
      case 3:
        return (
          <CreateTerminalStep
            t={t}
            onNext={handleNext}
            onSelectDirectory={handleSelectDirectory}
            onQuickPath={handleQuickPath}
            terminalCreated={terminalCreated}
            selectedDir={selectedDir}
          />
        );
      case 4:
        return <FeatureTourStep t={t} onNext={handleNext} />;
      case 5:
        return <ShortcutsStep t={t} onNext={handleComplete} />;
      default:
        return <WelcomeStep t={t} onNext={handleNext} />;
    }
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        {/* Progress indicator */}
        <div className="onboarding-progress">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const step = i + 1;
            let className = 'onboarding-progress-dot';
            if (step < currentStep) className += ' completed';
            else if (step === currentStep) className += ' active';
            return <div key={step} className={className} />;
          })}
        </div>

        {/* Step content with fade-in animation via key remount */}
        <div className="onboarding-content fade-in" key={currentStep}>
          {renderStep()}
        </div>

        {/* Footer buttons */}
        <div className="onboarding-footer">
          <button className="onboarding-btn-skip" onClick={handleComplete}>
            {t('onboarding.skip')}
          </button>
          <div>
            {currentStep > 1 && (
              <button className="onboarding-btn-prev" onClick={handlePrev}>
                {t('onboarding.prev')}
              </button>
            )}
            {currentStep < TOTAL_STEPS ? (
              <button className="onboarding-btn-next" onClick={handleNext}>
                {t('onboarding.next')}
              </button>
            ) : (
              <button className="onboarding-btn-done" onClick={handleComplete}>
                {t('onboarding.done')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
