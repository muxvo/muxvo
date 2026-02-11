// performance.parser.ts — 从 PRD.md §11.2 提取性能参数
import { parseMarkdown, extractTablesUnderHeading } from './markdown-parser.js';
import type { PerformanceParamSpec } from '../registry.js';

/**
 * 从 PRD.md §11.2 提取性能策略参数
 *
 * 格式:
 * ### 11.2 性能策略【AI 补充】
 * | 策略 | 说明 |
 * | JSONL 延迟加载 | 聊天历史仅在打开时加载 |
 * | 终端缓冲区限制 | 聚焦/可见终端保留 10000 行... |
 */
export function extractPerformanceParams(prdContent: string, devPlanContent: string): PerformanceParamSpec[] {
  const specs: PerformanceParamSpec[] = [];

  // 从 PRD.md §11.2 提取
  extractFromPRDSection(prdContent, specs);

  // 也从 DEV-PLAN.md 中提取可能的性能相关参数
  extractFromDevPlan(devPlanContent, specs);

  return specs;
}

function extractFromPRDSection(prdContent: string, specs: PerformanceParamSpec[]): void {
  const root = parseMarkdown(prdContent);
  const sections = extractTablesUnderHeading(root, /^11\.2/, 3);

  for (const section of sections) {
    for (const row of section.rows) {
      const [name, description] = row.cells;
      if (!name) continue;

      // 从描述中提取数值参数
      const numericParams = extractNumericValues(description ?? '');

      if (numericParams.length > 0) {
        for (const param of numericParams) {
          specs.push({
            name: name.trim(),
            value: param.raw,
            numericValue: param.numeric,
            unit: param.unit,
            context: (description ?? '').trim(),
            codePattern: generateCodePattern(name, param),
            sourceLocation: {
              file: 'PRD.md',
              line: row._line,
            },
          });
        }
      } else {
        // 没有明确数值的策略，仍然记录
        specs.push({
          name: name.trim(),
          value: '',
          numericValue: 0,
          unit: '',
          context: (description ?? '').trim(),
          sourceLocation: {
            file: 'PRD.md',
            line: row._line,
          },
        });
      }
    }
  }
}

function extractFromDevPlan(devPlanContent: string, specs: PerformanceParamSpec[]): void {
  // 从 DEV-PLAN 中提取一些关键的性能参数
  const lines = devPlanContent.split('\n');
  const seenNames = new Set(specs.map(s => s.name));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 查找关键的性能指标
    const patterns = [
      { regex: /scrollback\s*=?\s*(\d+)/, name: 'scrollback', unit: '行' },
      { regex: /超\s*(\d+)\s*GB/, name: '内存阈值', unit: 'GB' },
      { regex: /每\s*(\d+)\s*s?\s*检查/, name: '检查间隔', unit: 's' },
      { regex: /(\d+)\s*ms\s*去抖/, name: '去抖延迟', unit: 'ms' },
    ];

    for (const pat of patterns) {
      const m = line.match(pat.regex);
      if (m && !seenNames.has(pat.name)) {
        // 不重复添加已有的参数名
        // 性能参数只从 PRD 主提取，DevPlan 作为补充
      }
    }
  }
}

/** 从描述文本提取数值 */
function extractNumericValues(text: string): Array<{ raw: string; numeric: number; unit: string }> {
  const results: Array<{ raw: string; numeric: number; unit: string }> = [];

  // 常见模式
  const patterns = [
    // "10000 行" / "1000 行"
    { regex: /(\d+)\s*行/g, unit: '行' },
    // "20 个" / "上限 20 个"
    { regex: /(?:上限\s*)?(\d+)\s*个/g, unit: '个' },
    // "300ms"
    { regex: /(\d+)\s*ms/g, unit: 'ms' },
    // "60 秒" / "60s"
    { regex: /(\d+)\s*[秒s]/g, unit: 's' },
    // "2GB" / "2 GB"
    { regex: /(\d+)\s*GB/g, unit: 'GB' },
    // "100MB" / "100 MB"
    { regex: /(\d+)\s*MB/g, unit: 'MB' },
    // "1 小时"
    { regex: /(\d+)\s*小时/g, unit: 'h' },
    // "90 天"
    { regex: /(\d+)\s*天/g, unit: '天' },
    // "1 年"
    { regex: /(\d+)\s*年/g, unit: '年' },
    // "6 个月"
    { regex: /(\d+)\s*个月/g, unit: '月' },
    // "200ms"
    { regex: /延迟\s*(\d+)\s*ms/g, unit: 'ms' },
    // "每页 20 条"
    { regex: /每页\s*(\d+)\s*条/g, unit: '条/页' },
    // "30 秒" timeout
    { regex: /(\d+)\s*秒/g, unit: 's' },
    // "5 分钟"
    { regex: /(\d+)\s*分钟/g, unit: 'min' },
    // "5MB"
    { regex: /≤?\s*(\d+)\s*MB/g, unit: 'MB' },
  ];

  const seen = new Set<string>();
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.regex.exec(text)) !== null) {
      const raw = m[0];
      const key = `${m[1]}-${pat.unit}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        raw,
        numeric: parseInt(m[1], 10),
        unit: pat.unit,
      });
    }
  }

  return results;
}

/** 生成代码中可能的搜索模式提示 */
function generateCodePattern(name: string, param: { numeric: number; unit: string }): string | undefined {
  const patterns: Record<string, string> = {
    '终端缓冲区限制': `scrollback`,
    '最大终端数限制': `MAX_TERMINALS`,
    '内存监控': `memoryUsage`,
    '搜索去抖': `debounce`,
    '分页加载': `pageSize`,
    '缓存热门列表': `cache`,
    '搜索索引': `search-index`,
  };

  return patterns[name.trim()];
}
