// data-structures.parser.ts — 从 PRD.md §7 提取数据结构
import { parseMarkdown, extractCodeBlocksUnderHeading, extractSectionsAtLevel } from './markdown-parser.js';
import type { DataStructureSpec, FieldSpec } from '../registry.js';

/**
 * 从 PRD.md §7 提取数据结构定义
 *
 * 格式:
 * ### 7.2 Muxvo 本地配置（唯一自有数据）
 * ```json
 * { "window": { ... }, "openTerminals": [...] }
 * ```
 *
 * ### 7.7 AI 评分结果（SkillScore）
 * ```json
 * { "version": 1, "skillDirName": "..." }
 * ```
 */
export function extractDataStructures(prdContent: string): DataStructureSpec[] {
  const root = parseMarkdown(prdContent);
  const specs: DataStructureSpec[] = [];

  // 匹配 ### 7.x 开头的标题
  const sections = extractSectionsAtLevel(root, /^7\.\d+/, 3);

  for (const section of sections) {
    const heading = section.heading;
    const headingMatch = heading.match(/^7\.\d+\s+(.+)$/);
    if (!headingMatch) continue;

    const rawTitle = headingMatch[1].trim();

    // 从标题中提取结构名称（括号中的内容，如 "SkillScore"）
    const nameMatch = rawTitle.match(/[（(](\w+)[）)]/);
    const structName = nameMatch ? nameMatch[1] : titleToStructName(rawTitle);

    // 从标题推断源文件
    const sourceFile = guessSourceFile(structName, rawTitle);

    // 提取代码块
    const codeBlocks = section.children.filter(n => n.type === 'code');
    for (const block of codeBlocks) {
      const code = (block as any).value as string;
      const lang = ((block as any).lang as string) ?? '';
      const blockLine = block.position?.start?.line ?? 0;

      let fields: FieldSpec[];

      if (lang === 'json' || lang === '') {
        fields = extractFieldsFromJSON(code);
      } else if (lang === 'typescript' || lang === 'ts') {
        fields = extractFieldsFromTypeScript(code);
      } else {
        fields = extractFieldsFromJSON(code);
      }

      if (fields.length > 0) {
        specs.push({
          name: structName,
          fields,
          sourceFile,
          sourceLocation: {
            file: 'PRD.md',
            line: blockLine,
          },
        });
      }
    }
  }

  return specs;
}

/** 从 JSON 示例中提取字段 */
function extractFieldsFromJSON(code: string): FieldSpec[] {
  const fields: FieldSpec[] = [];

  // 解析顶层字段
  // 匹配 "fieldName": value 模式
  const fieldRegex = /^\s*"(\w+)":\s*(.+?)(?:,?\s*(?:\/\/.*)?)?$/gm;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(code)) !== null) {
    const name = match[1];
    const valueStr = match[2].trim();

    // 推断类型
    const type = inferTypeFromJSONValue(valueStr);

    fields.push({
      name,
      type,
      required: true, // JSON 示例中出现的字段默认为 required
    });
  }

  return fields;
}

/** 从 TypeScript interface/type 中提取字段 */
function extractFieldsFromTypeScript(code: string): FieldSpec[] {
  const fields: FieldSpec[] = [];

  // 匹配 fieldName?: Type 或 fieldName: Type
  const fieldRegex = /^\s*(\w+)(\??):\s*(.+?);\s*(?:\/\/.*)?$/gm;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(code)) !== null) {
    fields.push({
      name: match[1],
      type: match[3].trim(),
      required: match[2] !== '?',
    });
  }

  return fields;
}

/** 从 JSON 值推断类型 */
function inferTypeFromJSONValue(value: string): string {
  if (value.startsWith('"')) return 'string';
  if (value === 'true' || value === 'false') return 'boolean';
  if (value.startsWith('[')) return 'array';
  if (value.startsWith('{')) return 'object';
  if (/^\d/.test(value)) return 'number';
  return 'unknown';
}

/** 从标题推断结构名称 */
function titleToStructName(title: string): string {
  // "CC 现有数据结构（只读）" → "CCData"
  // "Muxvo 本地配置" → "MuxvoConfig"
  const cleanTitle = title.replace(/[（(].*?[）)]/g, '').trim();

  const nameMap: Record<string, string> = {
    'CC 现有数据结构': 'CCData',
    'Muxvo 本地配置': 'MuxvoConfig',
    '包': 'Package',
    '评价': 'Review',
    '本地注册表': 'MarketplaceRegistry',
    '包归档格式': 'PackageArchive',
    'AI 评分结果': 'SkillScore',
    'Showcase 展示页配置': 'SkillShowcase',
    'muxvo-publisher Plugin 结构': 'MuxvoPublisher',
  };

  for (const [key, val] of Object.entries(nameMap)) {
    if (cleanTitle.includes(key)) return val;
  }

  return cleanTitle.replace(/\s+/g, '');
}

/** 推断源文件 */
function guessSourceFile(structName: string, _title: string): string {
  const fileMap: Record<string, string> = {
    'CCData': 'chat.types.ts',
    'MuxvoConfig': 'config.types.ts',
    'Package': 'marketplace.types.ts',
    'Review': 'marketplace.types.ts',
    'MarketplaceRegistry': 'marketplace.types.ts',
    'PackageArchive': 'marketplace.types.ts',
    'SkillScore': 'score.types.ts',
    'SkillShowcase': 'showcase.types.ts',
    'MuxvoPublisher': 'publish-draft.types.ts',
  };
  return fileMap[structName] ?? 'types.ts';
}
