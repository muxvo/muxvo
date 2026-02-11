// ipc-channels.parser.ts — 从 DEV-PLAN.md §2 提取 IPC 通信协议
import { parseMarkdown, extractTablesUnderHeading, cleanBackticks, getNodeLineNumber } from './markdown-parser.js';
import type { IPCChannelSpec, SourceLocation } from '../registry.js';

/**
 * 从 DEV-PLAN.md 提取 IPC Channel 定义
 *
 * DEV-PLAN.md §2 格式:
 * ### 2.1 终端管理域 (terminal:*)
 * | Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
 *
 * ### 2.7 AI 评分域 (score:*) — V2-P1
 */
export function extractIPCChannels(devPlanContent: string): IPCChannelSpec[] {
  const root = parseMarkdown(devPlanContent);
  const specs: IPCChannelSpec[] = [];

  // 匹配 ### 2.x 开头的标题（IPC 域定义），排除 2.11 命名规范 和 2.12 错误格式
  const sections = extractTablesUnderHeading(root, /^2\.\d+\s+/, 3);

  for (const section of sections) {
    const heading = section.heading;

    // 从标题的括号中提取 domain: "terminal:*" → "terminal"
    const domainMatch = heading.match(/\((\w+):\*\)/);
    if (!domainMatch) continue; // 跳过不含域定义的节（如 2.11 IPC 命名规范）
    const domain = domainMatch[1];

    // 从标题或上下文判断 phase
    const phaseMatch = heading.match(/—\s*(V\d+-?P?\d*)/);
    const sectionPhase = phaseMatch ? phaseMatch[1] : 'V1';

    for (const row of section.rows) {
      const [channelRaw, direction, paramType, returnType, description] = row.cells;
      if (!channelRaw) continue;

      const channelName = cleanBackticks(channelRaw).trim();
      if (!channelName.includes(':')) continue; // 安全检查

      specs.push({
        name: channelName,
        domain,
        direction: direction?.trim() ?? '',
        paramType: cleanBackticks(paramType?.trim() ?? ''),
        returnType: cleanBackticks(returnType?.trim() ?? ''),
        description: description?.trim() ?? '',
        phase: sectionPhase,
        sourceLocation: {
          file: 'DEV-PLAN.md',
          line: row._line,
        },
      });
    }
  }

  return specs;
}
