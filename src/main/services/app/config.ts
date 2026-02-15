export async function getAppConfig() {
  return {
    window: { width: 1400, height: 900, x: 100, y: 100 },
    openTerminals: [] as Array<{ id: string }>,
    gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
    theme: 'dark',
    fontSize: 14,
    ftvLeftWidth: 250,
    ftvRightWidth: 300,
  };
}

export async function saveAppConfig(
  _config: Record<string, unknown>,
): Promise<{ success: boolean }> {
  return { success: true };
}
