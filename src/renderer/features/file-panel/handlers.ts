/**
 * File Panel Handlers
 *
 * Determines UI behavior in response to file system changes.
 */

interface FsChangePayload {
  type: string;
  path: string;
  watchId?: string;
}

export function shouldRefreshFileList(payload: FsChangePayload): boolean {
  return payload.type === 'change' || payload.type === 'add';
}

export function shouldRemoveFileEntry(payload: FsChangePayload): boolean {
  return payload.type === 'unlink';
}
