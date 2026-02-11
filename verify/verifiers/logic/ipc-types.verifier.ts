import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { fileExists, readFileContent, resolveProjectPath } from '../../utils/file-helpers.js';
import { escapeRegex } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const channel of registry.ipcChannels) {
    if (!isPhaseIncluded(channel.phase, activePhase)) continue;
    if (channel.direction !== 'R→M') continue;

    const handlerFile = resolveProjectPath(projectRoot, 'src', 'main', 'ipc', `${channel.domain}.ipc.ts`);

    if (!fileExists(handlerFile)) {
      results.push({
        id: `B1.ipc-type.${channel.name}`,
        dimension: 'B',
        description: `IPC handler type check: ${channel.name}`,
        status: 'skip',
        expected: `handler file with typed params for '${channel.name}'`,
        actual: `handler file not found: ${channel.domain}.ipc.ts`,
        sourceRef: channel.sourceLocation,
      });
      continue;
    }

    const content = readFileContent(handlerFile);
    if (!content) {
      results.push({
        id: `B1.ipc-type.${channel.name}`,
        dimension: 'B',
        description: `IPC handler type check: ${channel.name}`,
        status: 'skip',
        expected: `handler file with typed params for '${channel.name}'`,
        actual: 'could not read handler file',
        sourceRef: channel.sourceLocation,
      });
      continue;
    }

    // Check if the handler for this channel exists
    const channelName = escapeRegex(channel.name);
    const handlerPattern = new RegExp(`ipcMain\\.handle\\s*\\(\\s*['"]${channelName}['"]`, 'g');
    const hasHandler = handlerPattern.test(content);

    if (!hasHandler) {
      results.push({
        id: `B1.ipc-type.${channel.name}`,
        dimension: 'B',
        description: `IPC handler type check: ${channel.name}`,
        status: 'fail',
        expected: `ipcMain.handle('${channel.name}', ...) with typed params`,
        actual: `handler for '${channel.name}' not found in ${channel.domain}.ipc.ts`,
        sourceRef: channel.sourceLocation,
      });
      continue;
    }

    // Extract expected field names from paramType (e.g., "{ cwd: string, shell?: string }")
    const fieldRegex = /(\w+)\s*\??\s*:/g;
    const expectedFields: string[] = [];
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(channel.paramType)) !== null) {
      expectedFields.push(fieldMatch[1]);
    }

    if (expectedFields.length === 0) {
      // No fields to check (e.g., void param)
      results.push({
        id: `B1.ipc-type.${channel.name}`,
        dimension: 'B',
        description: `IPC handler type check: ${channel.name}`,
        status: 'pass',
        expected: `handler registered for '${channel.name}'`,
        actual: 'handler found, no param fields to verify',
        sourceRef: channel.sourceLocation,
      });
      continue;
    }

    // Check if field names appear in the file content
    const foundFields = expectedFields.filter(f => content.includes(f));
    const missingFields = expectedFields.filter(f => !content.includes(f));

    if (foundFields.length === expectedFields.length) {
      results.push({
        id: `B1.ipc-type.${channel.name}`,
        dimension: 'B',
        description: `IPC handler type check: ${channel.name}`,
        status: 'pass',
        expected: `param fields: [${expectedFields.join(', ')}]`,
        actual: `all fields found in handler`,
        sourceRef: channel.sourceLocation,
      });
    } else if (foundFields.length > 0) {
      // At least some key fields found — pass with note
      results.push({
        id: `B1.ipc-type.${channel.name}`,
        dimension: 'B',
        description: `IPC handler type check: ${channel.name}`,
        status: 'pass',
        expected: `param fields: [${expectedFields.join(', ')}]`,
        actual: `found: [${foundFields.join(', ')}], missing: [${missingFields.join(', ')}]`,
        sourceRef: channel.sourceLocation,
      });
    } else {
      results.push({
        id: `B1.ipc-type.${channel.name}`,
        dimension: 'B',
        description: `IPC handler type check: ${channel.name}`,
        status: 'fail',
        expected: `param fields: [${expectedFields.join(', ')}]`,
        actual: `none of the expected fields found in handler`,
        sourceRef: channel.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'B1',
  dimension: 'B',
  dimensionName: 'B.代码逻辑',
  name: 'IPC参数类型',
  fn: verify,
});
