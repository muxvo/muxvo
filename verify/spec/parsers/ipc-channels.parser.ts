// ipc-channels.parser.ts — 从 DEV-PLAN.md §2 提取 IPC Channel 定义
import type { IPCChannelSpec, SourceLocation } from '../registry.js';
import {
  parseMarkdown,
  extractTablesUnderHeading,
  cleanBackticks,
  getNodeLineNumber,
} from './markdown-parser.js';

/**
 * 从 DEV-PLAN.md 的 `## 2. IPC 通信协议` 部分提取所有 IPC Channel。
 *
 * 每个 ### 2.x 子标题格式:
 *   ### 2.1 终端管理域 (terminal:*)
 *   ### 2.7 AI 评分域 (score:*) — V2-P1
 *
 * 表格列: | Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
 */
export function extractIPCChannels(devPlanContent: string): IPCChannelSpec[] {
  const root = parseMarkdown(devPlanContent);
  const results: IPCChannelSpec[] = [];

  // 匹配 ### 2.x 格式的标题（排除 2.11/2.12 等非 channel 定义节）
  const sections = extractTablesUnderHeading(root, /^2\.\d+\s+.+域\s*\(/, 3);

  for (const section of sections) {
    // 从标题提取 domain: e.g. "(terminal:*)" → "terminal"
    const domainMatch = section.heading.match(/\(([^:]+):\*\)/);
    const domain = domainMatch ? domainMatch[1] : '';

    // 从标题提取 phase: e.g. "— V2-P1" → "V2-P1"
    const phaseMatch = section.heading.match(/—\s*(V\d+-?P?\d*)/);
    const phase = phaseMatch ? phaseMatch[1] : 'V1';

    for (const row of section.rows) {
      // 列: Channel | 方向 | 参数类型 | 返回值类型 | 说明
      if (row.cells.length < 5) continue;

      const name = cleanBackticks(row.cells[0]).trim();
      if (!name || name.startsWith('---')) continue;

      results.push({
        name,
        domain,
        direction: row.cells[1].trim(),
        paramType: cleanBackticks(row.cells[2]).trim(),
        returnType: cleanBackticks(row.cells[3]).trim(),
        description: row.cells[4].trim(),
        phase,
        sourceLocation: { file: 'DEV-PLAN.md', line: row._line },
      });
    }
  }

  return results;
}
