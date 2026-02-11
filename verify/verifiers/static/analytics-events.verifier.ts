import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles } from '../../utils/file-helpers.js';
import { contentContains } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Search for files containing analytics or events, plus constants directory
  const srcDir = resolveProjectPath(projectRoot, 'src');
  const analyticsFiles = await globFiles('**/*analytics*.ts', srcDir);
  const eventFiles = await globFiles('**/*event*.ts', srcDir);
  const constantFiles = await globFiles('**/constants/**/*.ts', srcDir);

  const allFiles = [...new Set([...analyticsFiles, ...eventFiles, ...constantFiles])];

  // Read all file contents into a combined string for searching
  const allContents: string[] = [];
  for (const file of allFiles) {
    const content = readFileContent(file);
    if (content) allContents.push(content);
  }
  const combinedContent = allContents.join('\n');

  for (const event of registry.analyticsEvents) {
    if (!isPhaseIncluded(event.phase, activePhase)) continue;

    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (allFiles.length === 0) {
      status = 'skip';
      actual = '未找到 analytics/events 相关文件';
    } else {
      const found = contentContains(combinedContent, `'${event.name}'`) ||
                     contentContains(combinedContent, `"${event.name}"`);
      status = found ? 'pass' : 'fail';
      actual = found ? `事件 '${event.name}' 已定义` : `未找到事件定义: ${event.name}`;
    }

    results.push({
      id: `A9.event.${event.name}`,
      dimension: 'A',
      description: `Analytics 事件定义: ${event.name}`,
      status,
      expected: `事件 '${event.name}' 在代码中已定义`,
      actual,
      sourceRef: event.sourceLocation,
    });
  }

  return results;
}

registerVerifier({
  id: 'A9',
  dimension: 'A',
  dimensionName: 'A.静态结构',
  name: 'Analytics事件',
  fn: verify,
});
