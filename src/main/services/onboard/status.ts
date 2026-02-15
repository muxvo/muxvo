export async function getOnboardingStatus() {
  return {
    steps: [
      {
        id: 1,
        title: '欢迎使用 Muxvo',
        content: '开始探索多终端管理工具',
        action: 'next',
      },
      {
        id: 2,
        title: '检测 AI CLI 工具',
        content: '自动检测 PATH 中已安装的 AI CLI',
        action: 'detect',
      },
      {
        id: 3,
        title: '完成设置',
        content: '您已准备好使用 Muxvo',
        action: 'finish',
      },
    ],
    currentStep: 0,
    completed: false,
  };
}
