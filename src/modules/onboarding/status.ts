/**
 * Onboarding status module
 */

let _completed = false;

export function getOnboardingStatus() {
  return {
    get onboardingCompleted() {
      return _completed;
    },
  };
}

export function setOnboardingCompleted(value: boolean) {
  _completed = value;
}

// Allow the flow module to mark completion
export const _internals = {
  markCompleted() {
    _completed = true;
  },
};
