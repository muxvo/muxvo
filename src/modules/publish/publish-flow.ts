/**
 * Publish Flow - orchestrates the publish pipeline
 */

export interface PublishFlowInput {
  skillPath: string;
  hasScoreCache?: boolean;
  githubLoggedIn?: boolean;
  simulateNetworkError?: boolean;
}

export interface PublishFlowResult {
  success: boolean;
  blocked?: boolean;
  reason?: string;
  draftSaved?: boolean;
  draftLocation?: string;
}

export interface PublishFlow {
  steps: string[];
  scoreRequired: boolean;
  scoringSkipped: boolean;
  scoreSource?: string;
  start: () => Promise<PublishFlowResult>;
}

export function createPublishFlow(input: PublishFlowInput): PublishFlow {
  const steps: string[] = ['security-check'];
  let scoringSkipped = false;
  let scoreSource: string | undefined;

  if (!input.hasScoreCache) {
    steps.push('auto-score');
  } else {
    scoringSkipped = true;
    scoreSource = 'cache';
  }

  steps.push('publish');

  return {
    steps,
    scoreRequired: false,
    scoringSkipped,
    scoreSource,
    async start(): Promise<PublishFlowResult> {
      // Check GitHub login first
      if (input.githubLoggedIn === false) {
        return {
          success: false,
          blocked: true,
          reason: '需要先登录 GitHub 账号',
        };
      }

      // Simulate network error
      if (input.simulateNetworkError) {
        return {
          success: false,
          draftSaved: true,
          draftLocation: 'local',
        };
      }

      return { success: true };
    },
  };
}
