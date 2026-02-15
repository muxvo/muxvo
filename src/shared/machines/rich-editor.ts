type EditorState = 'Idle' | 'Composing' | 'ImageAttaching' | 'Sending';

interface EditorContext {
  content: string;
  attachedImages: Array<{ path: string }>;
}

export function createEditorMachine() {
  let state: EditorState = 'Idle';
  let context: EditorContext = {
    content: '',
    attachedImages: [],
  };

  function send(
    event:
      | string
      | {
          type: string;
          text?: string;
          imageData?: unknown;
          tempPath?: string;
          imagePath?: string;
          [key: string]: unknown;
        },
  ) {
    const eventType = typeof event === 'string' ? event : event.type;

    switch (state) {
      case 'Idle':
        if (eventType === 'INPUT_START') {
          state = 'Composing';
        }
        break;

      case 'Composing':
        if (eventType === 'INPUT_CONTINUE') {
          const text = typeof event === 'object' ? event.text ?? '' : '';
          context.content += text;
        } else if (eventType === 'PASTE_IMAGE') {
          state = 'ImageAttaching';
        } else if (eventType === 'SUBMIT') {
          state = 'Sending';
        } else if (eventType === 'REMOVE_IMAGE') {
          const imagePath =
            typeof event === 'object' ? event.imagePath : undefined;
          if (imagePath) {
            context.attachedImages = context.attachedImages.filter(
              (img) => img.path !== imagePath,
            );
          }
        }
        break;

      case 'ImageAttaching':
        if (eventType === 'IMAGE_SAVED') {
          const tempPath =
            typeof event === 'object' ? event.tempPath : undefined;
          if (tempPath) {
            context.attachedImages.push({ path: tempPath });
          }
          state = 'Composing';
        }
        break;

      case 'Sending':
        if (eventType === 'SEND_COMPLETE') {
          context.content = '';
          context.attachedImages = [];
          state = 'Idle';
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
