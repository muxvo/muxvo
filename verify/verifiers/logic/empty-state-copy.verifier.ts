import { registerVerifier } from '../runner.js';
import type { SpecRegistry, CheckResult } from '../../spec/registry.js';
import { readFileContent, resolveProjectPath, globFiles, dirExists } from '../../utils/file-helpers.js';
import { contentContains } from '../../utils/pattern-matchers.js';

const areaToDir: Record<string, string> = {
  '终端区域': 'terminal',
  '聊天历史': 'chat-history',
  '文件浏览': 'file-browser',
  '配置管理': 'config-manager',
  'Skill 浏览器': 'skill-browser',
  'Skill浏览器': 'skill-browser',
  'Showcase 展示页': 'showcase',
  'Showcase': 'showcase',
};

async function verify(registry: SpecRegistry, projectRoot: string, _activePhase: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const emptyState of registry.emptyStates) {
    const dir = areaToDir[emptyState.area];
    const idSuffix = `${emptyState.area}.${emptyState.scenario.substring(0, 20)}`;

    if (!dir) {
      results.push({
        id: `B4.empty.${idSuffix}`,
        dimension: 'B',
        description: `Empty state copy: ${emptyState.area} - ${emptyState.scenario}`,
        status: 'skip',
        expected: `empty state copy text for '${emptyState.area}'`,
        actual: `no directory mapping for area '${emptyState.area}'`,
        sourceRef: emptyState.sourceLocation,
      });
      continue;
    }

    const componentDir = resolveProjectPath(projectRoot, 'src', 'renderer', 'components', dir);

    if (!dirExists(componentDir)) {
      results.push({
        id: `B4.empty.${idSuffix}`,
        dimension: 'B',
        description: `Empty state copy: ${emptyState.area} - ${emptyState.scenario}`,
        status: 'skip',
        expected: `empty state copy text in components/${dir}/`,
        actual: `directory components/${dir}/ not found`,
        sourceRef: emptyState.sourceLocation,
      });
      continue;
    }

    // Glob all .tsx files in the component directory
    const tsxFiles = await globFiles(`src/renderer/components/${dir}/**/*.tsx`, projectRoot);

    if (tsxFiles.length === 0) {
      results.push({
        id: `B4.empty.${idSuffix}`,
        dimension: 'B',
        description: `Empty state copy: ${emptyState.area} - ${emptyState.scenario}`,
        status: 'skip',
        expected: `empty state copy text in components/${dir}/`,
        actual: 'no .tsx files found in component directory',
        sourceRef: emptyState.sourceLocation,
      });
      continue;
    }

    // Clean copy text for searching: take first 25 chars, remove special symbols
    const searchText = emptyState.copyText
      .substring(0, 25)
      .replace(/[^\u4e00-\u9fff\w\s]/g, '')
      .trim();

    if (searchText.length === 0) {
      results.push({
        id: `B4.empty.${idSuffix}`,
        dimension: 'B',
        description: `Empty state copy: ${emptyState.area} - ${emptyState.scenario}`,
        status: 'skip',
        expected: `empty state copy text in components/${dir}/`,
        actual: 'copy text is empty after cleaning',
        sourceRef: emptyState.sourceLocation,
      });
      continue;
    }

    let found = false;
    let matchedFile = '';

    for (const filePath of tsxFiles) {
      const content = readFileContent(filePath);
      if (!content) continue;

      if (contentContains(content, searchText)) {
        found = true;
        matchedFile = filePath.replace(projectRoot + '/', '');
        break;
      }
    }

    if (found) {
      results.push({
        id: `B4.empty.${idSuffix}`,
        dimension: 'B',
        description: `Empty state copy: ${emptyState.area} - ${emptyState.scenario}`,
        status: 'pass',
        expected: `copy text '${searchText}...' in components/${dir}/`,
        actual: `found in ${matchedFile}`,
        sourceRef: emptyState.sourceLocation,
      });
    } else {
      results.push({
        id: `B4.empty.${idSuffix}`,
        dimension: 'B',
        description: `Empty state copy: ${emptyState.area} - ${emptyState.scenario}`,
        status: 'fail',
        expected: `copy text '${searchText}...' in components/${dir}/`,
        actual: `not found in any .tsx file under components/${dir}/`,
        sourceRef: emptyState.sourceLocation,
      });
    }
  }

  return results;
}

registerVerifier({
  id: 'B4',
  dimension: 'B',
  dimensionName: 'B.代码逻辑',
  name: '缺省态文案',
  fn: verify,
});
