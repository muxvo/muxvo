// directory-tree.parser.ts — 从 DEV-PLAN.md §5 提取目录结构
import { parseMarkdown, extractCodeBlocksUnderHeading } from './markdown-parser.js';
import type { DirectoryEntrySpec } from '../registry.js';

/**
 * 从 DEV-PLAN.md §5 提取项目目录结构
 *
 * 代码块格式:
 * muxvo/
 * ├── package.json
 * │   ├── ipc/                 # IPC Handler 按域分组
 * │   │   ├── score.ipc.ts      # V2-P1
 */
export function extractDirectoryTree(devPlanContent: string): DirectoryEntrySpec[] {
  const root = parseMarkdown(devPlanContent);
  const specs: DirectoryEntrySpec[] = [];

  // 查找 ## 5. 项目目录结构 下的代码块
  const sections = extractCodeBlocksUnderHeading(root, /^5\.\s*项目目录/, 2);
  if (sections.length === 0) return specs;

  for (const section of sections) {
    for (const block of section.blocks) {
      const lines = block.value.split('\n');
      const pathStack: string[] = [];

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        if (!line.trim()) continue;

        // 从行内注释提取 phase
        const commentMatch = line.match(/#\s*(V\d+-?P?\d*)/);
        const phase = commentMatch ? commentMatch[1] : 'V1';

        // 移除注释部分
        const cleanLine = line.replace(/#.*$/, '');

        // 提取文件/目录名
        // 替换树形字符后计算缩进深度
        const withoutTreeChars = cleanLine.replace(/[├└│─]/g, ' ').replace(/\s+$/, '');
        const nameMatch = withoutTreeChars.match(/^(\s*)(\S+)/);
        if (!nameMatch) continue;

        const indent = nameMatch[1].length;
        let name = nameMatch[2].trim();

        // 如果是根目录行（如 "muxvo/"）
        if (indent === 0) {
          name = name.replace(/\/$/, '');
          pathStack.length = 0;
          pathStack.push(name);
          continue;
        }

        // 计算深度：每 4 个字符一层
        const depth = Math.floor(indent / 4);

        // 去除尾部斜杠
        const isDirectory = name.endsWith('/') || !name.includes('.');
        name = name.replace(/\/$/, '');

        // 更新路径栈
        pathStack.length = depth;
        pathStack.push(name);

        // 从第二个元素开始（跳过根目录 "muxvo"）拼接路径
        const fullPath = pathStack.slice(1).join('/');
        if (!fullPath) continue;

        specs.push({
          path: fullPath,
          type: isDirectory ? 'directory' : 'file',
          phase,
          sourceLocation: {
            file: 'DEV-PLAN.md',
            line: block._startLine + lineIdx,
          },
        });
      }
    }
  }

  return specs;
}
