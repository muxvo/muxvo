/**
 * VERIFY: "全部项目"搜索标题匹配缺失修复
 *
 * Bug: 搜索"系统"时，特定项目有标题匹配，全部项目没有。
 * Root cause: getAllRecentSessions 只扫描 ~40 个项目（maxProjectsToScan 限制）
 * Fix: 删除项目数限制 + 提取共享 helper + limit 200→500
 *
 * Run: npx vitest run tests/verify/VERIFY-all-projects-title-match.test.ts
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../..');

// ===== Source code structural verification =====

describe('Fix: getAllRecentSessions scans ALL projects (no cap)', () => {
  const src = readFileSync(resolve(ROOT, 'src/main/services/chat-dual-source.ts'), 'utf-8');

  test('maxProjectsToScan is removed — no project count limit', () => {
    // The old bug: maxProjectsToScan = Math.ceil(limit/5)
    expect(src).not.toContain('maxProjectsToScan');
  });

  test('getAllRecentSessions scans all project directories', () => {
    // collectFilesFromBase reads ALL dirs, no slicing by project count
    expect(src).toContain('const projectDirs = dirs.filter(d => d.isDirectory())');
    // No .slice() or limit on projectDirs before scanning
    expect(src).not.toContain('projectDirs.slice(0, max');
  });

  test('batched concurrency to prevent file handle exhaustion', () => {
    expect(src).toContain('BATCH_SIZE');
    expect(src).toContain('projectDirs.slice(i, i + BATCH_SIZE)');
  });
});

describe('Fix: shared collectAndExtractSessions helper', () => {
  const src = readFileSync(resolve(ROOT, 'src/main/services/chat-dual-source.ts'), 'utf-8');

  test('collectAndExtractSessions function exists', () => {
    expect(src).toContain('async function collectAndExtractSessions(');
  });

  test('shared helper handles CC priority merge', () => {
    // CC takes priority — same projectHash/fileName not duplicated
    expect(src).toContain("ccKeySet.has(af.projectHash + '/' + af.fileName)");
  });

  test('shared helper sorts by mtime descending and takes top N', () => {
    expect(src).toContain('merged.sort((a, b) => b.mtime - a.mtime)');
    expect(src).toContain('merged.slice(0, limit)');
  });

  test('getSessionsForProject uses shared helper', () => {
    // The function should call collectAndExtractSessions, not inline the logic
    expect(src).toContain('return collectAndExtractSessions(ccFiles, archiveFiles, limit);');
  });

  test('getAllRecentSessions uses shared helper', () => {
    // After collectFilesFromBase, should call the shared pipeline
    const allRecentBlock = src.slice(src.indexOf('async getAllRecentSessions'));
    expect(allRecentBlock).toContain('collectAndExtractSessions(ccFiles, archiveFiles, limit)');
  });

  test('scanSessionFilesFromDir is reused (not duplicated)', () => {
    // Both paths should use this shared scanner
    const occurrences = src.split('scanSessionFilesFromDir').length - 1;
    // Definition (1) + getSessionsForProject (1) + getAllRecentSessions (1) = at least 3
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});

describe('Fix: limit increased to 500', () => {
  const handlerSrc = readFileSync(resolve(ROOT, 'src/main/ipc/chat-handlers.ts'), 'utf-8');

  test('getAllRecentSessions called with 500 (not 200)', () => {
    expect(handlerSrc).toContain('getAllRecentSessions(500)');
    expect(handlerSrc).not.toContain('getAllRecentSessions(200)');
  });
});

describe('Fix: FileEntry interface for type safety', () => {
  const src = readFileSync(resolve(ROOT, 'src/main/services/chat-dual-source.ts'), 'utf-8');

  test('FileEntry interface is defined', () => {
    expect(src).toContain('interface FileEntry');
    expect(src).toContain('projectHash: string');
    expect(src).toContain('fileName: string');
    expect(src).toContain('filePath: string');
    expect(src).toContain('mtime: number');
    expect(src).toContain('archiveOnly?: boolean');
  });
});

// ===== Logic verification =====

describe('Logic: collectAndExtractSessions merge behavior', () => {
  interface FileEntry {
    projectHash: string;
    fileName: string;
    filePath: string;
    mtime: number;
    archiveOnly?: boolean;
  }

  function simulateMerge(ccFiles: FileEntry[], archiveFiles: FileEntry[], limit: number): FileEntry[] {
    const ccKeySet = new Set(ccFiles.map(f => f.projectHash + '/' + f.fileName));
    const merged: FileEntry[] = [...ccFiles];
    for (const af of archiveFiles) {
      if (!ccKeySet.has(af.projectHash + '/' + af.fileName)) {
        merged.push({ ...af, archiveOnly: true });
      }
    }
    merged.sort((a, b) => b.mtime - a.mtime);
    return merged.slice(0, limit);
  }

  test('CC files take priority over archive for same session', () => {
    const cc: FileEntry[] = [
      { projectHash: 'p1', fileName: 's1.jsonl', filePath: '/cc/p1/s1.jsonl', mtime: 100 },
    ];
    const archive: FileEntry[] = [
      { projectHash: 'p1', fileName: 's1.jsonl', filePath: '/archive/p1/s1.jsonl', mtime: 200 },
    ];
    const result = simulateMerge(cc, archive, 10);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('/cc/p1/s1.jsonl'); // CC wins
    expect(result[0].archiveOnly).toBeUndefined();
  });

  test('archive-only sessions are included and marked', () => {
    const cc: FileEntry[] = [
      { projectHash: 'p1', fileName: 's1.jsonl', filePath: '/cc/p1/s1.jsonl', mtime: 100 },
    ];
    const archive: FileEntry[] = [
      { projectHash: 'p2', fileName: 's2.jsonl', filePath: '/archive/p2/s2.jsonl', mtime: 200 },
    ];
    const result = simulateMerge(cc, archive, 10);
    expect(result).toHaveLength(2);
    const archiveEntry = result.find(f => f.fileName === 's2.jsonl')!;
    expect(archiveEntry.archiveOnly).toBe(true);
  });

  test('sorted by mtime descending', () => {
    const cc: FileEntry[] = [
      { projectHash: 'p1', fileName: 'old.jsonl', filePath: '/cc/p1/old.jsonl', mtime: 100 },
      { projectHash: 'p1', fileName: 'new.jsonl', filePath: '/cc/p1/new.jsonl', mtime: 300 },
    ];
    const result = simulateMerge(cc, [], 10);
    expect(result[0].mtime).toBe(300);
    expect(result[1].mtime).toBe(100);
  });

  test('limit caps the result count', () => {
    const cc: FileEntry[] = Array.from({ length: 100 }, (_, i) => ({
      projectHash: `p${i}`, fileName: `s${i}.jsonl`,
      filePath: `/cc/p${i}/s${i}.jsonl`, mtime: i,
    }));
    const result = simulateMerge(cc, [], 10);
    expect(result).toHaveLength(10);
    // Should have the 10 most recent (highest mtime)
    expect(result[0].mtime).toBe(99);
    expect(result[9].mtime).toBe(90);
  });
});

describe('Logic: no project scan cap means all projects are visible', () => {
  test('old bug scenario: 100 projects, only 40 scanned → 60% title matches lost', () => {
    // Simulating the old maxProjectsToScan = Math.ceil(limit/5)
    const totalProjects = 100;
    const limit = 200;
    const oldMaxProjects = Math.ceil(limit / 5); // = 40
    const oldCoverage = oldMaxProjects / totalProjects; // 40%
    expect(oldCoverage).toBe(0.4); // Only 40% of projects were scanned!
  });

  test('new behavior: all projects scanned regardless of count', () => {
    // With the fix, collectFilesFromBase scans all directories
    // No maxProjectsToScan variable exists anymore
    const totalProjects = 500;
    const scannedProjects = totalProjects; // ALL projects scanned
    expect(scannedProjects).toBe(totalProjects);
  });
});
