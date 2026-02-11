import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';
import { escapeRegex } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const ds of registry.dataStructures) {
    const typeFile = resolveProjectPath(projectRoot, `src/shared/types/${ds.sourceFile}`);
    const exists = fileExists(typeFile);

    if (!exists) {
      results.push({
        id: `A8.type.${ds.name}`,
        dimension: 'A',
        description: `类型定义文件存在: ${ds.sourceFile}`,
        status: 'skip',
        expected: `文件存在: src/shared/types/${ds.sourceFile}`,
        actual: '文件不存在',
        sourceRef: ds.sourceLocation,
      });
      continue;
    }

    const content = readFileContent(typeFile);
    if (!content) {
      results.push({
        id: `A8.type.${ds.name}`,
        dimension: 'A',
        description: `类型定义: ${ds.name}`,
        status: 'skip',
        expected: `interface/type ${ds.name} 已定义`,
        actual: '无法读取文件',
        sourceRef: ds.sourceLocation,
      });
      continue;
    }

    // Check if the interface/type is defined
    const nameEscaped = escapeRegex(ds.name);
    const typeDefPattern = new RegExp(`(interface|type)\\s+${nameEscaped}\\b`);
    const typeFound = typeDefPattern.test(content);

    results.push({
      id: `A8.type.${ds.name}`,
      dimension: 'A',
      description: `类型定义: ${ds.name}`,
      status: typeFound ? 'pass' : 'fail',
      expected: `interface/type ${ds.name} 已定义`,
      actual: typeFound ? '类型已定义' : `未找到 interface/type ${ds.name}`,
      sourceRef: ds.sourceLocation,
    });

    // Check each field
    for (const field of ds.fields) {
      const fieldEscaped = escapeRegex(field.name);
      const fieldPattern = new RegExp(`\\b${fieldEscaped}\\s*[?:]`);
      const fieldFound = content ? fieldPattern.test(content) : false;

      results.push({
        id: `A8.type.${ds.name}.${field.name}`,
        dimension: 'A',
        description: `类型字段: ${ds.name}.${field.name}`,
        status: fieldFound ? 'pass' : 'fail',
        expected: `字段 '${field.name}' 存在于 ${ds.name}`,
        actual: fieldFound ? '字段已定义' : `未找到字段 '${field.name}'`,
        sourceRef: ds.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'A8',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: '类型定义',
  fn: verify,
});
