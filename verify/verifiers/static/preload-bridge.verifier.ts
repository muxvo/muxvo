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

  for (const channel of registry.ipcChannels) {
    if (!isPhaseIncluded(channel.phase, activePhase)) continue;

    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (!content) {
      status = 'skip';
      actual = 'preload/index.ts 文件不存在';
    } else if (channel.direction === 'M→R') {
      // M→R channels use ipcRenderer.on in preload, search for on('channel-name'
      const channelEscaped = escapeRegex(channel.name);
      const onPattern = new RegExp(`on\\s*\\(\\s*['"]${channelEscaped}['"]`);
      const found = onPattern.test(content);
      status = found ? 'pass' : 'fail';
      actual = found ? 'preload 已暴露 on 监听' : `未找到 on('${channel.name}') 暴露`;
    } else {
      // R→M channels use ipcRenderer.invoke/send in preload
      const channelEscaped = escapeRegex(channel.name);
      const invokePattern = new RegExp(`(invoke|send)\\s*\\(\\s*['"]${channelEscaped}['"]`);
      const found = invokePattern.test(content);
      status = found ? 'pass' : 'fail';
      actual = found ? 'preload 已暴露 invoke/send' : `未找到 invoke/send('${channel.name}') 暴露`;
    }

    results.push({
      id: `A4.preload.${channel.name}`,
      dimension: 'A',
      description: `Preload Bridge 暴露: ${channel.name}`,
      status,
      expected: `contextBridge 中暴露 '${channel.name}'`,
      actual,
      sourceRef: channel.sourceLocation,
    });
  }

  return results;
}

registerVerifier({
  id: 'A4',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: 'Preload Bridge',
  fn: verify,
});
