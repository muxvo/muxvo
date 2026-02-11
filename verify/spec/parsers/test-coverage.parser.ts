// test-coverage.parser.ts — 从 DEV-PLAN.md §12 提取测试覆盖要求
import { parseMarkdown, extractTablesUnderHeading } from './markdown-parser.js';
import type { TestCoverageSpec, UnitTestSpec, IntegrationTestSpec, E2ETestSpec } from '../registry.js';

/**
 * 从 DEV-PLAN.md §12 提取测试策略
 *
 * 格式:
 * ### 12.1 单元测试（Vitest）
 * | 模块 | 测试重点 | 预估用例数 |
 * | JSONL 解析器 | 正常解析、格式错误跳过 | ~15 |
 *
 * ### 12.2 集成测试
 * | 场景 | 测试内容 |
 *
 * ### 12.3 E2E 测试（Playwright）
 * | 流程 | 步骤 |
 *
 * ### 12.4 V2 测试策略 (contains sub-tables for V2)
 */
export function extractTestCoverage(devPlanContent: string): TestCoverageSpec {
  const root = parseMarkdown(devPlanContent);
  const result: TestCoverageSpec = {
    unit: [],
    integration: [],
    e2e: [],
  };

  // 12.1 V1 单元测试
  const unitSections = extractTablesUnderHeading(root, /^12\.1/, 3);
  for (const section of unitSections) {
    for (const row of section.rows) {
      const [module_, description, countRaw] = row.cells;
      if (!module_) continue;

      const countMatch = (countRaw ?? '').match(/~?(\d+)/);
      const expectedCount = countMatch ? parseInt(countMatch[1], 10) : 0;

      result.unit.push({
        module: module_.trim(),
        description: description?.trim() ?? '',
        expectedCount,
      });
    }
  }

  // 12.2 V1 集成测试
  const integrationSections = extractTablesUnderHeading(root, /^12\.2/, 3);
  for (const section of integrationSections) {
    for (const row of section.rows) {
      const [scenario, description] = row.cells;
      if (!scenario) continue;

      result.integration.push({
        scenario: scenario.trim(),
        description: description?.trim() ?? '',
      });
    }
  }

  // 12.3 V1 E2E 测试
  const e2eSections = extractTablesUnderHeading(root, /^12\.3/, 3);
  for (const section of e2eSections) {
    for (const row of section.rows) {
      const [flow, description] = row.cells;
      if (!flow) continue;

      result.e2e.push({
        flow: flow.trim(),
        description: description?.trim() ?? '',
      });
    }
  }

  // 12.4 V2 测试策略 — 可能包含子标题下的表格
  // V2 单元测试
  const v2Sections = extractTablesUnderHeading(root, /^12\.4/, 3);
  // 12.4 下可能有多个表格，按顺序对应：单元测试、集成测试、E2E
  // 但由于它们在 #### 标题下，我们也用 #### 标题来匹配

  // V2 单元测试 (####)
  const v2UnitSections = extractTablesUnderHeading(root, /单元测试[（(]新增/, 4);
  for (const section of v2UnitSections) {
    for (const row of section.rows) {
      const [module_, description, countRaw] = row.cells;
      if (!module_) continue;

      const countMatch = (countRaw ?? '').match(/~?(\d+)/);
      const expectedCount = countMatch ? parseInt(countMatch[1], 10) : 0;

      result.unit.push({
        module: `[V2] ${module_.trim()}`,
        description: description?.trim() ?? '',
        expectedCount,
      });
    }
  }

  // V2 集成测试 (####)
  const v2IntegrationSections = extractTablesUnderHeading(root, /集成测试[（(]新增/, 4);
  for (const section of v2IntegrationSections) {
    for (const row of section.rows) {
      const [scenario, description] = row.cells;
      if (!scenario) continue;

      result.integration.push({
        scenario: `[V2] ${scenario.trim()}`,
        description: description?.trim() ?? '',
      });
    }
  }

  // V2 E2E 测试 (####)
  const v2E2ESections = extractTablesUnderHeading(root, /E2E 测试[（(]新增/, 4);
  for (const section of v2E2ESections) {
    for (const row of section.rows) {
      const [flow, description] = row.cells;
      if (!flow) continue;

      result.e2e.push({
        flow: `[V2] ${flow.trim()}`,
        description: description?.trim() ?? '',
      });
    }
  }

  return result;
}
