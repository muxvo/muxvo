import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';
import { escapeRegex } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const ds of registry.dataStructures) {
    const typeFile = resolveProjectPath(projectRoot, `src/shared/types/${ds.sourceFile}`);

    if (!fileExists(typeFile)) {
      // Type-level skip
      results.push({
        id: `A8.type.${ds.name}`,
        dimension: 'A',
        description: `Type definition exists: ${ds.name}`,
        status: 'skip',
        expected: `${ds.name} should be defined in ${ds.sourceFile}`,
        actual: `file ${ds.sourceFile} not found`,
        sourceRef: ds.sourceLocation,
      });
      continue;
    }

    const content = readFileContent(typeFile);
    if (!content) {
      results.push({
        id: `A8.type.${ds.name}`,
        dimension: 'A',
        description: `Type definition exists: ${ds.name}`,
        status: 'skip',
        expected: `${ds.name} should be defined in ${ds.sourceFile}`,
        actual: `failed to read ${ds.sourceFile}`,
        sourceRef: ds.sourceLocation,
      });
      continue;
    }

    // Check if the type/interface is defined
    const typePattern = new RegExp(`(?:interface|type)\\s+${escapeRegex(ds.name)}\\b`);
    const typeFound = typePattern.test(content);

    results.push({
      id: `A8.type.${ds.name}`,
      dimension: 'A',
      description: `Type definition exists: ${ds.name}`,
      status: typeFound ? 'pass' : 'fail',
      expected: `${ds.name} should be defined`,
      actual: typeFound ? 'type/interface found' : `${ds.name} not found in ${ds.sourceFile}`,
      sourceRef: ds.sourceLocation,
    });

    // Check each field
    for (const field of ds.fields) {
      const fieldPattern = new RegExp(`\\b${escapeRegex(field.name)}\\s*[?]?\\s*:`);
      const fieldFound = fieldPattern.test(content);

      results.push({
        id: `A8.type.${ds.name}.${field.name}`,
        dimension: 'A',
        description: `Field '${field.name}' in type '${ds.name}'`,
        status: typeFound ? (fieldFound ? 'pass' : 'fail') : 'skip',
        expected: `field '${field.name}' should exist in ${ds.name}`,
        actual: typeFound
          ? (fieldFound ? 'field found' : `field '${field.name}' not found`)
          : `type ${ds.name} not found, skipping field check`,
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
