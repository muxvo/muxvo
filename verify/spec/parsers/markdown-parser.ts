// markdown-parser.ts — 基础 Markdown AST 解析工具
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Content, Heading, Table, TableRow, Code } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);

/** 解析 Markdown 为 mdast Root */
export function parseMarkdown(content: string): Root {
  return parser.parse(content) as Root;
}

/** 获取节点行号 */
export function getNodeLineNumber(node: { position?: { start?: { line?: number } } }): number {
  return node?.position?.start?.line ?? 0;
}

/** 移除反引号 */
export function cleanBackticks(text: string): string {
  return text.replace(/`/g, '');
}

/** 从 AST 节点中提取纯文本 */
function nodeToText(node: Content): string {
  if ('value' in node) return (node as any).value as string;
  if ('children' in node) {
    return ((node as any).children as Content[]).map(nodeToText).join('');
  }
  return '';
}

/** 从 heading 节点提取文本 */
function headingToText(heading: Heading): string {
  return heading.children.map(nodeToText).join('');
}

/** 将 table 转为 rows 格式 */
function tableToRows(table: Table): Array<{ cells: string[]; _line: number }> {
  // 跳过第一行（表头），从数据行开始
  return table.children.slice(1).map((row: TableRow) => ({
    cells: row.children.map(cell => cell.children.map(nodeToText).join('').trim()),
    _line: getNodeLineNumber(row),
  }));
}

/**
 * 提取某个 heading 下属的所有子节点（直到下一个同级或更高级 heading 为止）
 */
function collectSectionChildren(root: Root, headingIndex: number, headingLevel: number): Content[] {
  const children: Content[] = [];
  for (let i = headingIndex + 1; i < root.children.length; i++) {
    const node = root.children[i];
    if (node.type === 'heading' && (node as Heading).depth <= headingLevel) {
      break;
    }
    children.push(node);
  }
  return children;
}

/**
 * 找到匹配正则的标题，提取其下的第一个表格。
 * 返回 { heading, headingLine, rows }
 */
export function extractTablesUnderHeading(
  root: Root,
  headingRegex: RegExp,
  headingLevel: number,
): Array<{ heading: string; headingLine: number; rows: Array<{ cells: string[]; _line: number }> }> {
  const results: Array<{ heading: string; headingLine: number; rows: Array<{ cells: string[]; _line: number }> }> = [];

  for (let i = 0; i < root.children.length; i++) {
    const node = root.children[i];
    if (node.type !== 'heading' || (node as Heading).depth !== headingLevel) continue;
    const text = headingToText(node as Heading);
    if (!headingRegex.test(text)) continue;

    const sectionChildren = collectSectionChildren(root, i, headingLevel);
    const table = sectionChildren.find(n => n.type === 'table') as Table | undefined;
    if (table) {
      results.push({
        heading: text,
        headingLine: getNodeLineNumber(node),
        rows: tableToRows(table),
      });
    }
  }

  return results;
}

/**
 * 提取标题节内的所有表格
 */
export function extractAllTablesInSection(
  root: Root,
  headingRegex: RegExp,
  headingLevel: number,
): Array<{ heading: string; headingLine: number; tables: Array<{ rows: Array<{ cells: string[]; _line: number }>; _line: number }> }> {
  const results: Array<{ heading: string; headingLine: number; tables: Array<{ rows: Array<{ cells: string[]; _line: number }>; _line: number }> }> = [];

  for (let i = 0; i < root.children.length; i++) {
    const node = root.children[i];
    if (node.type !== 'heading' || (node as Heading).depth !== headingLevel) continue;
    const text = headingToText(node as Heading);
    if (!headingRegex.test(text)) continue;

    const sectionChildren = collectSectionChildren(root, i, headingLevel);
    const tables = sectionChildren
      .filter(n => n.type === 'table')
      .map(t => ({
        rows: tableToRows(t as Table),
        _line: getNodeLineNumber(t),
      }));

    if (tables.length > 0) {
      results.push({
        heading: text,
        headingLine: getNodeLineNumber(node),
        tables,
      });
    }
  }

  return results;
}

/**
 * 提取标题下的代码块
 */
export function extractCodeBlocksUnderHeading(
  root: Root,
  headingRegex: RegExp,
  headingLevel: number,
  lang?: string,
): Array<{ heading: string; headingLine: number; blocks: Array<{ value: string; lang: string; _startLine: number }> }> {
  const results: Array<{ heading: string; headingLine: number; blocks: Array<{ value: string; lang: string; _startLine: number }> }> = [];

  for (let i = 0; i < root.children.length; i++) {
    const node = root.children[i];
    if (node.type !== 'heading' || (node as Heading).depth !== headingLevel) continue;
    const text = headingToText(node as Heading);
    if (!headingRegex.test(text)) continue;

    const sectionChildren = collectSectionChildren(root, i, headingLevel);
    const blocks = sectionChildren
      .filter(n => {
        if (n.type !== 'code') return false;
        if (lang && (n as Code).lang !== lang) return false;
        return true;
      })
      .map(n => ({
        value: (n as Code).value,
        lang: (n as Code).lang ?? '',
        _startLine: getNodeLineNumber(n),
      }));

    if (blocks.length > 0) {
      results.push({
        heading: text,
        headingLine: getNodeLineNumber(node),
        blocks,
      });
    }
  }

  return results;
}

/**
 * 提取指定级别 heading 的完整节（heading + children nodes）
 */
export function extractSectionsAtLevel(
  root: Root,
  headingRegex: RegExp,
  headingLevel: number,
): Array<{ heading: string; headingLine: number; children: Content[] }> {
  const results: Array<{ heading: string; headingLine: number; children: Content[] }> = [];

  for (let i = 0; i < root.children.length; i++) {
    const node = root.children[i];
    if (node.type !== 'heading' || (node as Heading).depth !== headingLevel) continue;
    const text = headingToText(node as Heading);
    if (!headingRegex.test(text)) continue;

    results.push({
      heading: text,
      headingLine: getNodeLineNumber(node),
      children: collectSectionChildren(root, i, headingLevel),
    });
  }

  return results;
}
