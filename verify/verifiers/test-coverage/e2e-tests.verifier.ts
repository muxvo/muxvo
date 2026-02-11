import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles, dirExists } from '../../utils/file-helpers.js';
import { contentContains } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const testsDir = resolveProjectPath(projectRoot, 'tests', 'e2e');
  if (!dirExists(testsDir)) {
    for (const spec of registry.testCoverage.e2e) {
      results.push({
        id: `C3.e2e.${spec.flow}`,
        dimension: 'C',
        description: `E2E test: ${spec.flow} - ${spec.description}`,
        status: 'skip',
        expected: `e2e test for flow '${spec.flow}'`,
        actual: 'tests/e2e/ directory not found',
        sourceRef: { file: '', line: 0 },
      });
    }
    return results;
  }

  // Gather all e2e test files
  const testFiles = await globFiles('tests/e2e/**/*.{test,spec}.{ts,tsx}', projectRoot);

  if (testFiles.length === 0) {
    for (const spec of registry.testCoverage.e2e) {
      results.push({
        id: `C3.e2e.${spec.flow}`,
        dimension: 'C',
        description: `E2E test: ${spec.flow} - ${spec.description}`,
        status: 'fail',
        expected: `e2e test for flow '${spec.flow}'`,
        actual: 'no e2e test files found',
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

  for (const spec of registry.testCoverage.e2e) {
    // Extract keywords from flow and description
    const keywords = extractKeywords(spec.flow, spec.description);

    let found = false;
    let matchedFile = '';

    for (const { path: relPath, content } of fileContents) {
      const matches = keywords.filter(kw => contentContains(content, kw, true));
      if (matches.length > 0) {
        found = true;
        matchedFile = relPath;
        break;
      }
    }

    if (found) {
      results.push({
        id: `C3.e2e.${spec.flow}`,
        dimension: 'C',
        description: `E2E test: ${spec.flow} - ${spec.description}`,
        status: 'pass',
        expected: `e2e test for flow '${spec.flow}'`,
        actual: `relevant test found in ${matchedFile}`,
        sourceRef: { file: '', line: 0 },
      });
    } else {
      results.push({
        id: `C3.e2e.${spec.flow}`,
        dimension: 'C',
        description: `E2E test: ${spec.flow} - ${spec.description}`,
        status: 'fail',
        expected: `e2e test for flow '${spec.flow}'`,
        actual: 'no matching e2e test found',
        sourceRef: { file: '', line: 0 },
      });
    }
  }

  return results;
}

function extractKeywords(flow: string, description: string): string[] {
  const combined = flow + ' ' + description;
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
  id: 'C3',
  dimension: 'C',
  dimensionName: 'C.测试覆盖',
  name: 'E2E测试',
  fn: verify,
});
