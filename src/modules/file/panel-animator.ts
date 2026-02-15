/**
 * Panel animator - manages CSS transition timing for file panel
 */

export function createPanelAnimator(transitionMs: number) {
  let _transitioning = false;
  let _startTime = 0;

  return {
    startTransition() {
      _transitioning = true;
      _startTime = 0;
    },
    handleClick(atMs: number) {
      if (_transitioning && atMs < transitionMs) {
        return { queued: true, handled: false };
      }
      _transitioning = false;
      return { queued: false, handled: true };
    },
  };
}
