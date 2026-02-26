/**
 * Detects whether terminal output contains an interactive prompt,
 * triggering the WaitingInput state transition.
 *
 * Terminal output contains ANSI escape codes (colors, cursor movement etc.)
 * which must be stripped before pattern matching.
 *
 * Uses per-terminal rolling buffers to handle prompts split across output chunks
 * without cross-terminal interference.
 */

/** Strip ANSI escape sequences and normalize carriage returns */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*[\x07]|\x1b\].*?\x1b\\|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]/g;

function stripAnsi(str: string): string {
  const noAnsi = str.replace(ANSI_RE, '');
  // Normalize \r\n → \n
  const noRN = noAnsi.replace(/\r\n/g, '\n');
  // Handle bare \r (ink/cursor redraws):
  //   - "old\rnew" → keep "new" (overwrite semantics)
  //   - "content\r" at end → keep "content" (ink moves cursor back, no overwrite yet)
  return noRN
    .replace(/[^\n]*\r([^\n\r]+)/g, '$1')
    .replace(/\r/g, '');
}

// --- Precise signal: "Esc to cancel" is unique to Claude Code approval prompts ---
const ESC_CANCEL_PATTERN = /Esc\s*to\s*cancel/;

// --- Combo detection: question line + numbered selector = interactive prompt ---
const QUESTION_LINE_PATTERN = /\?\s*$/m; // Line ending with "?"
const NUMBERED_OPTION_PATTERN = /❯\s*\d+\./; // ❯ 1. (Unicode U+276F selector)

// --- Generic interactive prompt patterns (high precision, kept as-is) ---
const GENERIC_PATTERNS = [
  // inquirer/prompts style: "? Select an option:"
  /^\s*\?\s+.+[:：]\s*$/m,
  // yes/no confirmation: "(y/n)", "(Y/n)", "[y/N]"
  /\([yYnN]\/[yYnN]\)/,
  /\[[yYnN]\/[yYnN]\]/,
  // "Press any key", "Enter to continue"
  /press\s*(any\s*)?key/i,
  /enter\s*to\s*continue/i,
];

// Exclude patterns: avoid false positives
const EXCLUDE_PATTERNS = [
  /^\s*\d+[%％]/, // Progress bar: "50%"
  /\[\d+\/\d+\]/, // Progress: "[3/10]"
  /^(INFO|WARN|ERROR|DEBUG)/i, // Log lines
];

// Per-terminal rolling buffers (fixes cross-terminal interference)
const buffers = new Map<string, string>();
const ROLLING_MAX = 2000;

export function detectWaitingInput(output: string, terminalId?: string): boolean {
  const key = terminalId ?? '__default__';

  // Append to per-terminal rolling buffer
  const prev = buffers.get(key) ?? '';
  let updated = prev + output;
  if (updated.length > ROLLING_MAX) {
    updated = updated.slice(updated.length - ROLLING_MAX);
  }
  buffers.set(key, updated);

  // Strip ANSI codes for clean matching
  const clean = stripAnsi(updated);

  // 1. Precise signal: "Esc to cancel" (unique to Claude Code)
  //    Highest precision — bypass exclusion rules entirely
  if (ESC_CANCEL_PATTERN.test(clean)) {
    buffers.delete(key);
    return true;
  }

  // Check exclusions only against the tail (recent output), not entire buffer.
  // Checking the full buffer could permanently block detection if old output
  // contained progress indicators like [3/10].
  const tail = clean.slice(-300);
  for (const exclude of EXCLUDE_PATTERNS) {
    if (exclude.test(tail)) {
      return false;
    }
  }

  // 2. Combo detection: question ending with ? + numbered selector ❯
  if (QUESTION_LINE_PATTERN.test(clean) && NUMBERED_OPTION_PATTERN.test(clean)) {
    buffers.delete(key);
    return true;
  }

  // 3. Generic interactive patterns
  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(clean)) {
      buffers.delete(key);
      return true;
    }
  }

  return false;
}

/** Reset the rolling buffer for a specific terminal, or all buffers if no id */
export function resetInputDetector(terminalId?: string): void {
  if (terminalId) {
    buffers.delete(terminalId);
  } else {
    buffers.clear();
  }
}
