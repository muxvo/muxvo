// error-codes.parser.ts — 从 DEV-PLAN.md §2.12 提取错误码
import { parseMarkdown, extractSectionsAtLevel } from './markdown-parser.js';
import type { ErrorCodeSpec } from '../registry.js';

/**
 * 从 DEV-PLAN.md §2.12 提取统一 IPC 错误码
 *
 * 格式:
 * ### 2.12 统一 IPC 错误响应格式
 * ```typescript
 * interface IPCError { code: string; message: string; details?: any; }
 * ```
 * 通用错误码示例：
 * - `terminal.spawn_failed` — PTY 创建失败
 * - `marketplace.download_failed` — 包下载失败
 */
export function extractErrorCodes(devPlanContent: string): ErrorCodeSpec[] {
  const root = parseMarkdown(devPlanContent);
  const specs: ErrorCodeSpec[] = [];

  // 找到 ### 2.12 标题
  const sections = extractSectionsAtLevel(root, /^2\.12/, 3);

  if (sections.length === 0) {
    // 备用策略：逐行扫描
    return extractFromLines(devPlanContent);
  }

  for (const section of sections) {
    // 遍历子节点，找 list 类型
    for (const child of section.children) {
      if (child.type === 'list') {
        for (const item of (child as any).children) {
          const text = extractListItemText(item);
          const line = item.position?.start?.line ?? 0;

          // 匹配 `domain.error_type` — 描述
          const match = text.match(/`(\w+\.\w+)`\s*[—–-]\s*(.+)/);
          if (match) {
            const code = match[1];
            const description = match[2].trim();
            const domain = code.split('.')[0];

            specs.push({
              code,
              domain,
              description,
              sourceLocation: {
                file: 'DEV-PLAN.md',
                line,
              },
            });
          }
        }
      }
    }
  }

  return specs;
}

/** 递归从 AST 节点提取文本（inlineCode 用反引号包裹） */
function extractListItemText(node: any): string {
  if (!node) return '';
  if (node.type === 'inlineCode') return '`' + node.value + '`';
  if (node.type === 'text') return node.value;
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map((c: any) => extractListItemText(c)).join('');
  }
  return '';
}

/** 备用：从原始文本行提取错误码 */
function extractFromLines(content: string): ErrorCodeSpec[] {
  const specs: ErrorCodeSpec[] = [];
  const lines = content.split('\n');
  let inErrorSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('2.12') && line.includes('错误')) {
      inErrorSection = true;
      continue;
    }
    if (inErrorSection && /^#{2,3}\s/.test(line) && !line.includes('2.12')) {
      inErrorSection = false;
      continue;
    }

    if (inErrorSection) {
      const match = line.match(/[-*]\s*`(\w+\.\w+)`\s*[—–-]\s*(.+)/);
      if (match) {
        const code = match[1];
        specs.push({
          code,
          domain: code.split('.')[0],
          description: match[2].trim(),
          sourceLocation: {
            file: 'DEV-PLAN.md',
            line: i + 1,
          },
        });
      }
    }
  }

  return specs;
}
