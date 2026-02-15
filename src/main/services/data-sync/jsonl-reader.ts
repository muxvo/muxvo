/**
 * JSONL Reader
 *
 * Safe concurrent JSONL reading with configurable delay
 * and incomplete/invalid line handling.
 */

export interface JsonlReadConfig {
  readDelay: number;
}

export interface JsonlParseResult {
  parsed: unknown[];
  errors: unknown[];
  skipped: number;
}

export function getJsonlReadConfig(): JsonlReadConfig {
  return {
    readDelay: 200,
  };
}

/**
 * Parse JSONL content safely.
 * - Valid JSON lines are parsed and collected.
 * - Invalid JSON lines are silently skipped (no errors reported).
 * - Incomplete lines (no trailing newline) are also skipped.
 */
export function parseJsonlContent(content: string): JsonlParseResult {
  const parsed: unknown[] = [];
  let skipped = 0;

  // Check if content ends with newline — if not, the last segment is incomplete
  const endsWithNewline = content.endsWith('\n');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }

    // If this is the last segment and content doesn't end with \n, it's incomplete
    if (i === lines.length - 1 && !endsWithNewline) {
      skipped++;
      continue;
    }

    try {
      const obj = JSON.parse(line);
      parsed.push(obj);
    } catch {
      // Invalid JSON line — silently skip
      skipped++;
    }
  }

  return {
    parsed,
    errors: [], // All errors are silent skips
    skipped,
  };
}
