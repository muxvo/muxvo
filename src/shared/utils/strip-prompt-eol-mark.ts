/**
 * Strip zsh PROMPT_EOL_MARK and collapse CR-based prompt redraws from buffer data.
 *
 * Phase 1 — PROMPT_EOL_MARK removal:
 *   zsh outputs: \e[7m%\e[27m + spaces + \r + escape codes + \r + \e[J
 *   At the original terminal width this is invisible (self-overwriting), but when
 *   replayed at a narrower width, line wrapping exposes the `%` and duplicate prompt.
 *   We strip everything from the mark through \e[J (erase display).
 *
 * Phase 2 — CR-based overwrite collapse:
 *   Terminal resize events (SIGWINCH) cause zsh to redraw the prompt via \r (CR).
 *   At the original width, each \r goes to column 0 and overwrites the previous
 *   prompt. At a narrower width, the previous prompt wraps and \r lands on a
 *   different visual line, producing duplicate prompt lines.
 *   We collapse each logical line to only the content after the last bare \r.
 *
 * Alternate Screen Buffer guard:
 *   TUI apps (Codex/ratatui, vim, etc.) use \e[?1049h to enter the alternate
 *   screen buffer. Their frame data must NOT be processed by Phase 1/2 — doing so
 *   corrupts cursor positioning and cell rendering on buffer replay.
 *   We only apply stripping to content BEFORE the first \e[?1049h.
 */
export function stripPromptEolMark(data: string): string {
  // Guard: if buffer contains alternate screen buffer enter, only process
  // the shell content before it. TUI frame data is passed through as-is.
  const asbIdx = data.indexOf('\x1b[?1049h');
  if (asbIdx >= 0) {
    const shellPart = data.substring(0, asbIdx);
    const tuiPart = data.substring(asbIdx);
    return stripShellContent(shellPart) + tuiPart;
  }
  return stripShellContent(data);
}

/** Strip zsh prompt artifacts from shell output (Phase 1 + Phase 2) */
function stripShellContent(data: string): string {
  // Phase 1: strip PROMPT_EOL_MARK cleanup sequence
  let result = data.replace(/\x1b\[7m%\x1b\[27m[^\n]*?\x1b\[[0-2]?J/g, '');
  if (result === data) {
    // Fallback: strip just the mark + double-CR if \e[J is absent
    result = data.replace(/\x1b\[7m%\x1b\[27m[^\n]*?\r[^\n]*?\r/g, '');
  }

  // Phase 2: collapse CR-based overwrites within each line.
  // A bare \r (not part of \r\n) means "move cursor to column 0", so the
  // content after the last \r is what the terminal would actually display.
  const lines = result.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lastCR = line.lastIndexOf('\r');
    if (lastCR < 0) continue; // No CR — keep as-is
    if (lastCR < line.length - 1) {
      // \r in the middle: keep only content after last \r
      lines[i] = line.substring(lastCR + 1);
    } else {
      // \r at end of line (from \r\n split): strip trailing \r
      lines[i] = line.substring(0, lastCR);
    }
  }

  return lines.join('\n');
}
