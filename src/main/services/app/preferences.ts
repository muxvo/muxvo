import * as fs from 'fs';
import * as path from 'path';

let _configDir: string | null = null;

export function initPrefsDir(dir: string): void {
  _configDir = dir;
}

function getPrefsPath(): string | null {
  if (!_configDir) return null;
  return path.join(_configDir, 'preferences.json');
}

export async function getPreferences(): Promise<{ preferences: Record<string, unknown> }> {
  const prefsPath = getPrefsPath();
  if (!prefsPath) return { preferences: {} };
  try {
    if (!fs.existsSync(prefsPath)) return { preferences: {} };
    const raw = fs.readFileSync(prefsPath, 'utf-8');
    return { preferences: JSON.parse(raw) };
  } catch {
    return { preferences: {} };
  }
}

export async function savePreferences(
  prefs: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const prefsPath = getPrefsPath();
  if (!prefsPath || !_configDir) return { success: true };
  try {
    // Read existing, merge, write
    let existing: Record<string, unknown> = {};
    try {
      if (fs.existsSync(prefsPath)) {
        existing = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    const merged = { ...existing, ...prefs };
    const tmpPath = prefsPath + '.tmp';
    if (!fs.existsSync(_configDir)) {
      fs.mkdirSync(_configDir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tmpPath, prefsPath);
    return { success: true };
  } catch {
    return { success: true }; // Graceful degradation
  }
}
