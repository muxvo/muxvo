/**
 * Community Install Bridge - handles install actions from community pages
 */

export interface InstallActionInput {
  muxvoInstalled: boolean;
  packageName: string;
}

export interface InstallActionResult {
  action: 'deep-link' | 'manual';
  url?: string;
}

export function resolveInstallAction(input: InstallActionInput): InstallActionResult {
  if (input.muxvoInstalled) {
    return {
      action: 'deep-link',
      url: `muxvo://install/${input.packageName}`,
    };
  }
  return { action: 'manual' };
}

export interface OneClickInstallInput {
  skillId: string;
  sourceCodePublic: boolean;
}

export interface OneClickInstallResult {
  oneClickAvailable: boolean;
}

export function checkOneClickInstall(input: OneClickInstallInput): OneClickInstallResult {
  return {
    oneClickAvailable: input.sourceCodePublic,
  };
}
