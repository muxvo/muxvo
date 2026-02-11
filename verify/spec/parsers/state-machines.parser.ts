// state-machines.parser.ts — 从 PRD.md §6 提取状态机
import { parseMarkdown, extractCodeBlocksUnderHeading } from './markdown-parser.js';
import type { StateMachineSpec, TransitionSpec } from '../registry.js';

/**
 * 从 PRD.md §6 提取所有状态机定义
 *
 * 格式:
 * ### 6.1 应用生命周期
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Launching: 用户启动 Muxvo
 *     state Running { ... }
 * ```
 */
export function extractStateMachines(prdContent: string): StateMachineSpec[] {
  const root = parseMarkdown(prdContent);
  const specs: StateMachineSpec[] = [];

  // 匹配 ### 6.x 开头的标题
  const sections = extractCodeBlocksUnderHeading(root, /^6\.\d+/, 3, 'mermaid');

  for (const section of sections) {
    // 从标题提取名称和编号
    const headingMatch = section.heading.match(/^(6\.\d+)\s+(.+)$/);
    if (!headingMatch) continue;

    const prdSection = headingMatch[1];
    const rawName = headingMatch[2].trim();

    // 生成文件名: "应用生命周期" → "app-lifecycle.machine.ts"
    const fileName = sectionToFileName(prdSection);

    for (const block of section.blocks) {
      const { states, transitions } = parseMermaidStateDiagram(block.value);

      specs.push({
        name: rawName,
        fileName,
        prdSection,
        states,
        transitions,
        sourceLocation: {
          file: 'PRD.md',
          line: block._startLine,
        },
      });
    }
  }

  return specs;
}

/** 根据 PRD section 编号映射文件名 */
function sectionToFileName(section: string): string {
  const mapping: Record<string, string> = {
    '6.1': 'app-lifecycle.machine.ts',
    '6.2': 'terminal-process.machine.ts',
    '6.3': 'view-mode.machine.ts',
    '6.4': 'tile-interaction.machine.ts',
    '6.5': 'file-panel.machine.ts',
    '6.6': 'temp-view.machine.ts',
    '6.7': 'cwd-switch.machine.ts',
    '6.8': 'custom-name.machine.ts',
    '6.9': 'grid-resize.machine.ts',
    '6.10': 'chat-panel.machine.ts',
    '6.11': 'config-panel.machine.ts',
    '6.12': 'file-watcher.machine.ts',
    '6.13': 'rich-editor.machine.ts',
    '6.14': 'skill-browser.machine.ts',
    '6.15': 'package-install.machine.ts',
    '6.16': 'ai-score.machine.ts',
    '6.17': 'auth.machine.ts',
    '6.18': 'showcase.machine.ts',
  };
  return mapping[section] ?? `section-${section}.machine.ts`;
}

/** 解析 mermaid stateDiagram-v2 代码 */
function parseMermaidStateDiagram(code: string): { states: string[]; transitions: TransitionSpec[] } {
  const statesSet = new Set<string>();
  const transitions: TransitionSpec[] = [];
  const lines = code.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // 跳过空行和指令行
    if (!line || line.startsWith('stateDiagram') || line.startsWith('note ') || line === '}') continue;

    // 状态转换: StateA --> StateB: event
    const transitionMatch = line.match(/^(\[?\*?\]?|\w+)\s*-->\s*(\[?\*?\]?|\w+)\s*(?::\s*(.+))?$/);
    if (transitionMatch) {
      const from = transitionMatch[1];
      const to = transitionMatch[2];
      const event = transitionMatch[3]?.trim() ?? '';

      // 收集非特殊状态
      if (from !== '[*]') statesSet.add(from);
      if (to !== '[*]') statesSet.add(to);

      transitions.push({ from, to, event });
      continue;
    }

    // 嵌套状态声明: state StateName { 或 state StateName
    const stateMatch = line.match(/^state\s+(\w+)\s*\{?/);
    if (stateMatch) {
      statesSet.add(stateMatch[1]);
      continue;
    }

    // 简单状态行（以 [*] 或标识符开头但不是转换）
    // 例如已经被上面的转换规则处理了
  }

  return {
    states: Array.from(statesSet).sort(),
    transitions,
  };
}
