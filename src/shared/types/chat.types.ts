/**
 * 聊天历史域类型定义
 * 来源: DEV-PLAN.md §2.3 chat:*
 */

/** chat:get-history 请求参数 */
export interface ChatHistoryRequest {
  limit?: number;
  offset?: number;
}

/** history.jsonl 中的每行条目 */
export interface HistoryEntry {
  /** 用户输入的文本 */
  display: string;
  /** 粘贴内容 */
  pastedContents?: Record<string, unknown>;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 项目路径 */
  project: string;
  /** Session ID */
  sessionId: string;
}

/** 按 sessionId 聚合后的会话摘要 */
export interface SessionSummary {
  sessionId: string;
  project: string;
  projectHash: string;
  title: string;
  timestamp: number;
  messageCount: number;
}

/** Session JSONL 中的每行消息 */
export interface SessionMessage {
  type: 'user' | 'assistant' | 'file-history-snapshot';
  uuid: string;
  sessionId: string;
  timestamp: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string }>;
  };
}

/** chat:search 返回的搜索结果 */
export interface SearchResult {
  /** 匹配的项目路径 */
  project: string;
  /** 匹配的 Session ID */
  sessionId: string;
  /** 匹配的文本片段 */
  snippet: string;
  /** 匹配时间戳 */
  timestamp: number;
}

/** chat:session-update 事件数据（M->R 推送） */
export interface ChatSessionUpdateEvent {
  projectId: string;
  sessionId: string;
}

/** chat:sync-status 同步状态 */
export type ChatSyncStatus = 'syncing' | 'idle' | 'error';

/** chat:export 请求参数 */
export interface ChatExportRequest {
  projectIds?: string[];
  format: 'markdown' | 'json';
  dateRange?: {
    start: string;
    end: string;
  };
}

/** chat:export 响应 */
export interface ChatExportResponse {
  outputPath: string;
}
