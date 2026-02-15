/**
 * Data Sync Mirror Structure
 *
 * Defines the expected mirror directory structure for chat history sync.
 */

export function getMirrorStructure() {
  return {
    files: [
      'chat-history/sync-state.json',
      'projects/{project-hash}/project-info.json',
      'sessions/{session-id}.jsonl',
      'history-index.jsonl',
    ],
  };
}
