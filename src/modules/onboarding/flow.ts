/**
 * Onboarding flow module - 4-step onboarding process
 */

import { _internals } from './status';

export function createOnboardingFlow() {
  let _currentStep = 1;
  let _completed = false;
  const _totalSteps = 4;

  return {
    get totalSteps() {
      return _totalSteps;
    },
    get currentStep() {
      return _currentStep;
    },
    get completed() {
      return _completed;
    },
    completeStep(step: number) {
      if (step === _currentStep) {
        if (step < _totalSteps) {
          _currentStep = step + 1;
        } else {
          _completed = true;
          _internals.markCompleted();
        }
      }
    },
  };
}
