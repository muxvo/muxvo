/**
 * Text forwarder - builds PTY payload based on foreground process protocol
 */

interface TextPayloadOpts {
  foreground: string;
  text: string;
}

interface TextPayloadResult {
  payload?: string;
  shouldSend?: boolean;
}

function isClaudeCode(foreground: string): boolean {
  const fg = foreground.toLowerCase();
  return fg === 'claude-code' || fg === 'claude code';
}

export function buildTextPayload(opts: TextPayloadOpts): TextPayloadResult {
  const { foreground, text } = opts;

  // Empty text: do not send
  if (text === '') {
    return { shouldSend: false, payload: undefined };
  }

  if (isClaudeCode(foreground)) {
    // Claude Code protocol
    const lines = text.split('\n');
    if (lines.length === 1) {
      // Single line: text + \r
      return { shouldSend: true, payload: text + '\r' };
    }
    // Multi-line: join with ESC+CR, terminate with CR
    return { shouldSend: true, payload: lines.join('\x1b\r') + '\r' };
  }

  // Shell protocol (bash, zsh, fish, etc.)
  // Single or multi-line: text + \n
  return { shouldSend: true, payload: text + '\n' };
}
