/**
 * CHANGELOG.md parser — Parses Keep a Changelog format
 * Single source of truth for release notes across:
 *   - WhatsNew modal (renderer)
 *   - Help button guide.md (main process)
 */

export interface ReleaseEntry {
  version: string;
  date: string;
  sections: Record<string, string[]>;
}

/**
 * Parse CHANGELOG.md content into structured release entries.
 * Expects Keep a Changelog format:
 *   ## [x.y.z] - YYYY-MM-DD
 *   ### Added
 *   - item
 */
export function parseChangelog(markdown: string): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];
  const lines = markdown.split('\n');

  let current: ReleaseEntry | null = null;
  let currentSection = '';

  for (const line of lines) {
    // Match version heading: ## [0.2.0] - 2026-03-10
    const versionMatch = line.match(/^## \[(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\]\s*-\s*(\d{4}-\d{2}-\d{2})/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = { version: versionMatch[1], date: versionMatch[2], sections: {} };
      currentSection = '';
      continue;
    }

    // Skip [Unreleased] heading
    if (/^## \[Unreleased\]/i.test(line)) {
      if (current) entries.push(current);
      current = null;
      currentSection = '';
      continue;
    }

    if (!current) continue;

    // Match section heading: ### Added, ### Fixed, etc.
    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!current.sections[currentSection]) {
        current.sections[currentSection] = [];
      }
      continue;
    }

    // Match list item: - something
    const itemMatch = line.match(/^- (.+)/);
    if (itemMatch && currentSection) {
      current.sections[currentSection].push(itemMatch[1].trim());
    }
  }

  if (current) entries.push(current);
  return entries;
}

/** Get the latest (first) release entry */
export function getLatestRelease(markdown: string): ReleaseEntry | null {
  const entries = parseChangelog(markdown);
  return entries.length > 0 ? entries[0] : null;
}

/** Format a release entry back to readable markdown */
export function formatReleaseAsMarkdown(entry: ReleaseEntry): string {
  const lines: string[] = [];
  lines.push(`## 当前版本更新 (v${entry.version} - ${entry.date})\n`);

  for (const [section, items] of Object.entries(entry.sections)) {
    lines.push(`### ${section}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
