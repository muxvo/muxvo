import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';
import { toCamelCase } from '../../utils/pattern-matchers.js';

function prdSectionToPhase(section: string): string {
  const num = parseFloat(section);
  if (num >= 6.1 && num <= 6.13) return 'V1';
  if (num >= 6.14 && num <= 6.15) return 'V2-P0';
  if (num === 6.16) return 'V2-P1';
  if (num >= 6.17 && num <= 6.18) return 'V2-P2';
  return 'V1';
}

/**
 * Extract state names from XState machine file content.
 * Searches for state property keys within the `states: { ... }` block
 * and also looks for XState v5 state('Name', ...) patterns.
 */
function extractStateNames(content: string): Set<string> {
  const states = new Set<string>();

  // Method 1: Extract keys from `states: { stateName: { ... } }` pattern
  // Find the states block and extract top-level property names
  const statesBlockMatch = content.match(/states\s*:\s*\{/);
  if (statesBlockMatch && statesBlockMatch.index !== undefined) {
    const startIdx = statesBlockMatch.index + statesBlockMatch[0].length;
    let depth = 1;
    let i = startIdx;
    let currentKey = '';
    let inKey = true;

    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') {
        depth++;
        inKey = false;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) break;
        if (depth === 1) inKey = true;
      } else if (depth === 1 && inKey) {
        // At top level of states block, look for property keys
        if (ch === ':' && currentKey.trim()) {
          states.add(currentKey.trim().replace(/['"]/g, ''));
          currentKey = '';
          inKey = false;
        } else if (ch === ',' || ch === '\n') {
          currentKey = '';
          inKey = true;
        } else if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
          currentKey += ch;
        }
      }
      i++;
    }
  }

  // Method 2: Search for XState v5 state function pattern
  const stateCallPattern = /state\s*\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = stateCallPattern.exec(content)) !== null) {
    states.add(match[1]);
  }

  // Method 3: Search for quoted property names in states-like context
  const quotedKeyPattern = /['"](\w[\w-]*)['"](?:\s*:\s*\{)/g;
  while ((match = quotedKeyPattern.exec(content)) !== null) {
    states.add(match[1]);
  }

  return states;
}

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const machine of registry.stateMachines) {
    const machinePhase = prdSectionToPhase(machine.prdSection);
    if (!isPhaseIncluded(machinePhase, activePhase)) continue;

    const machineFile = resolveProjectPath(projectRoot, `src/renderer/machines/${machine.fileName}`);
    const exists = fileExists(machineFile);

    if (!exists) {
      for (const stateName of machine.states) {
        results.push({
          id: `A6.machine.${machine.name}.state.${stateName}`,
          dimension: 'A',
          description: `状态机 ${machine.name} 状态: ${stateName}`,
          status: 'skip',
          expected: `状态 '${stateName}' 已定义`,
          actual: `状态机文件不存在: ${machine.fileName}`,
          sourceRef: machine.sourceLocation,
        });
      }
      continue;
    }

    const content = readFileContent(machineFile);
    if (!content) {
      for (const stateName of machine.states) {
        results.push({
          id: `A6.machine.${machine.name}.state.${stateName}`,
          dimension: 'A',
          description: `状态机 ${machine.name} 状态: ${stateName}`,
          status: 'skip',
          expected: `状态 '${stateName}' 已定义`,
          actual: '无法读取状态机文件',
          sourceRef: machine.sourceLocation,
        });
      }
      continue;
    }

    const foundStates = extractStateNames(content);
    // Build lowercase set for case-insensitive matching
    const foundStatesLower = new Set([...foundStates].map(s => s.toLowerCase()));

    for (const stateName of machine.states) {
      const lowerName = stateName.toLowerCase();
      const camelName = toCamelCase(stateName).toLowerCase();

      const found = foundStatesLower.has(lowerName) || foundStatesLower.has(camelName);

      results.push({
        id: `A6.machine.${machine.name}.state.${stateName}`,
        dimension: 'A',
        description: `状态机 ${machine.name} 状态: ${stateName}`,
        status: found ? 'pass' : 'fail',
        expected: `状态 '${stateName}' 已定义`,
        actual: found ? '状态已找到' : `未找到状态 '${stateName}'`,
        sourceRef: machine.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'A6',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: '状态机状态',
  fn: verify,
});
