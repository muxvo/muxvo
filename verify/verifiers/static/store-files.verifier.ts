import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, resolveProjectPath } from '../../utils/file-helpers.js';

interface StoreEntry {
  name: string;
  phase: string;
}

const STORES: StoreEntry[] = [
  { name: 'terminal', phase: 'V1' },
  { name: 'layout', phase: 'V1' },
  { name: 'chat', phase: 'V1' },
  { name: 'config', phase: 'V1' },
  { name: 'marketplace', phase: 'V1' },
  { name: 'preferences', phase: 'V1' },
  { name: 'score', phase: 'V2-P1' },
  { name: 'showcase', phase: 'V2-P2' },
  { name: 'analytics', phase: 'V1' },
  { name: 'publish-draft', phase: 'V2-P2' },
];

async function verify(_registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const store of STORES) {
    if (!isPhaseIncluded(store.phase, activePhase)) continue;

    const storeFile = resolveProjectPath(projectRoot, `src/renderer/stores/${store.name}.store.ts`);
    const exists = fileExists(storeFile);

    results.push({
      id: `A7.store.${store.name}`,
      dimension: 'A',
      description: `Store 文件存在: ${store.name}.store.ts`,
      status: exists ? 'pass' : 'fail',
      expected: `文件存在: src/renderer/stores/${store.name}.store.ts`,
      actual: exists ? '文件存在' : '文件不存在',
      sourceRef: { file: 'DEV-PLAN.md', line: 0 },
    });
  }

  return results;
}

registerVerifier({
  id: 'A7',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: 'Store文件',
  fn: verify,
});
