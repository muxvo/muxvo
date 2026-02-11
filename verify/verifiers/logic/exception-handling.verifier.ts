import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles } from '../../utils/file-helpers.js';
import { contentContains } from '../../utils/pattern-matchers.js';

const taskToFile: Record<string, string[]> = {
  'A5': ['src/main/services/pty-manager.ts', 'src/renderer/components/terminal/**'],
  'D1': ['src/main/utils/cc-data-reader.ts'],
  'D3': ['src/main/services/chat-sync.ts'],
  'H1': ['src/renderer/components/file-browser/**'],
  'X1': ['src/renderer/components/onboarding/**'],
  'X5': ['src/main/**/*.ts'],
  'N2-8': ['src/main/services/aggregator.ts'],
  'O-1': ['src/main/services/package-installer.ts'],
  'O-2': ['src/main/services/package-installer.ts'],
  'SR-3': ['src/main/ipc/score.ipc.ts'],
  'SR-5': ['src/main/ipc/score.ipc.ts'],
  'P2-5': ['src/main/services/auth-service.ts'],
  'P2-7': ['src/main/ipc/showcase.ipc.ts'],
  'P2-9': ['src/renderer/components/showcase/**'],
  'SS-2': ['src/renderer/components/showcase/**'],
  'SS-3': ['src/renderer/components/showcase/**'],
};

const exceptionPatterns = [
  /try\s*\{/,
  /\.catch\s*\(/,
  /catch\s*\(/,
  /throw\s+new\s+Error/,
  /\.on\s*\(\s*['"]error['"]/,
  /error\s*handling/i,
  /handleError|onError|errorHandler/i,
];

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const exc of registry.exceptions) {
    const task = exc.responsibleTask;
    const filePatterns = taskToFile[task];

    if (!filePatterns || filePatterns.length === 0) {
      results.push({
        id: `B3.exception.${exc.id}`,
        dimension: 'B',
        description: `Exception handling: ${exc.scenario}`,
        status: 'skip',
        expected: `exception handling for scenario: ${exc.scenario}`,
        actual: `no file mapping for task '${task}'`,
        sourceRef: exc.sourceLocation,
      });
      continue;
    }

    // Resolve all files (handle globs)
    const allFiles: string[] = [];
    for (const pattern of filePatterns) {
      if (pattern.includes('*')) {
        const files = await globFiles(pattern, projectRoot);
        allFiles.push(...files);
      } else {
        allFiles.push(resolveProjectPath(projectRoot, pattern));
      }
    }

    if (allFiles.length === 0) {
      results.push({
        id: `B3.exception.${exc.id}`,
        dimension: 'B',
        description: `Exception handling: ${exc.scenario}`,
        status: 'skip',
        expected: `exception handling for scenario: ${exc.scenario}`,
        actual: 'no matching source files found',
        sourceRef: exc.sourceLocation,
      });
      continue;
    }

    let foundExceptionHandling = false;
    let foundCopyText = false;
    let matchedFile = '';

    for (const filePath of allFiles) {
      const content = readFileContent(filePath);
      if (!content) continue;

      // Search for exception handling patterns
      for (const pattern of exceptionPatterns) {
        if (pattern.test(content)) {
          foundExceptionHandling = true;
          matchedFile = filePath.replace(projectRoot + '/', '');
          break;
        }
      }

      // Search for the copy text (first 20 chars, if not "静默处理")
      if (exc.copyText && exc.copyText !== '静默处理' && exc.copyText.length > 0) {
        const searchText = exc.copyText.substring(0, 20).replace(/[^\u4e00-\u9fff\w\s]/g, '');
        if (searchText.length > 0 && contentContains(content, searchText)) {
          foundCopyText = true;
          if (!matchedFile) {
            matchedFile = filePath.replace(projectRoot + '/', '');
          }
        }
      }

      if (foundExceptionHandling) break;
    }

    if (foundExceptionHandling) {
      const details = foundCopyText ? 'error handling and copy text found' : 'error handling found';
      results.push({
        id: `B3.exception.${exc.id}`,
        dimension: 'B',
        description: `Exception handling: ${exc.scenario}`,
        status: 'pass',
        expected: `exception handling for scenario: ${exc.scenario}`,
        actual: `${details} in ${matchedFile}`,
        sourceRef: exc.sourceLocation,
      });
    } else {
      results.push({
        id: `B3.exception.${exc.id}`,
        dimension: 'B',
        description: `Exception handling: ${exc.scenario}`,
        status: 'fail',
        expected: `exception handling for scenario: ${exc.scenario}`,
        actual: 'no exception handling pattern found in mapped files',
        sourceRef: exc.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'B3',
  dimension: 'B',
  dimensionName: 'B.代码逻辑',
  name: '异常处理',
  fn: verify,
});
