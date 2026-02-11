import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const channelsFile = resolveProjectPath(projectRoot, 'src/shared/constants/channels.ts');
  const channelsExist = fileExists(channelsFile);

  let definedChannels: Set<string> | null = null;

  if (channelsExist) {
    const content = readFileContent(channelsFile);
    if (content) {
      definedChannels = new Set<string>();
      // Extract all string literals that look like IPC channels (contain a colon)
      const regex = /'[^']*:[^']*'|"[^"]*:[^"]*"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        // Strip quotes
        const channel = match[0].slice(1, -1);
        definedChannels.add(channel);
      }
    }
  }

  for (const channel of registry.ipcChannels) {
    if (!isPhaseIncluded(channel.phase, activePhase)) continue;

    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (!definedChannels) {
      status = 'skip';
      actual = 'channels.ts not found';
    } else if (definedChannels.has(channel.name)) {
      status = 'pass';
      actual = `channel '${channel.name}' defined`;
    } else {
      status = 'fail';
      actual = `channel '${channel.name}' not found in channels.ts`;
    }

    results.push({
      id: `A2.ipc.${channel.name}`,
      dimension: 'A',
      description: `IPC channel constant defined: ${channel.name}`,
      status,
      expected: `channel '${channel.name}' should be defined in channels.ts`,
      actual,
      sourceRef: channel.sourceLocation,
    });
  }

  return results;
}

registerVerifier({
  id: 'A2',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: 'IPC通道常量',
  fn: verify,
});
