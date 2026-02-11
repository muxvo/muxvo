import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles, dirExists } from '../../utils/file-helpers.js';
import { contentContains } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const testsDir = resolveProjectPath(projectRoot, 'tests', 'integration');
  if (!dirExists(testsDir)) {
    for (const spec of registry.testCoverage.integration) {
      results.push({
        id: `C2.integration.${spec.scenario}`,
        dimension: 'C',
        description: `Integration test: ${spec.scenario} - ${spec.description}`,
        status: 'skip',
        expected: `integration test for scenario '${spec.scenario}'`,
        actual: 'tests/integration/ directory not found',
        sourceRef: { file: '', line: 0 },
      });
    }
    return results;
  }

  // Gather all integration test files
  const testFiles = await globFiles('tests/integration/**/*.{test,spec}.{ts,tsx}', projectRoot);

  if (testFiles.length === 0) {
    for (const spec of registry.testCoverage.integration) {
      results.push({
        id: `C2.integration.${spec.scenario}`,
        dimension: 'C',
        description: `Integration test: ${spec.scenario} - ${spec.description}`,
        status: 'fail',
        expected: `integration test for scenario '${spec.scenario}'`,
        actual: 'no integration test files found',
        sourceRef: { file: '', line: 0 },
      });
    }
    return results;
  }

  // Read all test file contents once
  const fileContents: Array<{ path: string; content: string }> = [];
  for (const filePath of testFiles) {
    const content = readFileContent(filePath);
    if (content) {
      fileContents.push({ path: filePath.replace(projectRoot + '/', ''), content });
    }
  }

  for (const spec of registry.testCoverage.integration) {
    // Extract keywords from scenario and description
    const keywords = extractKeywords(spec.scenario, spec.description);

    let found = false;
    let matchedFile = '';

    for (const { path: relPath, content } of fileContents) {
      // Check if any keyword appears in the file content
      const matches = keywords.filter(kw => contentContains(content, kw, true));
      if (matches.length > 0) {
        found = true;
        matchedFile = relPath;
        break;
      }
    }

    if (found) {
      results.push({
        id: `C2.integration.${spec.scenario}`,
        dimension: 'C',
        description: `Integration test: ${spec.scenario} - ${spec.description}`,
        status: 'pass',
        expected: `integration test for scenario '${spec.scenario}'`,
        actual: `relevant test found in ${matchedFile}`,
        sourceRef: { file: '', line: 0 },
      });
    } else {
      results.push({
        id: `C2.integration.${spec.scenario}`,
        dimension: 'C',
        description: `Integration test: ${spec.scenario} - ${spec.description}`,
        status: 'fail',
        expected: `integration test for scenario '${spec.scenario}'`,
        actual: 'no matching integration test found',
        sourceRef: { file: '', line: 0 },
      });
    }
  }

  return results;
}

function extractKeywords(scenario: string, description: string): string[] {
  const combined = scenario + ' ' + description;
  // Extract meaningful words (Chinese or English, >= 2 chars)
  const words: string[] = [];

  // Extract Chinese phrases (2+ chars)
  const chineseMatches = combined.match(/[\u4e00-\u9fff]{2,}/g);
  if (chineseMatches) words.push(...chineseMatches);

  // Extract English words (3+ chars, not stop words)
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'should', 'can', 'not']);
  const englishMatches = combined.match(/[a-zA-Z]{3,}/g);
  if (englishMatches) {
    for (const w of englishMatches) {
      if (!stopWords.has(w.toLowerCase())) {
        words.push(w);
      }
    }
  }

  return words;
}

registerVerifier({
  id: 'C2',
  dimension: 'C',
  dimensionName: 'C.测试覆盖',
  name: '集成测试',
  fn: verify,
});
