/**
 * Showcase State Machine - manages showcase lifecycle
 *
 * States: NotGenerated -> Generating -> Previewing <-> Editing
 *           -> Publishing -> Published -> Updating -> Published
 *           -> Unpublished -> NotGenerated
 */

type ShowcaseState =
  | 'NotGenerated'
  | 'Generating'
  | 'GenerateFailed'
  | 'Previewing'
  | 'Editing'
  | 'Publishing'
  | 'Published'
  | 'PublishFailed'
  | 'Updating'
  | 'Unpublished';

interface ShowcaseDraft {
  name: string;
  description: string;
  features: unknown[];
  template: string;
}

interface ShowcaseContext {
  draft: ShowcaseDraft;
  url?: string;
  error?: string;
  skillPath?: string;
  scoreResult?: unknown;
  githubToken?: string;
}

export function createShowcaseMachine() {
  let state: ShowcaseState = 'NotGenerated';
  const context: ShowcaseContext = {
    draft: { name: '', description: '', features: [], template: '' },
  };

  function send(event: string, payload?: Record<string, unknown>) {
    switch (state) {
      case 'NotGenerated':
        if (event === 'GENERATE') {
          state = 'Generating';
          if (payload?.skillPath) context.skillPath = payload.skillPath as string;
          if (payload?.scoreResult) context.scoreResult = payload.scoreResult;
        }
        break;

      case 'Generating':
        if (event === 'GENERATE_COMPLETE') {
          state = 'Previewing';
          if (payload?.draft) {
            context.draft = payload.draft as ShowcaseDraft;
          }
        } else if (event === 'GENERATE_FAILED') {
          state = 'GenerateFailed';
          context.error = (payload?.error as string) ?? 'Generation failed';
        }
        break;

      case 'GenerateFailed':
        if (event === 'RETRY') {
          state = 'Generating';
          context.error = undefined;
        } else if (event === 'CANCEL') {
          state = 'NotGenerated';
          context.error = undefined;
        }
        break;

      case 'Previewing':
        if (event === 'EDIT') {
          state = 'Editing';
        } else if (event === 'PUBLISH') {
          state = 'Publishing';
          if (payload?.githubToken) context.githubToken = payload.githubToken as string;
        }
        break;

      case 'Editing':
        if (event === 'SAVE') {
          state = 'Previewing';
        } else if (event === 'CHANGE_TEMPLATE') {
          if (payload?.template) {
            context.draft.template = payload.template as string;
          }
        }
        break;

      case 'Publishing':
        if (event === 'PUBLISH_COMPLETE') {
          state = 'Published';
          if (payload?.url) context.url = payload.url as string;
        } else if (event === 'PUBLISH_FAILED') {
          state = 'PublishFailed';
          context.error = (payload?.error as string) ?? 'Publish failed';
        }
        break;

      case 'Published':
        if (event === 'UPDATE') {
          state = 'Updating';
        } else if (event === 'UNPUBLISH') {
          state = 'Unpublished';
        }
        break;

      case 'PublishFailed':
        if (event === 'BACK_TO_EDIT') {
          state = 'Previewing';
          context.error = undefined;
        }
        break;

      case 'Updating':
        if (event === 'UPDATE_COMPLETE') {
          state = 'Published';
        }
        break;

      case 'Unpublished':
        if (event === 'PUBLISH') {
          state = 'Publishing';
          if (payload?.githubToken) context.githubToken = payload.githubToken as string;
        } else if (event === 'DELETE_CONFIG') {
          state = 'NotGenerated';
        }
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
