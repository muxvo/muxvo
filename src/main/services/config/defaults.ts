/**
 * Default Configuration
 *
 * First-launch default configuration values (8 items).
 */

export function getDefaultConfig() {
  return {
    window: {
      width: 1400,
      height: 900,
    },
    fontSize: 14,
    theme: 'dark' as const,
    gridLayout: {
      columnRatios: [1, 1],
      rowRatios: [1, 1],
    },
    ftvLeftWidth: 250,
    ftvRightWidth: 280,
  };
}
