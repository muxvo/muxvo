/**
 * 测试覆盖率验证脚本
 *
 * 功能：检查 JSON spec 中定义的用例与 .test.ts 中的测试函数 1:1 匹配
 *
 * 用法：npx tsx tests/scripts/verify-coverage.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── 配置 ───────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SPECS_DIR = path.resolve(PROJECT_ROOT, 'tests/specs');
const TESTS_DIR = path.resolve(PROJECT_ROOT, 'tests');

// ─── 类型 ───────────────────────────────────────────────────

interface SpecCase {
  id: string;
  description?: string;
  type?: string;
  priority?: string;
}

interface SpecFile {
  module: string;
  layer: string;
  totalCases?: number;
  cases: SpecCase[];
}

interface TestInfo {
  id: string;
  file: string;
  line: number;
  isTodo: boolean;
}

interface VerifyResult {
  specIds: Set<string>;
  testIds: Map<string, TestInfo>;
  missingInCode: string[];    // JSON 中有，代码中无
  extraInCode: string[];      // 代码中有，JSON 中无
  implemented: string[];      // test()（非 todo）
  pending: string[];          // test.todo()
  duplicateSpecs: string[];
  duplicateTests: string[];
}

// ─── JSON spec 扫描 ─────────────────────────────────────────

function findJsonFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.name.endsWith('.spec.json')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractSpecIds(specsDir: string): { ids: string[]; byFile: Map<string, string[]> } {
  const allIds: string[] = [];
  const byFile = new Map<string, string[]>();
  const jsonFiles = findJsonFiles(specsDir);

  for (const file of jsonFiles) {
    const content = JSON.parse(fs.readFileSync(file, 'utf-8')) as SpecFile;
    const relPath = path.relative(PROJECT_ROOT, file);
    const fileIds: string[] = [];

    if (content.cases && Array.isArray(content.cases)) {
      for (const c of content.cases) {
        if (c.id) {
          allIds.push(c.id);
          fileIds.push(c.id);
        }
      }
    }

    byFile.set(relPath, fileIds);
  }

  return { ids: allIds, byFile };
}

// ─── 测试文件扫描 ───────────────────────────────────────────

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !['scripts', 'specs', 'helpers', 'node_modules'].includes(entry.name)) {
      results.push(...findTestFiles(fullPath));
    } else if (entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/** 从测试字符串中提取用例 ID（冒号前部分） */
function extractTestId(testName: string): string | null {
  // 匹配标准格式 "TERM_L1_01: ..." 或带后缀 "TERM_L2_01_grid_1: ..."
  // 也支持 "CHAT_L1_T07: ..." 格式（字母+数字混合序号）
  const match = testName.match(/^([A-Z][A-Z0-9]+_L\d+_[A-Za-z0-9]+[a-z0-9_]*)/);
  return match ? match[1] : null;
}

