/**
 * File Panel Animation
 *
 * Provides animation configuration for file panel slide-in/out.
 */

export interface FilePanelAnimationConfig {
  from: string;
  to: string;
  duration: number;
  direction: string;
}

export function getFilePanelAnimation(): FilePanelAnimationConfig {
  return {
    from: 'translateX(100%)',
    to: 'translateX(0)',
    duration: 300,
    direction: 'from right',
  };
}
