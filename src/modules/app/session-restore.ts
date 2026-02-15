/**
 * Session restore module
 */

export async function restoreSession() {
  // Simulates restoring a session with 3 terminals
  return {
    terminals: [
      { id: 'term-1', cwd: '/project-a' },
      { id: 'term-2', cwd: '/project-b' },
      { id: 'term-3', cwd: '/project-c' },
    ],
  };
}
