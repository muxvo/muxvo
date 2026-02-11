import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { isPhaseIncluded } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles } from '../../utils/file-helpers.js';
import { escapeRegex } from '../../utils/pattern-matchers.js';

async function verify(registry: SpecRegistry, projectRoot: string, activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Collect all relevant source files
  const srcDir = resolveProjectPath(projectRoot, 'src');

  const analyticsFiles = await globFiles('**/*analytics*.ts', srcDir);
  const eventsFiles = await globFiles('**/*events*.ts', srcDir);
  const constantsFiles = await globFiles('**/shared/constants/**/*.ts', srcDir);

  const allFiles = new Set([...analyticsFiles, ...eventsFiles, ...constantsFiles]);

  // Read all file contents into a single combined string for searching
  let combinedContent = '';
  for (const filePath of allFiles) {
    const content = readFileContent(filePath);
    if (content) {
      combinedContent += content + '\n';
    }
  }

  for (const event of registry.analyticsEvents) {
    if (!isPhaseIncluded(event.phase, activePhase)) continue;

    let status: 'pass' | 'fail' | 'skip';
    let actual: string;

    if (!combinedContent) {
      status = 'skip';
      actual = 'no analytics/events files found';
    } else {
      const escaped = escapeRegex(event.name);
      const pattern = new RegExp(`['"\`]${escaped}['"\`]`);
      const found = pattern.test(combinedContent);

      status = found ? 'pass' : 'fail';
      actual = found
        ? `event '${event.name}' found in source`
        : `event '${event.name}' not found in analytics/events files`;
    }

    results.push({
      id: `A9.event.${event.name}`,
      dimension: 'A',
      description: `Analytics event defined: ${event.name}`,
      status,
      expected: `event '${event.name}' should be defined`,
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
  name: '埋点事件',
  fn: verify,
});
