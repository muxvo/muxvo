/**
 * AI 评分域类型定义
 * 来源: DEV-PLAN.md §2.7 score:* + PRD §7.7 + PRD §8.9
 */

/**
 * 评分维度（6 维度）
 * - practicality: 实用性（25%）
 * - engineering: 工程质量（25%）
 * - intentClarity: 意图清晰度（10%）
 * - designCleverness: 设计巧妙度（10%）
 * - documentation: 文档完善度（15%）
 * - reusability: 可复用性（15%）
 */
export type ScoreDimension =
  | 'practicality'
  | 'engineering'
  | 'intentClarity'
  | 'designCleverness'
  | 'documentation'
  | 'reusability';

/** 单个维度的评分详情 */
export interface DimensionScore {
  score: number;
  reason: string;
}

/** 评分等级 */
export type ScoreGrade =
  | 'Promising'    // 0-39
  | 'Solid'        // 40-59
  | 'Advanced'     // 60-79
  | 'Expert'       // 80-94
  | 'Masterwork';  // 95-100

/** score:run / score:get-cached 返回的完整评分结果 */
export interface SkillScore {
  version: number;
  skillDirName: string;
  contentHash: string;
  scores: Record<ScoreDimension, DimensionScore>;
  total: number;
  grade: ScoreGrade;
  title: string;
  suggestions: string[];
  scoredAt: string;
  apiModel?: string;
  promptVersion?: string;
}

/** score:run 请求参数 */
export interface ScoreRunRequest {
  skillDirName: string;
  includeAnalytics?: boolean;
}

/** score:check-scorer 返回值 */
export interface ScorerCheckResult {
  installed: boolean;
  version?: string;
}

/** score:progress 事件数据（M->R 推送） */
export interface ScoreProgressEvent {
  skillDirName: string;
  status: string;
}

/** score:result 事件数据（M->R 推送） */
export interface ScoreResultEvent {
  skillDirName: string;
  score: SkillScore;
}
