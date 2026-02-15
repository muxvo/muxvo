/**
 * Tool Call Renderer Config
 *
 * Configuration for rendering tool calls and tool results in session detail.
 */

export function getToolCallRenderConfig() {
  return {
    toolCall: {
      borderLeft: 'blue' as const,
      defaultState: 'collapsed' as const,
      action: 'click to expand',
    },
    toolResult: {
      borderLeft: 'green' as const,
      defaultState: 'collapsed' as const,
    },
  };
}
