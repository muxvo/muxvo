/**
 * 发布草稿类型定义
 * 来源: PRD §7.10 + DEV-PLAN.md §5 目录结构
 */

/** 发布草稿状态 */
export type PublishDraftStatus =
  | 'draft'
  | 'security_check_failed'
  | 'ready'
  | 'published';

/** 安全检查结果 */
export interface SecurityCheckResult {
  passed: boolean;
  issues: string[];
  checkedAt: string;
}

/** 发布草稿详情 */
export interface PublishDraftDetails {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  problem?: string;
  solution?: string;
  screenshots?: string[];
}

/** 发布草稿 */
export interface PublishDraft {
  skillDirName: string;
  status: PublishDraftStatus;
  securityCheck?: SecurityCheckResult;
  details?: PublishDraftDetails;
  scoreRef?: string;
  publishedUrl?: string;
  publishedAt?: string;
  version?: string;
}
