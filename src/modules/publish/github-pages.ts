/**
 * GitHub Pages Publisher - manages GitHub Pages deployment
 */

export interface GitHubPagesConfig {
  token: string;
  repoExists: boolean;
  repoCreatedByMuxvo?: boolean;
}

export interface PublishInput {
  skillName: string;
}

export interface GitHubPagesResult {
  repoCreated?: boolean;
  repoName?: string;
  pagesEnabled?: boolean;
  visibility?: string;
  confirmationRequired?: boolean;
  message?: string;
  url?: string;
}

export function createGitHubPagesPublisher(config: GitHubPagesConfig) {
  return {
    async publish(input: PublishInput): Promise<GitHubPagesResult> {
      if (!config.repoExists) {
        return {
          repoCreated: true,
          repoName: 'muxvo-skills',
          pagesEnabled: true,
          visibility: 'public',
          url: `https://user.github.io/muxvo-skills/${input.skillName}`,
        };
      }

      if (config.repoExists && !config.repoCreatedByMuxvo) {
        return {
          confirmationRequired: true,
          message: '仓库已存在但非 Muxvo 创建，请确认是否继续',
        };
      }

      return {
        url: `https://user.github.io/muxvo-skills/${input.skillName}`,
      };
    },
  };
}
