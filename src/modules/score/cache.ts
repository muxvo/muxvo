/**
 * Score Cache - caches and retrieves scoring results
 */

export interface ScoreResult {
  dimensions?: unknown[];
  totalScore?: number;
  grade?: string;
  title?: string;
  suggestions?: string[];
  promptVersion?: string;
  contentHash?: string;
}

export interface CachedScoreResult {
  cached: boolean;
  contentHash?: string;
  result?: ScoreResult;
  ccInvoked: boolean;
}

interface CacheEntry {
  contentHash: string;
  promptVersion: string;
  result: { totalScore: number; grade: string };
}

/** Create a score cache instance for managing score results */
export function createScoreCache() {
  const store = new Map<string, CacheEntry>();

  return {
    async set(key: string, entry: CacheEntry) {
      store.set(key, { ...entry });
    },
    async get(key: string, check: { contentHash: string; promptVersion: string }): Promise<{ cached: boolean; result?: CacheEntry['result'] }> {
      const entry = store.get(key);
      if (!entry) return { cached: false };
      if (entry.contentHash !== check.contentHash) return { cached: false };
      if (entry.promptVersion !== check.promptVersion) return { cached: false };
      return { cached: true, result: entry.result };
    },
    async invalidateByPromptVersion(_newVersion: string) {
      store.clear();
    },
  };
}

export async function getCachedScore(_skillPath: string): Promise<CachedScoreResult> {
  // Default: no cache available
  return {
    cached: false,
    ccInvoked: false,
  };
}

export interface CacheValidityInput {
  cachedPromptVersion: string;
  currentPromptVersion: string;
  cachedContentHash: string;
  currentContentHash: string;
}

export interface CacheValidityResult {
  valid: boolean;
  reason?: string;
}

export function checkCacheValidity(input: CacheValidityInput): CacheValidityResult {
  if (input.cachedPromptVersion !== input.currentPromptVersion) {
    return {
      valid: false,
      reason: 'promptVersion changed: cache invalidated',
    };
  }
  if (input.cachedContentHash !== input.currentContentHash) {
    return {
      valid: false,
      reason: 'contentHash changed: cache invalidated',
    };
  }
  return { valid: true };
}
