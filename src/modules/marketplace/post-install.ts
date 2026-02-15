/**
 * Post Install
 *
 * Generates post-installation usage guides for installed packages.
 */

interface PostInstallInput {
  packageName: string;
  type: 'skill' | 'hook';
}

interface PostInstallGuide {
  message: string;
  examplePrompt: string;
}

export function getPostInstallGuide(input: PostInstallInput): PostInstallGuide {
  if (input.type === 'skill') {
    return {
      message: `${input.packageName} 安装成功！在 CC 中说 "使用 ${input.packageName}" 即可开始。`,
      examplePrompt: `使用 ${input.packageName} 帮我完成任务`,
    };
  }
  return {
    message: `${input.packageName} Hook 安装成功！在 CC 中说 "检查 Hook" 查看状态。`,
    examplePrompt: `检查 ${input.packageName} Hook 状态`,
  };
}
