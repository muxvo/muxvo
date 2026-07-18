/**
 * wire→screen 换算（chat-history.md §7.1 映射表逐条）。
 *
 * 协议 v11 的 view 类型（`ChatProjectView`/`ChatSessionView`/`ChatMessageView`/`ChatSearchHit`/
 * `ChatContentBlock`）是 native 侧的 live wire 形；`ChatHistoryScreen.tsx` 的 fixture 消费形
 * （§0~§6 静态复刻的 ChatProject/ChatSession/ChatMessage/…）是另一个面。本模块只做 live 通道的
 * wire→screen 换算，**不改** §0~§6 的静态复刻 DOM/文案/字节（加性改造纪律，§7 附录）。
 *
 * 映射表（§7.1）：`*Ms` int → ISO 串；`role` → `type`（恒等）；`text`|`blocks` 恰一 → `content`；
 * `claudeCode` → `'claude-code'`（MINOR-1）；工具块 `inputJson` → `JSON.parse` → `input`（MINOR-2，
 * parse 失败降级原字符串别崩）；`ChatSessionView.source` 缺席 ⇒ `'claude-code'`（MINOR-3）；
 * `ChatMessageView.cwd` 缺席 ⇒ `''`。
 *
 * 纯函数、无 React/无 window——node 环境直测（换算函数单测）。
 */

import type {
  ChatContentBlock as WireBlock,
  ChatMessageView,
  ChatProjectView,
  ChatSearchHit,
  ChatSessionView,
  ChatSource,
} from '../../../bridge/gen/protocol';

// ── 内容匹配占位卡 → 最小 wire 会话（缺陷3；供 live 容器 selWire/canResume 判定） ──

// ── screen fixture 消费形（与 ChatHistoryScreen.tsx 私有 interface 结构同构；边界经 fx.chat:any，
//    结构匹配即可，§7.1 是形状权威） ──

export interface ScreenChatProject {
  projectHash: string;
  displayPath: string;
  displayName: string;
  sessionCount: number;
  totalSize: number;
  lastActivity: string;
  source?: string;
}

export interface ScreenChatSession {
  sessionId: string;
  projectHash: string;
  title: string;
  startedAt: string;
  lastModified: string | number;
  fileSize: number;
  source?: string;
  customTitle?: string;
  cwd?: string;
  worktreeLabel?: string;
}

export interface ScreenChatBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking' | 'unknown';
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

export interface ScreenChatMessage {
  uuid: string;
  type: 'user' | 'assistant' | 'system';
  sessionId: string;
  cwd: string;
  timestamp: string;
  content: string | ScreenChatBlock[];
}

export interface ScreenChatSearchResult {
  projectHash: string;
  sessionId: string;
  snippet: string;
  timestamp: string;
}

/** int ms → ISO 串（screen 时间函数按 §5/§6 口径消费 ISO；formatTime 走 Date.parse）。 */
export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * §7.1 MINOR-1/MINOR-3：`ChatSource` camel → screen kebab。
 * `'claudeCode'` → `'claude-code'`；`'codex'` 恒等；**缺席 ⇒ `'claude-code'`**（screen :391 亦默认）。
 */
export function sourceToKebab(source: ChatSource | undefined): string {
  return source === 'codex' ? 'codex' : 'claude-code';
}

/**
 * §7.1 MINOR-2：工具块 `inputJson`/`resultJson` 原文串 → 已解析对象。
 * native 已保证合法 JSON；parse 失败 **降级为原字符串**（screen ToolCallBlock 对字符串/对象都能渲染，
 * 不崩）。原样透传字符串会退化为「JSON 的 markdown」而非 key/value 字段 → 故必须解析（golden 回归风险）。
 */
