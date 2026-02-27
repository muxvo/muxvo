/**
 * Tour step definitions — maps each onboarding step to a UI element
 */

export type ActionType = 'create-terminal' | 'observe' | 'focus' | 'rename' | 'open-file';
export type AllowedButton = 'next' | 'previous' | 'close';

export interface TourStep {
  id: string;
  selector: string;
  i18nTitleKey: string;
  i18nDescKey: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  /** If true, this step requires at least one terminal to exist */
  needsTerminal?: boolean;
  /** If true, user must perform an action to advance (no Next button) */
  interactive: boolean;
  /** What type of action this step expects */
  actionType: ActionType;
  /** Which popover buttons to show */
  showButtons: AllowedButton[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'create-terminal',
    selector: '.terminal-grid__fab',
    i18nTitleKey: 'tour.step1.title',
    i18nDescKey: 'tour.step1.desc',
    side: 'bottom',
    interactive: true,
    actionType: 'create-terminal',
    showButtons: ['close'],
  },
  {
    id: 'focus-terminal',
    selector: '.tile-max-btn',
    i18nTitleKey: 'tour.step3.title',
    i18nDescKey: 'tour.step3.desc',
    side: 'bottom',
    needsTerminal: true,
    interactive: true,
    actionType: 'focus',
    showButtons: ['close'],
  },
  {
    id: 'rename-terminal',
    selector: '.tile-custom-name--placeholder, .tile-custom-name',
    i18nTitleKey: 'tour.step4.title',
    i18nDescKey: 'tour.step4.desc',
    side: 'bottom',
    needsTerminal: true,
    interactive: true,
    actionType: 'rename',
    showButtons: ['close'],
  },
  {
    id: 'open-files',
    selector: '.tile-file-btn',
    i18nTitleKey: 'tour.step5.title',
    i18nDescKey: 'tour.step5.desc',
    side: 'bottom',
    needsTerminal: true,
    interactive: true,
    actionType: 'open-file',
    showButtons: ['close'],
  },
];
