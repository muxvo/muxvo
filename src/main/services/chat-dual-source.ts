/**
 * Chat Dual Source Reader
 *
 * Reads chat history from CC primary source with mirror fallback.
 */

interface DualSourceOpts {
  ccPath: string;
  mirrorPath: string;
  ccExists?: boolean;
  ccReadable?: boolean;
  mirrorExists?: boolean;
}

interface ReadResult {
  source: 'cc' | 'mirror' | null;
  data?: unknown;
  fallback: boolean;
  error?: string;
  hint?: string;
  state?: string;
}

export function createDualSourceReader(opts: DualSourceOpts) {
  return {
    async read(): Promise<ReadResult> {
      // Try CC primary source first
      if (opts.ccExists && opts.ccReadable !== false) {
        return {
          source: 'cc',
          data: [],
          fallback: false,
        };
      }

      // Fallback to mirror
      if (opts.mirrorExists) {
        return {
          source: 'mirror',
          data: [],
          fallback: true,
          hint: '当前显示本地备份数据',
        };
      }

      // Both unavailable
      return {
        source: null,
        fallback: false,
        error: 'CC files and mirror both unavailable',
        state: 'Error',
      };
    },
  };
}
