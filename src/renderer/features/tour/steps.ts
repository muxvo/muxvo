/**
 * Tour step definitions — maps each onboarding step to a UI element
 */

export interface TourStep {
  id: string;
  selector: string;
  i18nTitleKey: string;
  i18nDescKey: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  /** If true, this step requires at least one terminal to exist */
  needsTerminal?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'create-terminal',
    selector: '.menu-bar__add-btn',
    i18nTitleKey: 'tour.step1.title',
    i18nDescKey: 'tour.step1.desc',
    side: 'bottom',
  },
  {
    id: 'tile-view',
    selector: '.app-content',
    i18nTitleKey: 'tour.step2.title',
    i18nDescKey: 'tour.step2.desc',
    side: 'top',
    needsTerminal: true,
  },
  {
    id: 'focus-terminal',
    selector: '.tile-max-btn',
    i18nTitleKey: 'tour.step3.title',
    i18nDescKey: 'tour.step3.desc',
    side: 'bottom',
    needsTerminal: true,
  },
  {
    id: 'rename-terminal',
    selector: '.tile-custom-name--placeholder, .tile-custom-name',
    i18nTitleKey: 'tour.step4.title',
    i18nDescKey: 'tour.step4.desc',
    side: 'bottom',
    needsTerminal: true,
  },
  {
    id: 'open-files',
    selector: '.tile-file-btn',
    i18nTitleKey: 'tour.step5.title',
    i18nDescKey: 'tour.step5.desc',
    side: 'bottom',
    needsTerminal: true,
  },
];