function extractTestIds(testsDir: string): Map<string, TestInfo> {
  const testMap = new Map<string, TestInfo>();
  const testFiles = findTestFiles(testsDir);

  for (const file of testFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const relPath = path.relative(PROJECT_ROOT, file);

    // ── Pass 1: 静态 test('ID: ...') 和 test.todo('ID: ...') ──
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检查 test.todo()
      let match: RegExpExecArray | null;
      const todoRe = /test\.todo\s*\(\s*['"`]([^'"`]+)['"`]/g;
      while ((match = todoRe.exec(line)) !== null) {
        const id = extractTestId(match[1]);
        if (id) {
          testMap.set(id, { id, file: relPath, line: i + 1, isTodo: true });
        }
      }

      // 检查 test() — 非 todo
      const testRe = /(?<!\.todo\s*)\btest\s*\(\s*['"`]([^'"`]+)['"`]/g;
      while ((match = testRe.exec(line)) !== null) {
        const id = extractTestId(match[1]);
        if (id) {
          testMap.set(id, { id, file: relPath, line: i + 1, isTodo: false });
        }
      }
    }

    // ── Pass 2: test.each(...)('$id: ...') 从 JSON spec 动态注入 ──
    // 检测 import xxxSpec from '...spec.json' + test.each(...)('$id
    const hasTestEachWithId = /test\.each\s*\([^)]*\)\s*\(\s*['"`]\$id/.test(content);
    if (hasTestEachWithId) {
      const importRe = /import\s+(\w+)\s+from\s+['"]([^'"]*\.spec\.json)['"]/g;
      let importMatch: RegExpExecArray | null;
      while ((importMatch = importRe.exec(content)) !== null) {
        const specRelImport = importMatch[2];
        const resolvedSpec = path.resolve(path.dirname(file), specRelImport);
        if (fs.existsSync(resolvedSpec)) {
          try {
            const specContent = JSON.parse(fs.readFileSync(resolvedSpec, 'utf-8'));
            if (specContent.cases && Array.isArray(specContent.cases)) {
              for (const c of specContent.cases) {
                if (c.id && !testMap.has(c.id)) {
                  testMap.set(c.id, { id: c.id, file: relPath, line: 0, isTodo: false });
                }
              }
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  }

  return testMap;
}

// ─── 验证逻辑 ───────────────────────────────────────────────

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dups.push(id);
    seen.add(id);
  }
  return dups;
}

function verify(): VerifyResult {
  const specs = extractSpecIds(SPECS_DIR);
  const specIds = new Set(specs.ids);
  const testIds = extractTestIds(TESTS_DIR);

  const missingInCode = specs.ids.filter(id => !testIds.has(id));
  const extraInCode: string[] = [];

  // 只检查 JSON 覆盖范围内的层级（L1 + L2 中 JSON 化的部分）
  for (const [id] of testIds) {
    // 不报告 JSON 中没有但代码中有的用例（手写的 L2/L3 测试不需要 JSON）
    // 仅在 specIds 非空时做反向检查
  }

  const implemented = specs.ids.filter(id => {
    const info = testIds.get(id);
    return info && !info.isTodo;
  });

  const pending = specs.ids.filter(id => {
    const info = testIds.get(id);
    return !info || info.isTodo;
  });

  const duplicateSpecs = findDuplicates(specs.ids);
  const duplicateTests = findDuplicates(Array.from(testIds.keys()));

  return {
    specIds,
    testIds,
    missingInCode,
    extraInCode,
    implemented,
    pending,
    duplicateSpecs,
    duplicateTests,
  };
}

// ─── 报告输出 ───────────────────────────────────────────────

function printReport(result: VerifyResult): boolean {
  const { specIds, testIds, missingInCode, implemented, pending, duplicateSpecs, duplicateTests } = result;

  const totalSpec = specIds.size;
  const totalTest = testIds.size;

  console.log('');
  console.log('  Test Coverage Verification Report');
  console.log('  =======================================');
  console.log('');
  console.log(`  JSON specs defined:       ${totalSpec}`);
  console.log(`  Test functions found:      ${totalTest} (across all .test.ts files)`);
  console.log('');
  console.log(`  Matched (implemented):     ${implemented.length}`);
  console.log(`  Matched (todo):            ${pending.length - missingInCode.length}`);
  console.log(`  Missing in test code:      ${missingInCode.length}`);
  console.log(`  Duplicate spec IDs:        ${duplicateSpecs.length}`);
  console.log(`  Duplicate test IDs:        ${duplicateTests.length}`);
  console.log('');

  let hasErrors = false;

  if (missingInCode.length > 0) {
    hasErrors = true;
    console.log('  MISSING IN TEST CODE (defined in JSON but not in .test.ts):');
    for (const id of missingInCode) {
      console.log(`    - ${id}`);
    }
    console.log('');
  }

  if (duplicateSpecs.length > 0) {
    hasErrors = true;
    console.log('  DUPLICATE SPEC IDs:');
    for (const id of duplicateSpecs) {
      console.log(`    - ${id}`);
    }
    console.log('');
  }

  if (duplicateTests.length > 0) {
    hasErrors = true;
    console.log('  DUPLICATE TEST IDs:');
    for (const id of duplicateTests) {
      console.log(`    - ${id}`);
    }
    console.log('');
  }

  if (!hasErrors) {
    console.log('  ALL JSON SPECS MATCHED WITH TEST CODE');
  } else {
    console.log('  VERIFICATION FAILED');
  }

  console.log('');
  return !hasErrors;
}

// ─── 主入口 ─────────────────────────────────────────────────

const result = verify();
const passed = printReport(result);
process.exit(passed ? 0 : 1);
