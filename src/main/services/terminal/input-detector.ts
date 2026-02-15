/**
 * Detects whether terminal output contains an interactive prompt,
 * triggering the WaitingInput state transition.
 */

const PROMPT_PATTERNS = [
  // inquirer/prompts style: "? Select an option:"
  /^\s*\?\s+.+[:：]\s*$/m,
  // yes/no confirmation: "(y/n)", "(Y/n)", "[y/N]"
  /\([yYnN]\/[yYnN]\)/,
  /\[[yYnN]\/[yYnN]\]/,
  // Numbered option lists: "  1) option" or "  1. option"
  /^\s*\d+[).]\s+\S/m,
  // "Press any key", "Enter to continue"
  /press\s+(any\s+)?key/i,
  /enter\s+to\s+continue/i,
  // Claude Code / AI CLI prompts
  /Do you want to proceed/i,
  /Would you like to/i,
];

// Exclude patterns: avoid false positives
const EXCLUDE_PATTERNS = [
  /^\s*\d+[%％]/, // Progress bar: "50%"
  /\[\d+\/\d+\]/, // Progress: "[3/10]"
  /^(INFO|WARN|ERROR|DEBUG)/i, // Log lines
];

export function detectWaitingInput(output: string): boolean {
  // Check exclusions first
  for (const exclude of EXCLUDE_PATTERNS) {
    if (exclude.test(output)) return false;
  }
  // Then check for prompt matches
  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(output)) return true;
  }
  return false;
}
