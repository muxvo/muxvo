/**
 * Score State Machine - manages AI scoring lifecycle
 *
 * States: NotScored -> Scoring -> Scored -> GeneratingShowcase
 *                         |-> ScoreFailed
 */

type ScoreState =
  | 'NotScored'
  | 'Scoring'
  | 'Scored'
  | 'ScoreFailed'
  | 'GeneratingShowcase';

interface ScoreContext {
  retryCount: number;
  canAutoRetry: boolean;
  error?: string;
  showRetryButton: boolean;
  showManualRetryButton: boolean;
  contentHash?: string;
  scoreResult?: unknown;
}

export function createScoreMachine() {
  let state: ScoreState = 'NotScored';
  const context: ScoreContext = {
    retryCount: 0,
    canAutoRetry: true,
    showRetryButton: false,
    showManualRetryButton: false,
  };

  const MAX_RETRIES = 3;

  function send(event: string, payload?: Record<string, unknown>) {
    switch (state) {
      case 'NotScored':
        if (event === 'START_SCORING') {
          state = 'Scoring';
          context.retryCount = 0;
          context.canAutoRetry = true;
          context.error = undefined;
          context.showRetryButton = false;
        }
        break;

      case 'Scoring':
        if (event === 'SCORE_FAILED') {
          context.retryCount += 1;
          context.error = 'Scoring failed';
          if (context.retryCount >= MAX_RETRIES) {
            state = 'ScoreFailed';
            context.canAutoRetry = false;
            context.showRetryButton = true;
            context.showManualRetryButton = true;
          } else {
            state = 'ScoreFailed';
            context.canAutoRetry = true;
            context.showRetryButton = true;
            context.showManualRetryButton = false;
          }
        } else if (event === 'SCORE_COMPLETE') {
          state = 'Scored';
          if (payload?.contentHash) {
            context.contentHash = payload.contentHash as string;
          }
          context.scoreResult = payload;
        }
        break;

      case 'ScoreFailed':
        if (event === 'RETRY') {
          state = 'Scoring';
        } else if (event === 'AUTO_RETRY') {
          if (context.canAutoRetry) {
            state = 'Scoring';
          }
        } else if (event === 'CANCEL') {
          state = 'NotScored';
          context.error = undefined;
          context.showRetryButton = false;
        }
        break;

      case 'Scored':
        if (event === 'CONTENT_CHANGED') {
          state = 'Scoring';
          if (payload?.newContentHash) {
            context.contentHash = payload.newContentHash as string;
          }
          context.retryCount = 0;
          context.canAutoRetry = true;
        } else if (event === 'GENERATE_SHOWCASE') {
          state = 'GeneratingShowcase';
        }
        break;

      case 'GeneratingShowcase':
        break;
    }
  }

  return {
    get state() {
      return state;
    },
    get context() {
      return context;
    },
    send,
  };
}
