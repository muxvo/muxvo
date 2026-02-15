/**
 * Chat reader module - dual-source read strategy
 */

export async function readSession(sessionId: string) {
  return {
    sessionId,
    messages: [],
    source: 'cc' as 'cc' | 'mirror',
  };
}
