/**
 * Security Review Dialog - configuration for hook security review
 */

const REVIEW_DIALOG_FIELDS = [
  'hookName',
  'triggerEvent',
  'executionCommand',
  'command',
  'sourceCode',
  'timeout',
];

export function getReviewDialogFields(): string[] {
  return [...REVIEW_DIALOG_FIELDS];
}

export interface SecurityReviewDialog {
  fields: string[];
  sourceCodeState: 'collapsed' | 'expanded';
  toggleSourceCode(): void;
}

export function createSecurityReviewDialog(
  _config: Record<string, unknown>,
): SecurityReviewDialog {
  let sourceCodeState: 'collapsed' | 'expanded' = 'collapsed';

  return {
    fields: [...REVIEW_DIALOG_FIELDS],
    get sourceCodeState() {
      return sourceCodeState;
    },
    toggleSourceCode() {
      sourceCodeState = sourceCodeState === 'collapsed' ? 'expanded' : 'collapsed';
    },
  };
}
