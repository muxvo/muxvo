/**
 * App preferences module
 */

const _preferences: Record<string, unknown> = {};

export async function updatePreference(key: string, value: unknown) {
  _preferences[key] = value;
}

export function getPreference(key: string) {
  return _preferences[key];
}
