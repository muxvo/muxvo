type ViewState = 'Tiling' | 'Focused' | 'FilePanel' | 'TempView';

interface ViewContext {
  focusedId?: string;
  enteredFrom?: string;
}

export function createViewModeMachine() {
  let state: ViewState = 'Tiling';
  let context: ViewContext = {};

  function send(event: string | { type: string; targetId?: string }) {
    const eventType = typeof event === 'string' ? event : event.type;
    const targetId =
      typeof event === 'object' && 'targetId' in event
        ? event.targetId
        : undefined;

    switch (state) {
      case 'Tiling':
        if (eventType === 'DOUBLE_CLICK_TILE') {
          state = 'Focused';
          context.focusedId = targetId;
        } else if (eventType === 'CLICK_FILE_BUTTON') {
          context.enteredFrom = 'Tiling';
          state = 'FilePanel';
        }
        break;

      case 'Focused':
        if (eventType === 'ESC') {
          state = 'Tiling';
        } else if (eventType === 'CLICK_BACK_TO_TILING') {
          state = 'Tiling';
        } else if (eventType === 'CLICK_SIDEBAR_TILE') {
          context.focusedId = targetId;
        } else if (eventType === 'CLICK_FILE_BUTTON') {
          context.enteredFrom = 'Focused';
          state = 'FilePanel';
        }
        break;

      case 'FilePanel':
        if (eventType === 'ESC') {
          state = (context.enteredFrom as ViewState) || 'Tiling';
        } else if (eventType === 'CLICK_FILE') {
          state = 'TempView';
        }
        break;

      case 'TempView':
        if (eventType === 'ESC') {
          state = 'Tiling';
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
