// state-machines.parser.ts — 从 PRD.md §6 提取状态机定义
import type { StateMachineSpec, TransitionSpec } from '../registry.js';
import {
  parseMarkdown,
  extractCodeBlocksUnderHeading,
  extractSectionsAtLevel,
} from './markdown-parser.js';

/**
 * 从 PRD.md 的 `## 6、状态机` 部分提取 mermaid stateDiagram-v2。
 *
 * 解析:
 * - `[*] --> StateName` → 初始状态
 * - `StateA --> StateB: event` → 状态转换
 * - `state StateName { ... }` → 嵌套状态
 * - `StateName --> [*]` → 终止
 */
export function extractStateMachines(prdContent: string): StateMachineSpec[] {
  const root = parseMarkdown(prdContent);
  const results: StateMachineSpec[] = [];

  // 查找 ### 6.x 级别的子节（状态机章节）
  const sections = extractSectionsAtLevel(root, /^6\.\d+/, 3);

  for (const section of sections) {
    const sectionMatch = section.heading.match(/^(6\.\d+)\s+(.+)/);
    if (!sectionMatch) continue;

    const prdSection = sectionMatch[1];
    const sectionTitle = sectionMatch[2].trim();

    // 推导文件名: e.g. "应用生命周期" → 从目录树中匹配
    // 使用 section number 推导: 6.1 → app-lifecycle.machine.ts
    const fileName = inferMachineFileName(prdSection);

    // 提取 mermaid 代码块
    const codeBlocks = section.children.filter(
      n => n.type === 'code' && (n as any).lang === 'mermaid',
    );

    if (codeBlocks.length === 0) continue;

    for (const codeBlock of codeBlocks) {
      const mermaidCode = (codeBlock as any).value as string;
      const { states, transitions } = parseMermaidStateDiagram(mermaidCode);

      results.push({
        name: sectionTitle,
        fileName,
        prdSection,
        states,
        transitions,
        sourceLocation: {
          file: 'PRD.md',
          line: codeBlock.position?.start?.line ?? section.headingLine,
        },
      });
    }
  }

  return results;
}

/** 从 mermaid stateDiagram-v2 代码中提取状态与转换 */
function parseMermaidStateDiagram(code: string): {
  states: string[];
  transitions: TransitionSpec[];
} {
  const states = new Set<string>();
  const transitions: TransitionSpec[] = [];

  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过空行、注释、指令
    if (!trimmed || trimmed.startsWith('%%') || trimmed === 'stateDiagram-v2') continue;

    // 匹配 note 行（跳过）
    if (trimmed.startsWith('note ')) continue;

    // 匹配 state 声明（嵌套状态）: state StateName { 或 state "name" as alias
    const stateMatch = trimmed.match(/^state\s+(\S+)\s*\{/);
    if (stateMatch) {
      const stateName = stateMatch[1].replace(/"/g, '');
      states.add(stateName);
      continue;
    }

    // 匹配转换: StateA --> StateB: event
    const transMatch = trimmed.match(/^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.+))?$/);
    if (transMatch) {
      const from = transMatch[1].trim();
      const to = transMatch[2].trim();
      const event = transMatch[3]?.trim() ?? '';

      // 收集非特殊状态名
      if (from !== '[*]') states.add(from);
      if (to !== '[*]') states.add(to);

      transitions.push({ from, to, event });
      continue;
    }

    // 匹配闭合大括号（跳过）
    if (trimmed === '}') continue;
  }

  return {
    states: Array.from(states),
    transitions,
  };
}

/** 从 PRD section number 推导状态机文件名 */
function inferMachineFileName(prdSection: string): string {
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
  return mapping[prdSection] ?? `unknown-${prdSection}.machine.ts`;
}
