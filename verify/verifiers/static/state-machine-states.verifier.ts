import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';
import { toCamelCase } from '../../utils/pattern-matchers.js';

/**
 * Map prdSection to a phase string.
 */
function sectionToPhase(prdSection: string): string {
  const num = parseFloat(prdSection);
  if (num <= 6.13) return 'V1';
  if (num <= 6.15) return 'V2-P0';
  if (num <= 6.16) return 'V2-P1';
  return 'V2-P2';
}

/**
 * Extract state names from XState machine file content.
 * Tries multiple patterns to find state definitions.
 */
function extractStateNames(content: string): Set<string> {
  const states = new Set<string>();

  // Method 1: Match property names inside a `states: {` block
  // Look for lines like `  stateName: {` at appropriate indentation
  const statesBlockMatch = content.match(/states\s*:\s*\{/);
  if (statesBlockMatch && statesBlockMatch.index !== undefined) {
    const afterStates = content.slice(statesBlockMatch.index);
    // Track brace depth to find top-level state keys
    let depth = 0;
    let started = false;
    let inKey = true;
    const lines = afterStates.split('\n');

    for (const line of lines) {
      for (const ch of line) {
        if (ch === '{') {
          depth++;
          started = true;
          inKey = false;
        }
        if (ch === '}') depth--;
      }
      // Top-level properties inside states: { ... } are at depth 1
      if (started && depth === 1) {
        const propMatch = line.match(/^\s+['"]?(\w[\w-]*)['"]?\s*:\s*\{/);
        if (propMatch) {
          states.add(propMatch[1]);
        }
      }
      if (started && depth <= 0) break;
    }
  }

  // Method 2: Search for XState v5 state builder patterns
  // e.g., state('StateName', ...) or .state('StateName')
  const stateCallRegex = /\.?state\s*\(\s*['"](\w[\w-]*)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = stateCallRegex.exec(content)) !== null) {
    states.add(match[1]);
  }

  // Method 3: createMachine states enumeration via string union / enum
  const enumRegex = /['"](\w[\w-]*)['"]\s*(?:,|\|)/g;
  // This is too broad; only use methods 1 & 2

  return states;
}

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const machine of registry.stateMachines) {
    const machinePhase = sectionToPhase(machine.prdSection);
    if (!isPhaseIncluded(machinePhase, activePhase)) continue;

    const machineFile = resolveProjectPath(projectRoot, `src/renderer/machines/${machine.fileName}`);

    if (!fileExists(machineFile)) {
      // Skip all states for missing machine files
      for (const stateName of machine.states) {
        results.push({
          id: `A6.machine.${machine.name}.state.${stateName}`,
          dimension: 'A',
          description: `State '${stateName}' in machine '${machine.name}'`,
          status: 'skip',
          expected: `state '${stateName}' should exist`,
          actual: `machine file ${machine.fileName} not found`,
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
          description: `State '${stateName}' in machine '${machine.name}'`,
          status: 'skip',
          expected: `state '${stateName}' should exist`,
          actual: `failed to read ${machine.fileName}`,
          sourceRef: machine.sourceLocation,
        });
      }
      continue;
    }

    const foundStates = extractStateNames(content);
    // Build a lowercase set for case-insensitive matching
    const foundStatesLower = new Set([...foundStates].map(s => s.toLowerCase()));

    for (const stateName of machine.states) {
      const nameVariants = [
        stateName,
        stateName.toLowerCase(),
        toCamelCase(stateName),
        toCamelCase(stateName).toLowerCase(),
      ];

      const found = nameVariants.some(v => foundStates.has(v)) ||
        nameVariants.some(v => foundStatesLower.has(v.toLowerCase()));

      results.push({
        id: `A6.machine.${machine.name}.state.${stateName}`,
        dimension: 'A',
        description: `State '${stateName}' in machine '${machine.name}'`,
        status: found ? 'pass' : 'fail',
        expected: `state '${stateName}' should be defined`,
        actual: found ? 'state found' : `state '${stateName}' not found in ${machine.fileName}`,
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
