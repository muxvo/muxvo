/**
 * Detects whether terminal output contains an interactive prompt,
 * triggering the WaitingInput state transition.
 *
 * Terminal output contains ANSI escape codes (colors, cursor movement etc.)
 * which must be stripped before pattern matching.
 */

/** Strip ANSI escape sequences from terminal output */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*[\x07]|\x1b\].*?\x1b\\|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

const PROMPT_PATTERNS = [
  // inquirer/prompts style: "? Select an option:"
  /^\s*\?\s+.+[:：]\s*$/m,
  // yes/no confirmation: "(y/n)", "(Y/n)", "[y/N]"
  /\([yYnN]\/[yYnN]\)/,
  /\[[yYnN]\/[yYnN]\]/,
  // "Press any key", "Enter to continue"
  /press\s*(any\s*)?key/i,
  /enter\s*to\s*continue/i,
  // Claude Code / AI CLI prompts (spaces may be lost due to cursor positioning)
  /Do\s*you\s*want\s*to\s*proceed/i,
  /Would\s*you\s*like\s*to/i,
  // Claude Code approval: "Esc to cancel"
  /Esc\s*to\s*cancel/,
];

// Exclude patterns: avoid false positives
const EXCLUDE_PATTERNS = [
  /^\s*\d+[%％]/, // Progress bar: "50%"
  /\[\d+\/\d+\]/, // Progress: "[3/10]"
  /^(INFO|WARN|ERROR|DEBUG)/i, // Log lines
];

// Rolling buffer to catch prompts split across output chunks
let rollingBuffer = '';
let rollingTerminalId = '';
const ROLLING_MAX = 2000;

export function detectWaitingInput(output: string, terminalId?: string): boolean {
  // Reset rolling buffer if terminal changed
  if (terminalId && terminalId !== rollingTerminalId) {
    rollingBuffer = '';
    rollingTerminalId = terminalId;
  }

  // Append to rolling buffer and trim
  rollingBuffer += output;
  if (rollingBuffer.length > ROLLING_MAX) {
    rollingBuffer = rollingBuffer.slice(rollingBuffer.length - ROLLING_MAX);
  }

  // Strip ANSI codes for clean matching
  const clean = stripAnsi(rollingBuffer);

  // DEBUG: log the last 300 chars of clean text every 20 chunks
  if (rollingBuffer.length > 500) {
    const tail = clean.slice(-300).replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    console.log(`[MUXVO:detect] cleanTail(${clean.length}): ${tail}`);
  }

  // Check exclusions first
  for (const exclude of EXCLUDE_PATTERNS) {
    if (exclude.test(clean)) {
      console.log(`[MUXVO:detect] EXCLUDED by: ${exclude}`);
      return false;
    }
  }
  // Then check for prompt matches
  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(clean)) {
      console.log(`[MUXVO:detect] MATCHED pattern: ${pattern}`);
      rollingBuffer = ''; // Reset after detection
      return true;
    }
  }
  return false;
}

/** Reset the rolling buffer for a terminal (call on user input / state change) */
export function resetInputDetector(): void {
  rollingBuffer = '';
}
