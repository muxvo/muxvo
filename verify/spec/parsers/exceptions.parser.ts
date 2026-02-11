// exceptions.parser.ts — 从 PRD.md §11.1 提取异常场景
import { parseMarkdown, extractTablesUnderHeading } from './markdown-parser.js';
import type { ExceptionSpec } from '../registry.js';

/**
 * 从 PRD.md §11.1 提取异常处理规范
 *
 * 格式:
 * ### 11.1 异常处理【AI 补充】
 * | 场景 | 处理方式 | 提示文案 |
 * | 前台进程崩溃 | 标签状态变红，提供重启按钮 | "进程已断开..." |
 */
export function extractExceptions(prdContent: string): ExceptionSpec[] {
  const root = parseMarkdown(prdContent);
  const specs: ExceptionSpec[] = [];

  // 找到 ### 11.1 异常处理 标题
  const sections = extractTablesUnderHeading(root, /^11\.1/, 3);

  let id = 1;
  for (const section of sections) {
    for (const row of section.rows) {
      const [scenario, handling, copyText] = row.cells;
      if (!scenario) continue;

      // 推断责任模块
      const responsibleTask = inferResponsibleTask(scenario);

      specs.push({
        id: id++,
        scenario: scenario.trim(),
        handling: handling?.trim() ?? '',
        copyText: (copyText ?? '').replace(/^[""]|[""]$/g, '').trim(),
        responsibleTask,
        sourceLocation: {
          file: 'PRD.md',
          line: row._line,
        },
      });
    }
  }

  return specs;
}

/** 根据场景推断责任模块/任务 */
function inferResponsibleTask(scenario: string): string {
  if (scenario.includes('终端') || scenario.includes('进程') || scenario.includes('PTY')) return 'terminal';
  if (scenario.includes('文件') || scenario.includes('磁盘') || scenario.includes('权限')) return 'fs';
  if (scenario.includes('JSONL') || scenario.includes('聊天') || scenario.includes('历史') || scenario.includes('同步')) return 'chat';
  if (scenario.includes('目录不存在') || scenario.includes('CC')) return 'config';
  if (scenario.includes('网络') || scenario.includes('下载') || scenario.includes('聚合')) return 'marketplace';
  if (scenario.includes('安装') || scenario.includes('包') || scenario.includes('校验')) return 'marketplace';
  if (scenario.includes('登录') || scenario.includes('OAuth') || scenario.includes('认证') || scenario.includes('授权')) return 'auth';
  if (scenario.includes('评分') || scenario.includes('Skill') && scenario.includes('运行')) return 'score';
  if (scenario.includes('展示页') || scenario.includes('发布') || scenario.includes('Showcase') || scenario.includes('GitHub Pages')) return 'showcase';
  if (scenario.includes('Deep Link')) return 'deeplink';
  if (scenario.includes('分享')) return 'showcase';
  if (scenario.includes('SKILL.md')) return 'showcase';
  if (scenario.includes('冲突') || scenario.includes('版本')) return 'marketplace';
  if (scenario.includes('数据格式')) return 'config';
  return 'general';
}
