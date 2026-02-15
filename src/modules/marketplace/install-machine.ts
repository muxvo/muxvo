/**
 * Install Machine
 *
 * State machine for package install/update/uninstall lifecycle (PRD 6.15).
 * States: NotInstalled -> Downloading -> SecurityReview/Installing ->
 *         Installed -> UpdateAvailable -> Uninstalling
 */

interface InstallConfig {
  packageType: 'hook' | 'skill';
  currentVersion?: string;
}

interface InstallContext {
  packageType: 'hook' | 'skill';
  version: string;
  latestVersion: string | null;
  showBadge: boolean;
  error: string | null;
  filesWritten: boolean;
  registryUpdated: boolean;
  settingsJsonUpdated: boolean;
}

export interface InstallMachine {
  state: string;
  context: InstallContext;
  send(event: string, payload?: Record<string, unknown>): void;
}

export function createInstallMachine(config: InstallConfig): InstallMachine {
  const context: InstallContext = {
    packageType: config.packageType,
    version: config.currentVersion ?? '0.0.0',
    latestVersion: null,
    showBadge: false,
    error: null,
    filesWritten: false,
    registryUpdated: false,
    settingsJsonUpdated: false,
  };

  let state = 'NotInstalled';

  const machine: InstallMachine = {
    get state() {
      return state;
    },
    set state(v: string) {
      state = v;
    },
    context,

    send(event: string, payload?: Record<string, unknown>) {
      switch (state) {
        case 'NotInstalled':
          if (event === 'START_INSTALL') {
            state = 'Downloading';
          }
          break;

        case 'Downloading':
          if (event === 'DOWNLOAD_COMPLETE') {
            if (context.packageType === 'hook') {
              state = 'SecurityReview';
            } else {
              state = 'Installing';
            }
          } else if (event === 'DOWNLOAD_FAILED') {
            state = 'InstallFailed';
            context.error = (payload as { error: string })?.error ?? 'Download failed';
          }
          break;

        case 'SecurityReview':
          if (event === 'CONFIRM_INSTALL') {
            state = 'Installing';
            context.settingsJsonUpdated = true;
          } else if (event === 'CANCEL' || event === 'ESC') {
            state = 'NotInstalled';
            context.filesWritten = false;
            context.registryUpdated = false;
          }
          break;

        case 'Installing':
          if (event === 'INSTALL_COMPLETE') {
            state = 'Installed';
            context.filesWritten = true;
            context.registryUpdated = true;
            if (context.latestVersion) {
              context.version = context.latestVersion;
              context.latestVersion = null;
              context.showBadge = false;
            }
          } else if (event === 'INSTALL_FAILED') {
            state = 'InstallFailed';
            context.error = (payload as { error: string })?.error ?? 'Unknown error';
          }
          break;

        case 'Installed':
          if (event === 'UPDATE_AVAILABLE') {
            state = 'UpdateAvailable';
            context.latestVersion =
              (payload as { latestVersion: string }).latestVersion;
            context.showBadge = true;
          } else if (event === 'UNINSTALL') {
            state = 'Uninstalling';
          }
          break;

        case 'UpdateAvailable':
          if (event === 'START_UPDATE') {
            state = 'Downloading';
          } else if (event === 'UNINSTALL') {
            state = 'Uninstalling';
          }
          break;

        case 'Uninstalling':
          if (event === 'UNINSTALL_COMPLETE') {
            state = 'NotInstalled';
            context.filesWritten = false;
            context.registryUpdated = false;
            context.showBadge = false;
            context.latestVersion = null;
          }
          break;

        case 'InstallFailed':
          if (event === 'RETRY') {
            state = 'Downloading';
            context.error = null;
          }
          break;
      }
    },
  };

  return machine;
}
