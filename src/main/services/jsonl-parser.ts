/**
 * JSONL Parser
 *
 * Parses JSONL (JSON Lines) format with error tolerance.
 * Supports both batch parsing and streaming.
 */

interface ParseResult {
  entries: Array<Record<string, unknown>>;
  skippedLines: number;
  errors: unknown[];
  incompleteTailIgnored: boolean;
}

export function parseJsonl(input: string): ParseResult {
  const entries: Array<Record<string, unknown>> = [];
  let skippedLines = 0;
  let incompleteTailIgnored = false;

  // Check if input ends with newline (complete) or not (incomplete tail)
  const endsWithNewline = input.endsWith('\n');
  const lines = input.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (line === '') continue;

    // If this is the last segment and input doesn't end with newline, it's incomplete
    if (i === lines.length - 1 && !endsWithNewline && line !== '') {
      incompleteTailIgnored = true;
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      entries.push(parsed);
    } catch {
      skippedLines++;
    }
  }

  return {
    entries,
    skippedLines,
    errors: [],
    incompleteTailIgnored,
  };
}

/**
 * Stream Parser for large JSONL files.
 * Feeds data in chunks and emits entries as they are parsed.
 */
export function createStreamParser() {
  let buffer = '';
  const listeners: Array<(entry: unknown) => void> = [];

  function processBuffer() {
    const lines = buffer.split('\n');
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed);
        for (const listener of listeners) {
          listener(parsed);
        }
      } catch {
        // Skip invalid lines silently
      }
    }
  }

  return {
    onEntry(fn: (entry: unknown) => void) {
      listeners.push(fn);
    },

    feed(chunk: string) {
      buffer += chunk;
      processBuffer();
    },

    end() {
      // Process any remaining complete line in buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          for (const listener of listeners) {
            listener(parsed);
          }
        } catch {
          // Ignore incomplete tail
        }
      }
      buffer = '';
    },
  };
}
