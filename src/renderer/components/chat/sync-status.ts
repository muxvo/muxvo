/**
 * Sync Status Config
 *
 * Configuration for the sync status indicator at the bottom of the chat panel.
 */

export function getSyncStatusConfig() {
  return {
    text: 'Muxvo 镜像 · 最后同步 HH:MM',
    syncingIcon: 'spinning' as const,
  };
}
