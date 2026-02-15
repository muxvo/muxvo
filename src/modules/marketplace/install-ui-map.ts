/**
 * Install UI Map
 *
 * Maps install states to UI presentation (button text, style).
 */

interface InstallStateUI {
  buttonText: string;
  buttonStyle: string;
}

const uiMap: Record<string, InstallStateUI> = {
  NotInstalled: { buttonText: '安装', buttonStyle: 'primary' },
  Downloading: { buttonText: '下载中...', buttonStyle: 'disabled' },
  SecurityReview: { buttonText: '审查中', buttonStyle: 'warning' },
  Installing: { buttonText: '安装中...', buttonStyle: 'disabled' },
  Installed: { buttonText: '已安装', buttonStyle: 'success' },
  UpdateAvailable: { buttonText: '更新', buttonStyle: 'primary' },
  InstallFailed: { buttonText: '重试安装', buttonStyle: 'danger' },
  Uninstalling: { buttonText: '卸载中...', buttonStyle: 'disabled' },
};

export function getInstallStateUI(state: string): InstallStateUI {
  return uiMap[state] ?? { buttonText: state, buttonStyle: 'default' };
}
