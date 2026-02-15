/**
 * Marketplace Aggregator - fetches sources from 6 providers
 */

export interface Source {
  name: string;
  url: string;
  status: string;
  packages: unknown[];
}

export interface FetchSourcesResult {
  sources: Source[];
  totalCount: number;
}

const DEFAULT_SOURCES: Source[] = [
  { name: 'local files', url: 'local://', status: 'active', packages: [] },
  { name: 'CC official', url: 'https://anthropic.com/skills', status: 'active', packages: [] },
  { name: 'GitHub', url: 'https://github.com', status: 'active', packages: [] },
  { name: 'npm', url: 'https://npmjs.com', status: 'active', packages: [] },
  { name: 'community', url: 'https://community.muxvo.com', status: 'active', packages: [] },
  { name: 'custom', url: 'custom://', status: 'active', packages: [] },
];

export async function fetchSources(): Promise<FetchSourcesResult> {
  return {
    sources: DEFAULT_SOURCES,
    totalCount: 0,
  };
}
