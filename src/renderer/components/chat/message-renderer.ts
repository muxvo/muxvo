/**
 * Message Renderer Config
 *
 * Configuration for rendering chat messages with bubble styles.
 */

export function getMessageRenderConfig() {
  return {
    userMessage: {
      alignment: 'right' as const,
      background: 'accent',
    },
    assistantMessage: {
      alignment: 'left' as const,
      background: 'elevated',
    },
    codeBlock: {
      syntaxHighlight: true,
      copyButton: true,
    },
  };
}
