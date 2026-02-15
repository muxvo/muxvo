/**
 * Showcase Publish Config
 *
 * GitHub Pages publishing configuration and error handling.
 */

export function getPublishConfig() {
  return {
    timeout: 30000,
    saveDraftOnTimeout: true,
  };
}

interface GitHubErrorOptions {
  status: number;
  resetTime?: string;
}

interface GitHubErrorResult {
  message: string;
  resetTime?: string;
}

export function handleGitHubError(options: GitHubErrorOptions): GitHubErrorResult {
  if (options.status === 429) {
    return {
      message: 'GitHub API 配额已用尽，请稍后重试',
      resetTime: options.resetTime,
    };
  }

  return {
    message: `GitHub API 错误 (${options.status})`,
  };
}
