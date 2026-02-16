/**
 * Shell Detection Utilities
 *
 * Used by both main process (manager.ts) and renderer (CwdPicker.tsx)
 * to determine if a process is a shell.
 */

export const KNOWN_SHELLS = ['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh'] as const;

/**
 * Check if a process name is a known shell.
 * @param name - Process name (may include path like '/bin/zsh')
 * @returns true if the basename matches a known shell
 */
export function isShellProcess(name: string): boolean {
  const basename = name.includes('/') ? name.split('/').pop()! : name;
  return KNOWN_SHELLS.includes(basename as typeof KNOWN_SHELLS[number]);
}
