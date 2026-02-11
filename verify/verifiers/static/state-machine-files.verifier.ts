import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, resolveProjectPath } from '../../utils/file-helpers.js';

/**
 * Map prdSection (e.g., "6.1", "6.14") to a phase string.
 */
function sectionToPhase(prdSection: string): string {
  const num = parseFloat(prdSection);
  if (num <= 6.13) return 'V1';
  if (num <= 6.15) return 'V2-P0';
  if (num <= 6.16) return 'V2-P1';
  return 'V2-P2';
}

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const machine of registry.stateMachines) {
    const machinePhase = sectionToPhase(machine.prdSection);
    if (!isPhaseIncluded(machinePhase, activePhase)) continue;

    const machineFile = resolveProjectPath(projectRoot, `src/renderer/machines/${machine.fileName}`);
    const exists = fileExists(machineFile);

    results.push({
      id: `A5.machine.${machine.name}`,
      dimension: 'A',
      description: `State machine file exists: ${machine.fileName}`,
      status: exists ? 'pass' : 'fail',
      expected: `${machine.fileName} should exist`,
      actual: exists ? 'file exists' : 'file not found',
      sourceRef: machine.sourceLocation,
    });
  }

  return results;
}

registerVerifier({
  id: 'A5',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: '状态机文件',
  fn: verify,
});
