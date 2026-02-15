/**
 * Session Card Config
 *
 * Default field configuration for session cards in the middle panel.
 */

export function getSessionCardConfig() {
  return {
    fields: ['title', 'time', 'preview', 'tags', 'toolCallCount'],
    timeFormat: 'today:HH:MM / yesterday / MM-DD',
    previewTruncate: '2 lines' as const,
  };
}
