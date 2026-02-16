/**
 * Markdown Mode State Machine
 * G3: 预览/编辑双模式
 *
 * States:
 *   - Preview: 显示渲染后的 Markdown
 *   - Edit: 显示可编辑的原始 Markdown
 *   - UnsavedPrompt: 有未保存修改时切换模式弹出的确认对话框
 *
 * Events:
 *   - TOGGLE_MODE: 切换预览/编辑模式
 *   - CONTENT_CHANGE: 编辑内容变化
 *   - SAVE: 保存当前内容
 *   - CONFIRM_DISCARD: 确认放弃未保存的修改
 *   - CANCEL_DISCARD: 取消放弃操作，继续编辑
 */

type MarkdownModeState = 'Preview' | 'Edit' | 'UnsavedPrompt';

interface MarkdownModeContext {
  isDirty: boolean;
  originalContent: string;
  editContent: string;
}

type MarkdownModeEvent =
  | string
  | { type: string; content?: string };

export interface MarkdownModeMachine {
  readonly state: MarkdownModeState;
  readonly context: MarkdownModeContext;
  send: (event: MarkdownModeEvent) => void;
}

/**
 * 创建 Markdown 模式状态机
 * @param initialContent 初始内容
 */
export function createMarkdownModeMachine(initialContent: string = ''): MarkdownModeMachine {
  let state: MarkdownModeState = 'Preview';
  let context: MarkdownModeContext = {
    isDirty: false,
    originalContent: initialContent,
    editContent: initialContent,
  };

  function send(event: MarkdownModeEvent) {
    const eventType = typeof event === 'string' ? event : event.type;

    switch (state) {
      case 'Preview':
        if (eventType === 'TOGGLE_MODE') {
          state = 'Edit';
        }
        break;

      case 'Edit':
        if (eventType === 'TOGGLE_MODE') {
          if (context.isDirty) {
            state = 'UnsavedPrompt';
          } else {
            state = 'Preview';
          }
        } else if (eventType === 'CONTENT_CHANGE') {
          const content = typeof event === 'object' ? event.content ?? '' : '';
          context.editContent = content;
          context.isDirty = content !== context.originalContent;
        } else if (eventType === 'SAVE') {
          context.originalContent = context.editContent;
          context.isDirty = false;
        }
        break;

      case 'UnsavedPrompt':
        if (eventType === 'CONFIRM_DISCARD') {
          context.editContent = context.originalContent;
          context.isDirty = false;
          state = 'Preview';
        } else if (eventType === 'SAVE') {
          context.originalContent = context.editContent;
          context.isDirty = false;
          state = 'Preview';
        } else if (eventType === 'CANCEL_DISCARD') {
          state = 'Edit';
        }
        break;
    }
  }

  return {
    get state() { return state; },
    get context() { return { ...context }; },
    send,
  };
}
