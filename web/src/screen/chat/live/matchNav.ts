/**
 * chat 右栏搜索命中导航的**纯逻辑**（M5-R1 批3 W6，chat-history.md §7.4 / legacy SessionDetail.tsx:294-372）。
 *
 * 两件必须恒等的东西同居此模块，便于对照推理：
 *  1. `enumerateMatches`：按「文本口径」枚举命中（徽记 total、▲▼ 目标）。
 *  2. `highlightHtml`：把渲染后的 HTML 文本节点包 `<mark class="search-highlight">`（DOM 命中）。
 * 「文本口径」= string content 整体 / blocks 的 text 块按序 join('\n')（**工具块不计**）——这与
 * `highlightHtml` 只对文本节点标记、且 ChatHistoryScreen 只对 text 块/字符串正文传 highlight（工具块不传）
 * 保持 DOM `mark.search-highlight` 数与枚举命中数恒等的前提。markdown 语法跨节点（如 hljs 跨 token）的
 * 极端查询会破坏该前提——与 legacy 同构、同接受（前提不成立时 ▲▼ 到未渲染 mark 只是滚动落空不崩）。
 *
 * 纯函数、无 React/无 window → node 直测。
 */

/** 一处命中：msgIdx=在渲染 messages 数组中的下标（===气泡 data-msg-idx）；nthInMsg=该条内第几次出现（0 基）。 */
export interface MatchOccurrence {
  msgIdx: number;
  nthInMsg: number;
}

/** 枚举所用的消息最小形（content=字符串正文 或 内容块数组；仅 type==='text' 的块计入文本口径）。 */
export interface EnumMessage {
  content: string | Array<{ type: string; text?: string }>;
}

/**
 * 逐条消息枚举 query 出现次数（大小写不敏感、非重叠、左→右），每次出现单独成一命中项。
 * 文本口径：string content 整体 / blocks 的 text 块按序 join('\n')（工具块不计）。query 空 → 无命中。
 */
export function enumerateMatches(messages: readonly EnumMessage[], query: string): MatchOccurrence[] {
  const q = query.toLowerCase();
  if (q === '') return [];
  const results: MatchOccurrence[] = [];
  for (let i = 0; i < messages.length; i++) {
    const content = messages[i].content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((b) => b.type === 'text' && b.text)
              .map((b) => b.text as string)
              .join('\n')
          : '';
    const lower = text.toLowerCase();
    let pos = 0;
    let nth = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      results.push({ msgIdx: i, nthInMsg: nth });
      nth++;
      pos += q.length;
    }
  }
  return results;
}

/** 命中下标钳制（**不循环**）：total≤0 → 0；否则夹到 [0, total-1]。 */
export function clampIdx(idx: number, total: number): number {
  if (total <= 0) return 0;
  if (idx < 0) return 0;
  if (idx > total - 1) return total - 1;
  return idx;
}

/** 命中会话+查询的组合键：变化即重置 currentMatchIdx=0（R1.19，legacy `${messageKey}:${searchQuery}`）。 */
export function matchKey(sessionId: string | null, query: string): string {
  return `${sessionId ?? ''}:${query}`;
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * 在 HTML 串里高亮 query 命中：**只改文本节点段，不动标签/属性**（legacy MarkdownPreview.tsx:20-27 同构）。
 * 正则 `(<[^>]*>)|([^<]+)`：group1=标签原样返回；group2=文本段内对 query（先 regex-escape）包
 * `<mark class="search-highlight">$1</mark>`。query 仅用于构造匹配正则、命中文本本身来自已转义 HTML →
 * **无注入面**（query 含 `<script>` 等只作字面匹配，命中不了转义后的文本节点）。query 空 → 原样返回。
 */
export function highlightHtml(html: string, query: string): string {
  if (!query) return html;
  const escaped = query.replace(REGEX_SPECIAL, '\\$&');
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) => {
    if (tag) return tag;
    return (text ?? '').replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark class="search-highlight">$1</mark>',
    );
  });
}
