import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';
import { escapeRegex } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Group channels by domain
  const domainChannels = new Map<string, typeof registry.ipcChannels>();
  for (const channel of registry.ipcChannels) {
    if (!isPhaseIncluded(channel.phase, activePhase)) continue;
    const list = domainChannels.get(channel.domain) || [];
    list.push(channel);
    domainChannels.set(channel.domain, list);
  }

  for (const [domain, channels] of domainChannels) {
    const handlerFile = resolveProjectPath(projectRoot, `src/main/ipc/${domain}.ipc.ts`);
    const exists = fileExists(handlerFile);
    const content = exists ? readFileContent(handlerFile) : null;

    for (const channel of channels) {
      let status: 'pass' | 'fail' | 'skip';
      let actual: string;

      // M→R channels are push from main, no handler registration needed
      if (channel.direction === 'M→R') {
        status = 'pass';
        actual = 'push channel (M→R), no handler needed';
      } else if (!content) {
        status = 'skip';
        actual = `handler file ${domain}.ipc.ts not found`;
      } else {
        // Search for handler registration patterns
        const escaped = escapeRegex(channel.name);
        const handlePattern = new RegExp(`ipcMain\\.(handle|on)\\s*\\(\\s*['"\`]${escaped}['"\`]`);
        // Also search for constant reference patterns like CHANNELS.TERMINAL.CREATE
        const parts = channel.name.split(':');
        const constPattern = parts.length >= 2
          ? new RegExp(`CHANNELS\\.${escapeRegex(parts[0].toUpperCase())}\\.${escapeRegex(parts[1].toUpperCase().replace(/-/g, '_'))}`)
          : null;

        const directMatch = handlePattern.test(content);
        const constMatch = constPattern ? constPattern.test(content) : false;

        if (directMatch || constMatch) {
          status = 'pass';
          actual = 'handler registration found';
        } else {
          status = 'fail';
          actual = `no handler found for '${channel.name}' in ${domain}.ipc.ts`;
        }
      }

      results.push({
        id: `A3.handler.${channel.name}`,
        dimension: 'A',
        description: `IPC handler registered: ${channel.name}`,
        status,
        expected: `handler for '${channel.name}' should be registered`,
        actual,
        sourceRef: channel.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'A3',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: 'IPC处理器',
  fn: verify,
});
