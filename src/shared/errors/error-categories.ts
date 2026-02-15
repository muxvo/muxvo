export const ErrorCategories = {
  autoRecoverable: [
    'download retry',
    'JSONL skip',
    'file locked skip',
    'partial source fallback',
  ],
  userActionRequired: [
    'process crash',
    'file read fail',
    'network offline',
    'permission error',
  ],
  blocking: [
    'API key detected',
    'sensitive file detected',
    'integrity check failed',
  ],
} as const;
