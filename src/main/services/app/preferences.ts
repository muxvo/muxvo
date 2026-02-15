export async function getPreferences() {
  return {
    preferences: {
      theme: 'dark',
      fontSize: 14,
      locale: 'zh-CN',
    },
  };
}

export async function savePreferences(
  _prefs: Record<string, unknown>,
): Promise<{ success: boolean }> {
  return { success: true };
}
