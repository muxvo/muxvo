import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';
import { escapeRegex } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const preloadFile = resolveProjectPath(projectRoot, 'src/preload/index.ts');
  const exists = fileExists(preloadFile);
  const content = exists ? readFileContent(preloadFile) : null;

  // Also check for a preload directory with multiple files
  let allPreloadContent = content || '';
  if (!content) {
    const preloadDir = resolveProjectPath(projectRoot, 'src/preload');
    const altFile = resolveProjectPath(projectRoot, 'src/preload/index.ts');
    if (fileExists(altFile)) {
      allPreloadContent = readFileContent(altFile) || '';
    }
  }

  for (const channel of registry.ipcChannels) {
    if (!isPhaseIncluded(channel.phase, activePhase)) continue;

    // Only check R→M channels — these need to be exposed in preload
    if (channel.direction === 'M→R') {
      // M→R channels need an 'on' listener exposed
      let status: 'pass' | 'fail' | 'skip';
      let actual: string;

      if (!allPreloadContent) {
        status = 'skip';
        actual = 'preload/index.ts not found';
      } else {
        const escaped = escapeRegex(channel.name);
        const onPattern = new RegExp(`['"\`]${escaped}['"\`]`);
        if (onPattern.test(allPreloadContent)) {
          status = 'pass';
          actual = `channel '${channel.name}' exposed in preload`;
        } else {
          status = 'fail';
          actual = `channel '${channel.name}' not found in preload bridge`;
        }
      }

      results.push({
        id: `A4.preload.${channel.name}`,
        dimension: 'A',
        description: `Preload bridge exposes listener: ${channel.name}`,
        status,
        expected: `M→R channel '${channel.name}' should have on/listener in preload`,
        actual,
        sourceRef: channel.sourceLocation,
      });
    } else {
      // R→M channels need invoke/send exposed
      let status: 'pass' | 'fail' | 'skip';
      let actual: string;

      if (!allPreloadContent) {
        status = 'skip';
        actual = 'preload/index.ts not found';
      } else {
        const escaped = escapeRegex(channel.name);
        const invokePattern = new RegExp(`['"\`]${escaped}['"\`]`);
        if (invokePattern.test(allPreloadContent)) {
          status = 'pass';
          actual = `channel '${channel.name}' exposed in preload`;
        } else {
          status = 'fail';
          actual = `channel '${channel.name}' not found in preload bridge`;
        }
      }

      results.push({
        id: `A4.preload.${channel.name}`,
        dimension: 'A',
        description: `Preload bridge exposes invoke: ${channel.name}`,
        status,
        expected: `R→M channel '${channel.name}' should have invoke/send in preload`,
        actual,
        sourceRef: channel.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'A4',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: 'Preload桥接',
  fn: verify,
});
