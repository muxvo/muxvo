import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles, dirExists } from '../../utils/file-helpers.js';
import { searchInContent } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const testsDir = resolveProjectPath(projectRoot, 'tests');
  if (!dirExists(testsDir)) {
    // If tests/ doesn't exist, skip all
    for (const spec of registry.testCoverage.unit) {
      results.push({
        id: `C1.unit.${spec.module}`,
        dimension: 'C',
        description: `Unit tests: ${spec.module} - ${spec.description}`,
        status: 'skip',
        expected: `>= ${spec.expectedCount} test cases`,
        actual: 'tests/ directory not found',
        sourceRef: { file: '', line: 0 },
      });
    }
    return results;
  }

  for (const spec of registry.testCoverage.unit) {
    // Search for test files matching the module name
    const patterns = [
      `tests/unit/**/*${spec.module}*.test.ts`,
      `tests/unit/**/*${spec.module}*.test.tsx`,
      `tests/unit/**/*${spec.module}*.spec.ts`,
      `tests/unit/**/*${spec.module}*.spec.tsx`,
      `tests/unit/${spec.module}/**/*.test.ts`,
      `tests/unit/${spec.module}/**/*.test.tsx`,
      `tests/unit/${spec.module}/**/*.spec.ts`,
      `tests/unit/${spec.module}/**/*.spec.tsx`,
    ];

    const allFiles: string[] = [];
    for (const pattern of patterns) {
      const files = await globFiles(pattern, projectRoot);
      allFiles.push(...files);
    }

    const uniqueFiles = [...new Set(allFiles)];

    if (uniqueFiles.length === 0) {
      results.push({
        id: `C1.unit.${spec.module}`,
        dimension: 'C',
        description: `Unit tests: ${spec.module} - ${spec.description}`,
        status: 'fail',
        expected: `>= ${spec.expectedCount} test cases`,
        actual: `no test files found for module '${spec.module}'`,
        sourceRef: { file: '', line: 0 },
      });
      continue;
    }

    // Count test cases (it() and test() calls)
    let testCount = 0;
    for (const filePath of uniqueFiles) {
      const content = readFileContent(filePath);
      if (!content) continue;

      const itMatches = searchInContent(content, /\bit\s*\(/g);
      const testMatches = searchInContent(content, /\btest\s*\(/g);
      testCount += itMatches.length + testMatches.length;
    }

    const threshold = Math.floor(spec.expectedCount * 0.8);

    if (testCount >= threshold) {
      results.push({
        id: `C1.unit.${spec.module}`,
        dimension: 'C',
        description: `Unit tests: ${spec.module} - ${spec.description}`,
        status: 'pass',
        expected: `>= ${spec.expectedCount} test cases (threshold: ${threshold})`,
        actual: `${testCount} test cases found in ${uniqueFiles.length} file(s)`,
        sourceRef: { file: '', line: 0 },
      });
    } else {
      results.push({
        id: `C1.unit.${spec.module}`,
        dimension: 'C',
        description: `Unit tests: ${spec.module} - ${spec.description}`,
        status: 'fail',
        expected: `>= ${spec.expectedCount} test cases (threshold: ${threshold})`,
        actual: `${testCount} test cases found (insufficient)`,
        sourceRef: { file: '', line: 0 },
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'C1',
  dimension: 'C',
  dimensionName: 'C.测试覆盖',
  name: '单元测试',
  fn: verify,
});
