type NamingState = 'DisplayEmpty' | 'Editing' | 'DisplayNamed';

interface NamingContext {
  displayText: string;
  placeholder: string;
  originalValue: string;
  editValue: string;
}

export function createNamingMachine() {
  let state: NamingState = 'DisplayEmpty';
  let context: NamingContext = {
    displayText: '',
    placeholder: '命名...',
    originalValue: '',
    editValue: '',
  };

  function send(
    event: string | { type: string; value?: string; [key: string]: unknown },
  ) {
    const eventType = typeof event === 'string' ? event : event.type;
    const value = typeof event === 'object' ? event.value ?? '' : '';

    switch (state) {
      case 'DisplayEmpty':
        if (eventType === 'CLICK_PLACEHOLDER') {
          context.originalValue = '';
          context.editValue = '';
          state = 'Editing';
        }
        break;

      case 'Editing':
        if (eventType === 'ENTER' || eventType === 'BLUR') {
          if (value && value.length > 0) {
            context.displayText = value;
            context.originalValue = value;
            state = 'DisplayNamed';
          } else {
            context.displayText = '';
            state = 'DisplayEmpty';
          }
        } else if (eventType === 'ESC') {
          if (context.originalValue) {
            context.displayText = context.originalValue;
            state = 'DisplayNamed';
          } else {
            state = 'DisplayEmpty';
          }
        }
        break;

      case 'DisplayNamed':
        if (eventType === 'CLICK_NAME') {
          context.originalValue = context.displayText;
          context.editValue = context.displayText;
          state = 'Editing';
        }
        break;
    }
  }

  return {
    get state() {
      return state;
    },
    get context() {
      return { ...context };
    },
    send,
  };
}
