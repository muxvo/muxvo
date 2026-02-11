import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, resolveProjectPath } from '../../utils/file-helpers.js';

function prdSectionToPhase(section: string): string {
  const num = parseFloat(section);
  if (num >= 6.1 && num <= 6.13) return 'V1';
  if (num >= 6.14 && num <= 6.15) return 'V2-P0';
  if (num === 6.16) return 'V2-P1';
  if (num >= 6.17 && num <= 6.18) return 'V2-P2';
  return 'V1'; // default
}

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const machine of registry.stateMachines) {
    const machinePhase = prdSectionToPhase(machine.prdSection);
    if (!isPhaseIncluded(machinePhase, activePhase)) continue;

    const machineFile = resolveProjectPath(projectRoot, `src/renderer/machines/${machine.fileName}`);
    const exists = fileExists(machineFile);

    results.push({
      id: `A5.machine.${machine.name}`,
      dimension: 'A',
      description: `状态机文件存在: ${machine.fileName}`,
      status: exists ? 'pass' : 'fail',
      expected: `文件存在: src/renderer/machines/${machine.fileName}`,
      actual: exists ? '文件存在' : '文件不存在',
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
