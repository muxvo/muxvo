/**
 * Analytics 事件覆盖率验证脚本
 *
 * 功能：检查 ANALYTICS_EVENTS 中定义的所有事件常量是否在 src/ 中被引用
 *
 * 用法：npx tsx tests/scripts/verify-analytics-coverage.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── 配置 ───────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const EVENTS_FILE = path.resolve(PROJECT_ROOT, 'src/shared/constants/analytics-events.ts');
const SCAN_DIRS = [
  path.resolve(PROJECT_ROOT, 'src/renderer'),
  path.resolve(PROJECT_ROOT, 'src/main'),
];

// ─── 提取事件常量 ──────────────────────────────────────────

interface EventEntry {
  /** e.g. "ANALYTICS_EVENTS.SESSION.START" */
  constant: string;
  /** e.g. "session.start" */
  value: string;
}

function extractEvents(): EventEntry[] {
  const content = fs.readFileSync(EVENTS_FILE, 'utf-8');
  const entries: EventEntry[] = [];

  // Match nested structure: CATEGORY: { KEY: 'value' }
  // Parse the ANALYTICS_EVENTS object by finding all string literal values
  const categoryRe = /^\s+(\w+):\s*\{/gm;
  let catMatch: RegExpExecArray | null;

  while ((catMatch = categoryRe.exec(content)) !== null) {
    const category = catMatch[1];
    const startIdx = catMatch.index + catMatch[0].length;

    // Find matching closing brace
    let depth = 1;
    let i = startIdx;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      i++;
    }
    const block = content.slice(startIdx, i - 1);

    // Extract KEY: 'value' pairs — only match UPPER_CASE keys (actual constants, not JSDoc params)
    const entryRe = /^\s+([A-Z][A-Z_]+):\s*['"]([^'"]+)['"]/gm;
    let entryMatch: RegExpExecArray | null;
    while ((entryMatch = entryRe.exec(block)) !== null) {
      entries.push({
        constant: `ANALYTICS_EVENTS.${category}.${entryMatch[1]}`,
        value: entryMatch[2],
      });
    }
  }

  return entries;
}

// ─── 扫描源文件 ─────────────────────────────────────────────

function findSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findSourceFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkCoverage(events: EventEntry[]): { covered: EventEntry[]; uncovered: EventEntry[] } {
  const sourceFiles: string[] = [];
  for (const dir of SCAN_DIRS) {
    sourceFiles.push(...findSourceFiles(dir));
  }

  // Read all source file contents (excluding the events definition file itself)
  const allContent = sourceFiles
    .filter(f => f !== EVENTS_FILE)
    .map(f => fs.readFileSync(f, 'utf-8'))
    .join('\n');

  const covered: EventEntry[] = [];
  const uncovered: EventEntry[] = [];

  for (const event of events) {
    // Check if the constant path is referenced (e.g. ANALYTICS_EVENTS.SESSION.START)
    if (allContent.includes(event.constant)) {
      covered.push(event);
    } else {
      uncovered.push(event);
    }
  }

  return { covered, uncovered };
}

// ─── 报告输出 ───────────────────────────────────────────────

function printReport(events: EventEntry[], covered: EventEntry[], uncovered: EventEntry[]): void {
  console.log('');
  console.log('  Analytics Event Coverage Report');
  console.log('  =======================================');
  console.log('');
  console.log(`  Events defined:      ${events.length}`);
  console.log(`  Events referenced:   ${covered.length}`);
  console.log(`  Events unreferenced: ${uncovered.length}`);
  console.log('');

  if (covered.length > 0) {
    console.log('  COVERED:');
    for (const e of covered) {
      console.log(`    OK  ${e.constant}  (${e.value})`);
    }
    console.log('');
  }

  if (uncovered.length > 0) {
    console.log('  WARNING — NOT YET REFERENCED:');
    for (const e of uncovered) {
      console.log(`    --  ${e.constant}  (${e.value})`);
    }
    console.log('');
  }

  const pct = events.length > 0 ? Math.round((covered.length / events.length) * 100) : 0;
  console.log(`  Coverage: ${pct}% (${covered.length}/${events.length})`);
  console.log('');
}

// ─── 主入口 ─────────────────────────────────────────────────

const events = extractEvents();
const { covered, uncovered } = checkCoverage(events);
printReport(events, covered, uncovered);

// Exit 0 — uncovered events are warnings, not errors
process.exit(0);
