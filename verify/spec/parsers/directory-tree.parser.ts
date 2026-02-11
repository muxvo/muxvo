// directory-tree.parser.ts — 从 DEV-PLAN.md §5 提取项目目录结构
import type { DirectoryEntrySpec } from '../registry.js';
import {
  parseMarkdown,
  extractCodeBlocksUnderHeading,
} from './markdown-parser.js';

/**
 * 从 DEV-PLAN.md 的 `## 5. 项目目录结构` 提取代码块中的目录树。
 *
 * 树形结构使用 ├──、└──、│ 等字符。
 * 注释 # V2-P1 表示 phase。
 * 含 . 的为 file，否则为 directory。
 */
export function extractDirectoryTree(devPlanContent: string): DirectoryEntrySpec[] {
  const root = parseMarkdown(devPlanContent);
  const results: DirectoryEntrySpec[] = [];

  const sections = extractCodeBlocksUnderHeading(root, /^5\.\s*项目目录/, 2);
  if (sections.length === 0) return results;

  for (const section of sections) {
    for (const block of section.blocks) {
      const lines = block.value.split('\n');
      parseTreeLines(lines, block._startLine + 1, results);
    }
  }

  return results;
}

function parseTreeLines(
  lines: string[],
  baseLineNumber: number,
  results: DirectoryEntrySpec[],
): void {
  // 路径栈，按深度追踪当前路径
  const pathStack: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // 提取 phase 注释: # V2-P1
    const phaseMatch = line.match(/#\s*(V\d+-?P?\d*)/);
    const phase = phaseMatch ? phaseMatch[1] : 'V1';

    // 移除注释部分以获取纯路径信息
    const cleanLine = line.replace(/#.*$/, '').trimEnd();

    // 计算深度：统计 tree 字符占据的前导宽度
    // 每一层缩进由 `│   ` (4 chars) 或 `    ` (4 chars) 表示
    // 实际名称之前的 tree 结构字符: ├── 或 └── 或 │
    const depth = getTreeDepth(cleanLine);

    // 提取名称: 移除 tree 结构字符
    const name = cleanLine
      .replace(/^[│├└─\s]+/, '')
      .trim();

    if (!name) continue;

    // 更新路径栈
    // 深度 0 = root (e.g., "muxvo/")
    pathStack.length = depth;
    pathStack[depth] = name.replace(/\/$/, ''); // 移除尾部 /

    // 构建完整路径
    const fullPath = pathStack.slice(0, depth + 1).join('/');

    // 判断类型: 名称含 . 且不以 / 结尾的为 file，否则为 directory
    const isFile = name.includes('.') && !name.endsWith('/');
    const type: 'file' | 'directory' = isFile ? 'file' : 'directory';

    results.push({
      path: fullPath,
      type,
      phase,
      sourceLocation: { file: 'DEV-PLAN.md', line: baseLineNumber + i },
    });
  }
}

function getTreeDepth(line: string): number {
  // 找到第一个非 tree 字符的位置
  let pos = 0;
  let depth = 0;

  while (pos < line.length) {
    const ch = line[pos];
    if (ch === '│' || ch === '├' || ch === '└' || ch === '─' || ch === ' ') {
      pos++;
    } else {
      break;
    }
  }

  // 每层约 4 个字符宽（考虑 unicode 字符宽度）
  // 使用 tree 连接符的位置来计算
  // ├── name  → depth 1
  // │   ├── name → depth 2
  // │   │   ├── name → depth 3
  // 连接符（├ or └）前面每 4 个字符代表一层
  const connectorPos = line.search(/[├└]/);
  if (connectorPos < 0) {
    // 根元素（如 "muxvo/"），没有连接符
    return 0;
  }

  // 连接符前每一层占 4 个字符（│ + 3 spaces 或 4 spaces）
  depth = Math.floor(connectorPos / 4) + 1;
  return depth;
}
