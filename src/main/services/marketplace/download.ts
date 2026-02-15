/**
 * Marketplace Download Config
 *
 * Download configuration with auto-retry settings.
 */

export function getDownloadConfig() {
  return {
    autoRetryCount: 1,
    timeout: 30000,
  };
}
