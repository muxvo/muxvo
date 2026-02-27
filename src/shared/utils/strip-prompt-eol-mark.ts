/**
 * Strip zsh PROMPT_EOL_MARK and its trailing cleanup sequences from buffer data.
 * zsh outputs: \e[7m%\e[27m + spaces + \r + escape codes + \r + \e[J
 * At the original terminal width this is invisible (self-overwriting), but when
 * replayed at a narrower width, line wrapping exposes the `%` and duplicate prompt.
 * We strip everything from the mark through \e[J (erase display) which is the
 * definitive end of the cleanup sequence before the real prompt is drawn.
 */
export function stripPromptEolMark(data: string): string {
  // Primary: strip from PROMPT_EOL_MARK through erase-display (\e[J / \e[0J / \e[2J)
  const stripped = data.replace(/\x1b\[7m%\x1b\[27m[^\n]*?\x1b\[[0-2]?J/g, '');
  if (stripped !== data) return stripped;
  // Fallback: strip just the mark + double-CR if \e[J is absent
  return data.replace(/\x1b\[7m%\x1b\[27m[^\n]*?\r[^\n]*?\r/g, '');
}
