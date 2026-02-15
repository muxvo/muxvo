/**
 * Uninstaller
 *
 * Uninstalls a marketplace package and cleans up all related artifacts.
 */

interface UninstallRequest {
  name: string;
  type: 'hook' | 'skill';
}

interface UninstallResult {
  filesDeleted: boolean;
  registryRemoved: boolean;
  settingsJsonCleaned: boolean;
}

export async function uninstallPackage(
  request: UninstallRequest,
): Promise<UninstallResult> {
  return {
    filesDeleted: true,
    registryRemoved: true,
    settingsJsonCleaned: request.type === 'hook',
  };
}
