import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles } from '../../utils/file-helpers.js';
import { escapeRegex } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Search src/shared/ and src/main/ for .ts files
  const srcDir = resolveProjectPath(projectRoot, 'src');
  const sharedFiles = await globFiles('shared/**/*.ts', srcDir);
  const mainFiles = await globFiles('main/**/*.ts', srcDir);

  const allFiles = new Set([...sharedFiles, ...mainFiles]);

  // Read all file contents into a combined string
  let combinedContent = '';
  for (const filePath of allFiles) {
    const content = readFileContent(filePath);
    if (content) {
      combinedContent += content + '\n';
    }
  }

  for (const errorCode of registry.errorCodes) {
    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (!combinedContent) {
      status = 'skip';
      actual = 'no source files found in src/shared/ or src/main/';
    } else {
      const escaped = escapeRegex(errorCode.code);
      const pattern = new RegExp(`['"\`]${escaped}['"\`]`);
      const found = pattern.test(combinedContent);

      status = found ? 'pass' : 'fail';
      actual = found
        ? `error code '${errorCode.code}' found in source`
        : `error code '${errorCode.code}' not found`;
    }

    results.push({
      id: `A10.error.${errorCode.code}`,
      dimension: 'A',
      description: `Error code defined: ${errorCode.code}`,
      status,
      expected: `error code '${errorCode.code}' should be defined`,
      actual,
      sourceRef: errorCode.sourceLocation,
    });
  }

  return results;
}

registerVerifier({
  id: 'A10',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: '错误码',
  fn: verify,
});
