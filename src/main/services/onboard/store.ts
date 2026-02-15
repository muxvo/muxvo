/**
 * Onboard Store
 *
 * 4-step onboarding flow state machine:
 * Step 1: Welcome  ->  Step 2: CLI Detection  ->  Step 3: Directory Selection  ->  Step 4: Shortcuts
 */

interface OnboardConfig {
  onboardingCompleted: boolean;
  detectedTools?: string[];
}

interface OnboardAction {
  type: 'APP_START' | 'NEXT_STEP' | 'SELECT_DIRECTORY' | 'COMPLETE' | 'SKIP';
  path?: string;
}

interface StepContent {
  title: string;
  content: string;
}

const STEP_CONTENTS: Record<number, StepContent> = {
  1: { title: '欢迎使用 Muxvo', content: 'Muxvo 是一款 AI 终端管理工具' },
  2: { title: 'CLI 工具检测', content: '检测已安装的 AI CLI 工具' },
  3: { title: '创建首个终端', content: '选择一个项目目录开始使用' },
  4: { title: '快捷键提示', content: '掌握常用快捷键提高效率' },
};

const SHORTCUT_HINTS = ['Cmd+T', 'Esc', 'Cmd+W', 'Cmd+D'];

export function createOnboardStore(config: OnboardConfig) {
  let completed = config.onboardingCompleted;
  let showOnboarding = false;
  let currentStep = 0;
  let selectedDirectory: string | null = null;
  const detectedTools: string[] = config.detectedTools ?? [];

  function dispatch(action: OnboardAction): void {
    switch (action.type) {
      case 'APP_START':
        if (!completed) {
          showOnboarding = true;
          currentStep = 1;
        }
        break;

      case 'NEXT_STEP':
        if (currentStep < 4) {
          currentStep++;
        }
        break;

      case 'SELECT_DIRECTORY':
        selectedDirectory = action.path ?? null;
        break;

      case 'COMPLETE':
        completed = true;
        showOnboarding = false;
        break;

      case 'SKIP':
        completed = true;
        showOnboarding = false;
        break;
    }
  }

  function shouldShowOnboarding(): boolean {
    return showOnboarding;
  }

  function getCurrentStep(): number {
    return currentStep;
  }

  function getStepContent(step: number): StepContent {
    return STEP_CONTENTS[step] ?? { title: '', content: '' };
  }

  function getDetectedTools(): string[] {
    return detectedTools;
  }

  function getStep2Message(): string {
    if (detectedTools.length === 0) {
      return '未检测到 AI CLI 工具，可作为普通终端使用';
    }
    return `检测到 ${detectedTools.join(', ')}`;
  }

  function getSelectedDirectory(): string | null {
    return selectedDirectory;
  }

  function getShortcutHints(): string[] {
    return SHORTCUT_HINTS;
  }

  function isCompleted(): boolean {
    return completed;
  }

  return {
    dispatch,
    shouldShowOnboarding,
    getCurrentStep,
    getStepContent,
    getDetectedTools,
    getStep2Message,
    getSelectedDirectory,
    getShortcutHints,
    isCompleted,
  };
}
