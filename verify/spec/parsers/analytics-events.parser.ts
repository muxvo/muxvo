// analytics-events.parser.ts — 从 DEV-PLAN.md 和 PRD.md 提取埋点事件
import { parseMarkdown, extractAllTablesInSection, extractSectionsAtLevel } from './markdown-parser.js';
import type { AnalyticsEventSpec } from '../registry.js';

/**
 * 从 PRD.md §13.3 和 DEV-PLAN.md 提取埋点事件
 *
 * PRD.md §13.3 格式:
 * **终端管理事件：**
 * | 事件名 | 触发时机 | 携带参数 |
 * | `terminal.create` | 创建新终端 | `{cwd, timestamp}` |
 *
 * DEV-PLAN.md 格式（文本列表）:
 * V1 事件（共 22 个）：
 * - 终端管理 6 个：`terminal.create`（参数 ...
 */
export function extractAnalyticsEvents(devPlanContent: string, prdContent: string): AnalyticsEventSpec[] {
  const specs: AnalyticsEventSpec[] = [];
  const seenEvents = new Set<string>();

  // 1. 从 PRD.md §13.3 埋点事件定义表格提取
  extractFromPRD(prdContent, specs, seenEvents);

  // 2. 从 DEV-PLAN.md 的事件列表提取补充
  extractFromDevPlan(devPlanContent, specs, seenEvents);

  return specs;
}

function extractFromPRD(prdContent: string, specs: AnalyticsEventSpec[], seenEvents: Set<string>): void {
  const root = parseMarkdown(prdContent);

  // 找到 ### 13.3 埋点事件定义 节下的所有表格
  const sections = extractAllTablesInSection(root, /^13\.3/, 3);

  if (sections.length === 0) return;

  for (const section of sections) {
    // 确定事件类别：通过查找表格前面的段落文字
    for (const tableInfo of section.tables) {
      // 根据表格位置猜测分类
      const category = guessCategoryFromContext(root, tableInfo._line);

      for (const row of tableInfo.rows) {
        const [eventNameRaw, _trigger, paramsRaw] = row.cells;
        if (!eventNameRaw) continue;

        const eventName = eventNameRaw.replace(/`/g, '').trim();
        if (!eventName || seenEvents.has(eventName)) continue;
        seenEvents.add(eventName);

        // 解析参数
        const params = parseParams(paramsRaw ?? '');

        // 从事件名推断 phase
        const phase = inferPhase(eventName, category);

        specs.push({
          name: eventName,
          category: category || inferCategoryFromEventName(eventName),
          params,
          phase,
          sourceLocation: {
            file: 'PRD.md',
            line: row._line,
          },
        });
      }
    }
  }
}

function extractFromDevPlan(devPlanContent: string, specs: AnalyticsEventSpec[], seenEvents: Set<string>): void {
  // DEV-PLAN.md 中以文本形式列出事件
  // 格式: `terminal.create`（参数 `{cwd}`）
  const eventRegex = /`(\w+\.\w+)`(?:（参数\s*`?\{?([^}`]*)\}?`?\）)?/g;
  const lines = devPlanContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;

    // 判断当前行所属分类
    const lineCategory = detectLineCategory(line, lines, i);

    while ((match = eventRegex.exec(line)) !== null) {
      const eventName = match[1];
      if (seenEvents.has(eventName)) continue;
      seenEvents.add(eventName);

      const paramsStr = match[2] ?? '';
      const params = parseInlineParams(paramsStr);
      const phase = inferPhase(eventName, lineCategory);

      specs.push({
        name: eventName,
        category: lineCategory || inferCategoryFromEventName(eventName),
        params,
        phase,
        sourceLocation: {
          file: 'DEV-PLAN.md',
          line: i + 1,
        },
      });
    }
  }
}

/** 从表格行号附近的上下文推断分类 */
function guessCategoryFromContext(root: any, tableLine: number): string {
  // 向上搜索最近的粗体文本或段落
  for (let i = root.children.length - 1; i >= 0; i--) {
    const node = root.children[i];
    const line = node.position?.start?.line ?? 0;
    if (line >= tableLine) continue;
    if (line < tableLine - 10) break;

    if (node.type === 'paragraph') {
      const text = extractTextFromNode(node);
      if (text.includes('终端管理')) return 'terminal';
      if (text.includes('面板')) return 'panel';
      if (text.includes('富编辑器')) return 'editor';
      if (text.includes('Skill 发现') || text.includes('安装')) return 'skill';
      if (text.includes('AI 评分')) return 'score';
      if (text.includes('Showcase') || text.includes('展示页')) return 'showcase';
      if (text.includes('生命周期') || text.includes('应用')) return 'app';
    }
  }
  return '';
}

function extractTextFromNode(node: any): string {
  if ('value' in node) return node.value;
  if ('children' in node) return node.children.map(extractTextFromNode).join('');
  return '';
}

/** 从事件名推断分类 */
function inferCategoryFromEventName(name: string): string {
  const prefix = name.split('.')[0];
  const map: Record<string, string> = {
    terminal: 'terminal',
    panel: 'panel',
    editor: 'editor',
    skill: 'skill',
    score: 'score',
    showcase: 'showcase',
    app: 'app',
  };
  return map[prefix] ?? 'other';
}

/** 从事件名和分类推断 phase */
function inferPhase(eventName: string, category: string): string {
  if (category === 'score' || eventName.startsWith('score.')) return 'V2-P1';
  if (category === 'showcase' || eventName.startsWith('showcase.')) return 'V2-P2';
  if (category === 'skill' || eventName.startsWith('skill.')) return 'V2-P0';
  return 'V1';
}

/** 解析表格中的参数描述 */
function parseParams(raw: string): Record<string, string> {
  const clean = raw.replace(/`/g, '').replace(/^\{/, '').replace(/\}$/, '').trim();
  if (!clean || clean === '-') return {};

  const params: Record<string, string> = {};
  // 匹配 key: type 或 key 模式
  const parts = clean.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      params[trimmed.slice(0, colonIdx).trim()] = trimmed.slice(colonIdx + 1).trim();
    } else {
      params[trimmed] = 'any';
    }
  }
  return params;
}

/** 解析行内简写参数 */
function parseInlineParams(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  return parseParams(raw);
}

/** 检测行所属分类 */
function detectLineCategory(line: string, lines: string[], idx: number): string {
  // 检查当前行和前几行
  for (let i = idx; i >= Math.max(0, idx - 5); i--) {
    const l = lines[i];
    if (l.includes('终端管理')) return 'terminal';
    if (l.includes('面板')) return 'panel';
    if (l.includes('富编辑器')) return 'editor';
    if (l.includes('Skill 发现')) return 'skill';
    if (l.includes('AI 评分')) return 'score';
    if (l.includes('Showcase')) return 'showcase';
    if (l.includes('生命周期')) return 'app';
  }
  return '';
}
