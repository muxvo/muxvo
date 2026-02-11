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
      // Extract all string literals that look like IPC channel names (contain ':')
      const matches = content.match(/'[^']*:[^']*'|"[^"]*:[^"]*"/g);
      if (matches) {
        for (const m of matches) {
          definedChannels.add(m.slice(1, -1)); // remove quotes
        }
      }
    }
  }

  for (const channel of registry.ipcChannels) {
    if (!isPhaseIncluded(channel.phase, activePhase)) continue;

    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (!definedChannels) {
      status = 'skip';
      actual = 'channels.ts 文件不存在';
    } else if (definedChannels.has(channel.name)) {
      status = 'pass';
      actual = `已定义: ${channel.name}`;
    } else {
      status = 'fail';
      actual = `未找到 channel 定义: ${channel.name}`;
    }

    results.push({
      id: `A2.ipc.${channel.name}`,
      dimension: 'A',
      description: `IPC Channel 常量定义: ${channel.name}`,
      status,
      expected: `channels.ts 中包含 '${channel.name}'`,
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
  name: 'IPC通道定义',
  fn: verify,
});
