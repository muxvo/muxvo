/**
 * 整段会话 → Markdown（W11「复制为 Markdown」）。**纯函数**，node 直测。
 *
 * 行为同构自 legacy `formatMessagesAsMarkdown`（../muxvo-legacy/src/renderer/components/chat/SessionDetail.tsx:240-257
 * 读行为不抄结构）：跳过 system；user 段落取消息文本；assistant 段落取其 text 块拼接（tool_use/tool_result 不入
 * 导出正文，与 legacy 一致）。在 legacy 基础上按批3 规格补两处：顶部 `# {title}` 标题、每条 `## {label} ({时间})` 头。
 *
 * label 与消息气泡同口径（ChatHistoryScreen MessageBubble）：user→You、codex- 前缀→Codex、gemini- 前缀→Gemini、
 * 其余 assistant→Claude。文本为空的消息（如仅含工具调用的 assistant、空 user）一律跳过——避免悬空空标题
 * （legacy 亦仅在 textParts>0 时推 assistant）。
 *
 * 时间格式经 `fmtTime` 注入（默认本机 locale 串），便于单测确定性断言。
 */

import type { ChatContentBlock, ChatMessageView } from '../../../bridge/gen/protocol';

/** 供导出的消息最小形（wire ChatMessageView 子集：role/uuid/tsMs/text/blocks）。 */
export type ExportMessage = Pick<ChatMessageView, 'uuid' | 'role' | 'tsMs' | 'text' | 'blocks'>;

/** assistant 消息正文：text 块按序拼接（\n\n 分隔），tool_use/tool_result/image 不入导出。 */
function blocksText(blocks: ChatContentBlock[] | undefined): string {
  if (!blocks) return '';
  return blocks
    .filter((b): b is Extract<ChatContentBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text ?? '')
    .filter((t) => t !== '')
    .join('\n\n');
}

/** 消息正文：优先扁平 text，否则从 blocks 的 text 块拼接。 */
function messageText(m: ExportMessage): string {
  if (m.text != null && m.text !== '') return m.text;
  return blocksText(m.blocks);
}

/** 消息角色标签（与 MessageBubble 同口径）。 */
function roleLabel(m: ExportMessage): string {
  if (m.role === 'user') return 'You';
  if (m.uuid.startsWith('codex-')) return 'Codex';
  if (m.uuid.startsWith('gemini-')) return 'Gemini';
  return 'Claude';
}

export function formatMessagesAsMarkdown(
  title: string,
  messages: readonly ExportMessage[],
  fmtTime: (ms: number) => string = (ms) => new Date(ms).toLocaleString(),
): string {
  const parts: string[] = [];
  const trimmedTitle = title.trim();
  if (trimmedTitle !== '') parts.push(`# ${trimmedTitle}\n\n`);
  for (const m of messages) {
    if (m.role === 'system') continue;
    const body = messageText(m);
    if (body === '') continue; // 空正文（仅工具调用/空消息）跳过，不留悬空标题
    parts.push(`## ${roleLabel(m)} (${fmtTime(m.tsMs)})\n\n${body}\n\n`);
  }
  return parts.join('').trimEnd();
}
