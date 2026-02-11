import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles } from '../../utils/file-helpers.js';
import { contentContains } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Search src/shared/ and src/main/ for .ts files
  const sharedFiles = await globFiles('**/*.ts', resolveProjectPath(projectRoot, 'src/shared'));
  const mainFiles = await globFiles('**/*.ts', resolveProjectPath(projectRoot, 'src/main'));

  const allFiles = [...sharedFiles, ...mainFiles];

  // Read all file contents
  const allContents: string[] = [];
  for (const file of allFiles) {
    const content = readFileContent(file);
    if (content) allContents.push(content);
  }
  const combinedContent = allContents.join('\n');

  for (const errorCode of registry.errorCodes) {
    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (allFiles.length === 0) {
      status = 'skip';
      actual = 'src/shared/ 和 src/main/ 下未找到 .ts 文件';
    } else {
      const found = contentContains(combinedContent, `'${errorCode.code}'`) ||
                     contentContains(combinedContent, `"${errorCode.code}"`);
      status = found ? 'pass' : 'fail';
      actual = found ? `错误码 '${errorCode.code}' 已定义` : `未找到错误码: ${errorCode.code}`;
    }

    results.push({
      id: `A10.error.${errorCode.code}`,
      dimension: 'A',
      description: `错误码定义: ${errorCode.code}`,
      status,
      expected: `错误码 '${errorCode.code}' 在代码中已定义`,
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
