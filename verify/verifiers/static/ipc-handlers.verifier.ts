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

      // M→R direction means main pushes to renderer, no handler needed
      if (channel.direction === 'M→R') {
        status = 'pass';
        actual = '推送通道，无需 handler 注册';
      } else if (!content) {
        status = 'skip';
        actual = `handler 文件不存在: src/main/ipc/${domain}.ipc.ts`;
      } else {
        // Search for ipcMain.handle('channel-name' or ipcMain.on('channel-name'
        const channelEscaped = escapeRegex(channel.name);
        const handlePattern = new RegExp(
          `ipcMain\\.(handle|on)\\s*\\(\\s*['"]${channelEscaped}['"]`,
        );
        // Also search for constant reference patterns like CHANNELS.TERMINAL.CREATE
        const parts = channel.name.split(':');
        const constRef = parts.length === 2
          ? `CHANNELS.${parts[0].toUpperCase()}.${parts[1].toUpperCase().replace(/-/g, '_')}`
          : null;
        const constPattern = constRef
          ? new RegExp(`ipcMain\\.(handle|on)\\s*\\(\\s*${escapeRegex(constRef)}`)
          : null;

        const hasDirectMatch = handlePattern.test(content);
        const hasConstMatch = constPattern ? constPattern.test(content) : false;

        if (hasDirectMatch || hasConstMatch) {
          status = 'pass';
          actual = 'handler 已注册';
        } else {
          status = 'fail';
          actual = `未找到 ipcMain.handle/on 注册: ${channel.name}`;
        }
      }

      results.push({
        id: `A3.handler.${channel.name}`,
        dimension: 'A',
        description: `IPC Handler 注册: ${channel.name}`,
        status,
        expected: `ipcMain.handle/on('${channel.name}') 已注册`,
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
  name: 'IPC Handler注册',
  fn: verify,
});
