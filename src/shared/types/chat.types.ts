/**
 * 聊天历史域类型定义
 *
 * 基于文件系统扫描 ~/.claude/projects/ 目录
 * 数据层次: Project → Session → Message
 */

/** 聊天数据来源 */
export type ChatSource = 'claude-code' | 'codex';

/** 从 ~/.claude/projects/ 或 ~/.codex/sessions/ 扫描得到的项目信息 */
export interface ProjectInfo {
  /** 目录名（projectHash），如 "-Users-rl-..." 或 "codex--Users-rl-..." */
  projectHash: string;
  /** 完整项目路径，从 session 的 cwd 字段获取 */
  displayPath: string;
  /** 短名称（displayPath 最后一段） */
  displayName: string;
  /** 该项目下 .jsonl session 文件数量 */
  sessionCount: number;
  /** 该项目下所有 session 文件的总大小（字节） */
  totalSize?: number;
  /** 最近活跃时间（ms，取最新 session 文件的 mtime） */
  lastActivity: number;
  /** 数据来源工具 */
  source?: ChatSource;
}

/** 单个 session 的摘要信息（从 .jsonl 文件头部提取） */
export interface SessionSummary {
  /** Session UUID（文件名去掉 .jsonl） */
  sessionId: string;
  /** 所属项目的 hash */
  projectHash: string;
  /** 第一条用户消息文本（截断 ~100 字符），作为标题 */
  title: string;
  /** Session 开始时间（ISO 字符串） */
  startedAt: string;
  /** 文件修改时间（ms），用于排序 */
  lastModified: number;
  /** 会话文件大小（字节），用于提示对话长短 */
  fileSize: number;
  /** 数据来源工具 */
  source?: ChatSource;
  /** 用户自定义标题（来自终端命名） */
  customTitle?: string;
}

/** 消息中的内容块（user 和 assistant 共用） */
export interface AssistantContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  /** type='text' 时的文本内容 */
  text?: string;
  /** type='tool_use' 时的工具名称 */
  name?: string;
  /** type='tool_use' 时的工具输入 */
  input?: unknown;
  /** type='tool_result' 时的结果内容 */
  content?: unknown;
  /** type='tool_result' 时关联的 tool_use_id */
  tool_use_id?: string;
  /** type='image' 时的图片源 */
  source?: { type: string; media_type: string; data: string };
}

/** 规范化后的 session 消息，用于 UI 渲染 */
export interface SessionMessage {
  /** 消息 UUID */
  uuid: string;
  /** 消息类型（跳过 file-history-snapshot） */
  type: 'user' | 'assistant' | 'system';
  /** Session ID */
  sessionId: string;
  /** 工作目录 */
  cwd: string;
  /** Git 分支 */
  gitBranch?: string;
  /** ISO 时间戳 */
  timestamp: string;
  /**
   * 消息内容
   * - user: 纯字符串
   * - assistant: AssistantContentBlock 数组
   */
  content: string | AssistantContentBlock[];
}

/** chat:search 返回的搜索结果 */
export interface SearchResult {
  /** 项目 hash */
  projectHash: string;
  /** Session ID */
  sessionId: string;
  /** 匹配文本片段 */
  snippet: string;
  /** ISO 时间戳 */
  timestamp: string;
}

/** chat:session-update 推送事件（M→R） */
export interface ChatSessionUpdateEvent {
  projectHash: string;
  sessionId: string;
}

/** chat:sync-status 同步状态 */
export type ChatSyncStatus = 'syncing' | 'idle' | 'error';

/** chat:export 请求参数 */
export interface ChatExportRequest {
  projectHash: string;
  sessionId: string;
  format: 'markdown' | 'json';
}

/** chat:export 响应 */
export interface ChatExportResponse {
  outputPath: string;
}
