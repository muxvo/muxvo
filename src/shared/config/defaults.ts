export function getDefaultConfig() {
  return {
    window: { width: 1400, height: 900 },
    font: { size: 14 },
    theme: 'dark' as const,
    tile: {
      columnRatios: [1, 1],
      rowRatios: [1, 1],
    },
  };
}
