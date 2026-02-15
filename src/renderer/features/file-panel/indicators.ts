/**
 * File Panel Indicators
 *
 * Maps file system change events to UI indicators.
 */

interface FsChangePayload {
  type: string;
  path: string;
  watchId?: string;
}

export function getFileIndicator(payload: FsChangePayload): string {
  switch (payload.type) {
    case 'add':
      return 'NEW';
    case 'change':
      return 'MODIFIED';
    case 'unlink':
      return 'DELETED';
    default:
      return 'UNKNOWN';
  }
}
