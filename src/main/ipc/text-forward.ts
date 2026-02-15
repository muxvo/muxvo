/**
 * Text forward - converts editor text to PTY-compatible payload
 */

interface ForwardOpts {
  text: string;
  foregroundProcess: string;
}

function isClaudeCode(process: string): boolean {
  const p = process.toLowerCase();
  return p === 'claude code' || p === 'claude-code';
}

export function forwardTextToPty(opts: ForwardOpts): string {
  const { text, foregroundProcess } = opts;
  const lines = text.split('\n');

  if (isClaudeCode(foregroundProcess)) {
    // CC protocol
    if (lines.length === 1) {
      return text + '\r';
    }
    // Multi-line: ESC+CR separator, CR terminator
    return lines.join('\x1b\r') + '\r';
  }

  // Shell protocol (bash, zsh, fish, etc.)
  if (lines.length === 1) {
    return text + '\r';
  }
  // Multi-line shell: newline separator + newline terminator
  return text + '\n';
}
