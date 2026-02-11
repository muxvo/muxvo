import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, dirExists, resolveProjectPath } from '../../utils/file-helpers.js';

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const entry of registry.directoryTree) {
    if (!isPhaseIncluded(entry.phase, activePhase)) continue;

    const fullPath = resolveProjectPath(projectRoot, entry.path);
    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (entry.type === 'file') {
      const exists = fileExists(fullPath);
      status = exists ? 'pass' : 'fail';
      actual = exists ? 'file exists' : 'file not found';
    } else {
      const exists = dirExists(fullPath);
      status = exists ? 'pass' : 'fail';
      actual = exists ? 'directory exists' : 'directory not found';
    }

    results.push({
      id: `A1.dir.${entry.path}`,
      dimension: 'A',
      description: `${entry.type === 'file' ? 'File' : 'Directory'} exists: ${entry.path}`,
      status,
      expected: `${entry.type} should exist`,
      actual,
      sourceRef: entry.sourceLocation,
    });
  }

  return results;
}

registerVerifier({
  id: 'A1',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: '目录结构',
  fn: verify,
});
