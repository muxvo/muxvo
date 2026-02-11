// empty-states.parser.ts — 从 PRD.md §11.3 提取缺省态规范
import { parseMarkdown, extractAllTablesInSection } from './markdown-parser.js';
import type { EmptyStateSpec } from '../registry.js';

/**
 * 从 PRD.md §11.3 提取缺省态规范
 *
 * 格式:
 * ### 11.3 缺省态规范
 * | 场景 | 文案 | 图标/插图 | 操作按钮 |
 * | **终端区域** | | | |
 * | 无打开的终端 | "按 ⌘T 新建终端" | 终端图标 | [新建终端] |
 *
 * 以及后面的 Showcase 展示页缺省态表格：
 * | 场景 | 缺省态展示 |
 */
export function extractEmptyStates(prdContent: string): EmptyStateSpec[] {
  const root = parseMarkdown(prdContent);
  const specs: EmptyStateSpec[] = [];

  // 找到 ### 11.3 下所有表格
  const sections = extractAllTablesInSection(root, /^11\.3/, 3);

  let currentArea = '';

  for (const section of sections) {
    for (const tableInfo of section.tables) {
      const headerCellCount = tableInfo.rows.length > 0 ? tableInfo.rows[0].cells.length : 0;

      for (const row of tableInfo.rows) {
        const cells = row.cells;

        // 4 列表格: | 场景 | 文案 | 图标/插图 | 操作按钮 |
        if (cells.length >= 4) {
          const [scenario, copyText, icon, actionButton] = cells;
          const cleanScenario = scenario.replace(/\*\*/g, '').trim();

          // 检测区域标题行（粗体标记的分类行，无文案）
          if (scenario.includes('**') && !copyText.trim()) {
            currentArea = cleanScenario;
            continue;
          }

          if (!cleanScenario || !copyText.trim()) continue;

          specs.push({
            area: currentArea,
            scenario: cleanScenario,
            copyText: copyText.replace(/^[""]|[""]$/g, '').trim(),
            icon: icon?.trim() ?? '',
            actionButton: actionButton?.trim() ?? '',
            sourceLocation: {
              file: 'PRD.md',
              line: row._line,
            },
          });
        }
        // 2 列表格: | 场景 | 缺省态展示 | (Showcase 部分)
        else if (cells.length >= 2) {
          const [scenario, display] = cells;
          const cleanScenario = scenario.trim();
          if (!cleanScenario || !display.trim()) continue;

          specs.push({
            area: 'Showcase',
            scenario: cleanScenario,
            copyText: extractCopyTextFromDisplay(display),
            icon: '',
            actionButton: extractActionButtons(display),
            sourceLocation: {
              file: 'PRD.md',
              line: row._line,
            },
          });
        }
      }
    }
  }

  return specs;
}

/** 从缺省态展示描述中提取文案 */
function extractCopyTextFromDisplay(display: string): string {
  // 提取引号中的文字
  const quoteMatch = display.match(/[""](.+?)[""]/);
  if (quoteMatch) return quoteMatch[1];

  // 提取 [按钮] 前的文本
  const beforeButton = display.replace(/\[.+?\]/g, '').trim();
  return beforeButton;
}

/** 从缺省态展示描述中提取操作按钮 */
function extractActionButtons(display: string): string {
  const buttons: string[] = [];
  const buttonRegex = /\[(.+?)\]/g;
  let match: RegExpExecArray | null;
  while ((match = buttonRegex.exec(display)) !== null) {
    buttons.push(`[${match[1]}]`);
  }
  return buttons.join(' ');
}
