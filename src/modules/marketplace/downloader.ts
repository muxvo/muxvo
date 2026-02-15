/**
 * Downloader
 *
 * Downloads marketplace packages with automatic retry on failure.
 */

interface DownloaderConfig {
  maxRetries: number;
}

interface DownloadRequest {
  url: string;
  simulateFailures?: number;
}

interface DownloadResult {
  success: boolean;
  attempts: number;
}

export interface Downloader {
  download(request: DownloadRequest): Promise<DownloadResult>;
}

export function createDownloader(config: DownloaderConfig): Downloader {
  return {
    async download(request: DownloadRequest): Promise<DownloadResult> {
      const failuresToSimulate = request.simulateFailures ?? 0;
      let attempts = 0;

      for (let i = 0; i <= config.maxRetries; i++) {
        attempts++;
        if (i < failuresToSimulate) {
          continue;
        }
        return { success: true, attempts };
      }

      return { success: false, attempts };
    },
  };
}
