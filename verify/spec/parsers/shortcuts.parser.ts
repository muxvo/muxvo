// shortcuts.parser.ts — 从 DEV-PLAN.md §3 提取快捷键映射表
import { parseMarkdown, extractTablesUnderHeading, cleanBackticks } from './markdown-parser.js';
import type { ShortcutSpec } from '../registry.js';

/**
 * 从 DEV-PLAN.md §3 提取快捷键映射表
 *
 * 格式:
 * **快捷键映射表（来源 PRD §10）：**
 * | 功能 | macOS | Windows/Linux |
 * |------|-------|---------------|
 * | 新建终端 | `⌘T` | `Ctrl+T` |
 */
export function extractShortcuts(devPlanContent: string): ShortcutSpec[] {
  const root = parseMarkdown(devPlanContent);
  const specs: ShortcutSpec[] = [];

  // 快捷键表格在 ## 3 下面，但不是以 ### 标题引导的
  // 它在 "## 3. 前端框架与状态管理" 节内
  // 需要找到包含"快捷键"的表格
  // 尝试从 ## 3 级别获取所有表格
  const sections = extractTablesUnderHeading(root, /^3\.\s*前端框架/, 2);

  if (sections.length > 0) {
    for (const section of sections) {
      for (const row of section.rows) {
        const [action, macOS, windowsLinux] = row.cells;
        if (!action) continue;

        specs.push({
          action: action.trim(),
          macOS: cleanBackticks(macOS?.trim() ?? ''),
          windowsLinux: cleanBackticks(windowsLinux?.trim() ?? ''),
          scope: inferScope(action),
          sourceLocation: {
            file: 'DEV-PLAN.md',
            line: row._line,
          },
        });
      }
    }
  }

  // 如果 §3 下没找到，尝试其他策略：直接搜索包含 "功能 | macOS" 的表格
  if (specs.length === 0) {
    // 遍历所有子节点找到快捷键表格
    for (let i = 0; i < root.children.length; i++) {
      const node = root.children[i];
      if (node.type === 'table') {
        const table = node;
        const headerRow = table.children[0];
        if (!headerRow) continue;

        const headerCells = headerRow.children.map(cell =>
          cell.children.map((c: any) => ('value' in c ? c.value : '')).join(''),
        );

        // 检查是否是快捷键表
        if (headerCells.some(h => h.includes('macOS')) && headerCells.some(h => h.includes('功能'))) {
          for (let r = 1; r < table.children.length; r++) {
            const row = table.children[r];
            const cells = row.children.map(cell =>
              cell.children.map((c: any) => ('value' in c ? c.value : '')).join('').trim(),
            );

            const [action, macOS, windowsLinux] = cells;
            if (!action) continue;

            specs.push({
              action: action.trim(),
              macOS: cleanBackticks(macOS?.trim() ?? ''),
              windowsLinux: cleanBackticks(windowsLinux?.trim() ?? ''),
              scope: inferScope(action),
              sourceLocation: {
                file: 'DEV-PLAN.md',
                line: row.position?.start?.line ?? 0,
              },
            });
          }
        }
      }
    }
  }

  return specs;
}

/** 根据快捷键功能推断作用域 */
function inferScope(action: string): string {
  if (action.includes('终端')) return 'terminal';
  if (action.includes('面板') || action.includes('文件')) return 'panel';
  if (action.includes('Skill') || action.includes('浏览器')) return 'skill-browser';
  if (action.includes('Markdown') || action.includes('预览')) return 'editor';
  if (action.includes('保存')) return 'editor';
  if (action.includes('搜索')) return 'global';
  if (action.includes('Esc') || action.includes('返回')) return 'global';
  return 'global';
}