export function parseJsonLenient(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function projectToScreen(p: ChatProjectView): ScreenChatProject {
  // ChatProjectView 无 `source` 字段（§7.1）→ 不设 source。
  return {
    projectHash: p.projectHash,
    displayPath: p.displayPath,
    displayName: p.displayName,
    sessionCount: p.sessionCount,
    totalSize: p.totalSize,
    lastActivity: msToIso(p.lastActivityMs),
  };
}

export function sessionToScreen(s: ChatSessionView): ScreenChatSession {
  return {
    sessionId: s.sessionId,
    projectHash: s.projectHash,
    // 问题5 兜底（live-only）：native title_fallback 链仍空时最后一道占位——绝不渲染空标题卡片。
    title: s.title || '(无标题)',
    startedAt: msToIso(s.startedAtMs),
    lastModified: msToIso(s.lastModifiedMs),
    fileSize: s.fileSize,
    source: sourceToKebab(s.source),
    customTitle: s.customTitle,
    cwd: s.cwd,
    worktreeLabel: s.worktreeLabel,
  };
}

export function blockToScreen(b: WireBlock): ScreenChatBlock {
  switch (b.kind) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'toolUse':
      return { type: 'tool_use', name: b.name, input: parseJsonLenient(b.inputJson) };
    case 'toolResult':
      return {
        type: 'tool_result',
        content: b.resultJson !== undefined ? parseJsonLenient(b.resultJson) : undefined,
      };
    case 'image':
      // §4 image → `.image-block img`（data-URI）；screen ChatContentBlock 无 dataUri 字段 → 落 content。
      return { type: 'image', content: b.dataUri };
    case 'thinking':
      // 问题4：思考块 → 折叠展示（展开体走 markdown）；只承载正文，signature 已在 wire 面丢弃。
      return { type: 'thinking', text: b.text };
    case 'unknown':
      // 问题4 根因2：未知块占位（不再裸 dump 进正文）——name=块类型、content=原文 JSON（展开体 <pre> 原样）。
      return { type: 'unknown', name: b.blockType, content: b.rawJson };
  }
}

export function messageToScreen(m: ChatMessageView): ScreenChatMessage {
  // §7.1「恰一存在」：blocks 优先，其次 text，两缺兜底空串（native 组装保证恰一，此处只做降级不崩）。
  // 缺陷4 + 问题4：assistant/user 的 string 型消息包成 text 块 → 走屏 renderBlock 的 markdown-preview/MD 通道
  // （user 气泡 md 见 chat-live.css 覆盖）；**system 的 string 保持纯文本**（走 SystemFoldBlock 折叠壳，
  // 不渲 markdown）。blocks 已存在时优先级不变。
  const content: string | ScreenChatBlock[] =
    m.blocks !== undefined
      ? m.blocks.map(blockToScreen)
      : m.text !== undefined
        ? m.role !== 'system'
          ? [{ type: 'text', text: m.text }]
          : m.text
        : '';
  return {
    uuid: m.uuid,
    type: m.role, // role → type 恒等（§7.1）
    sessionId: m.sessionId,
    cwd: m.cwd ?? '', // 缺席 ⇒ ''（§7.1）
    timestamp: msToIso(m.tsMs),
    content,
  };
}

export function searchHitToScreen(h: ChatSearchHit): ScreenChatSearchResult {
  return {
    projectHash: h.projectHash,
    sessionId: h.sessionId,
    snippet: h.snippet,
    timestamp: msToIso(h.tsMs),
  };
}

/**
 * 内容匹配占位卡（未加载会话不在 s.sessions）→ 从搜索命中合成最小 wire 会话，供 live 容器的 selWire /
 * canResume / resume 判定（缺陷3）。source/customTitle/cwd/archiveOnly 未知留 undefined：
 *  - source：wire ChatSearchHit 无 source 字段 → 由调用方从已加载消息 uuid 前缀推断（inferSourceFromMessages，
 *    M-1），避免 codex 会话续聊误注入 CC harness（缺陷7 症状换路径复活）；
 *  - archiveOnly：未知 → `!archiveOnly` 恒真，归档-only 占位卡仍可能误现「继续聊天」（登记批2 接缝，
 *    「超30天回填续聊」落地后收敛）。
 * 命中缺席（非搜索占位）返回 undefined，调用方退回 undefined selWire。
 */
export function synthSessionFromSearchHit(
  results: readonly ChatSearchHit[],
  sessionId: string,
): ChatSessionView | undefined {
  const hit = results.find((h) => h.sessionId === sessionId);
  if (!hit) return undefined;
  return {
    sessionId: hit.sessionId,
    projectHash: hit.projectHash,
    title: '',
    startedAtMs: hit.tsMs,
    lastModifiedMs: hit.tsMs,
    fileSize: -1,
  };
}

/**
 * 从已加载消息 uuid 前缀推断会话 source（M-1）：codex 消息 uuid 带 `codex-` 前缀（CodexSessionSource 生成侧；
 * 工具消息若有 call_id 则该条无前缀，但同会话必有 user/agent 带前缀条）→ 返回 `'codex'`；否则 undefined
 * （交调用方默认 claudeCode）。供 source 未知的搜索占位卡续聊发射，避免 codex 会话错注入 CC harness。
 */
export function inferSourceFromMessages(messages: readonly ChatMessageView[]): ChatSource | undefined {
  return messages.some((m) => m.uuid.startsWith('codex-')) ? 'codex' : undefined;
}
