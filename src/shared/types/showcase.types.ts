/**
 * Showcase 域类型定义
 * 来源: DEV-PLAN.md §2.8 showcase:* + PRD §7.8
 */

/** 展示页模板类型 */
export type ShowcaseTemplate = 'developer-dark' | 'minimal-light' | 'vibrant';

/** 展示页 Hero 区块 */
export interface ShowcaseHero {
  title: string;
  tagline: string;
}

/** 展示页 Problem/Solution 区块 */
export interface ShowcaseProblemSolution {
  problem: string;
  solution: string;
}

/** 展示页功能特性 */
export interface ShowcaseFeature {
  icon: string;
  title: string;
  description: string;
}

/** 展示页演示项 */
export interface ShowcaseDemo {
  type: string;
  url: string;
  caption?: string;
}

/** 展示页发布信息 */
export interface ShowcasePublishInfo {
  status: string;
  publishedAt?: string;
  url?: string;
  githubRepo?: string;
}

/** showcase:generate 返回的展示页配置 */
export interface ShowcaseConfig {
  version: number;
  skillDirName: string;
  template: ShowcaseTemplate;
  hero: ShowcaseHero;
  problemSolution?: ShowcaseProblemSolution;
  features?: ShowcaseFeature[];
  demos?: ShowcaseDemo[];
  tags?: string[];
  scoreRef?: string;
  publish?: ShowcasePublishInfo;
  lastGeneratedAt?: string;
  lastEditedAt?: string;
}

/** showcase:generate 请求参数 */
export interface ShowcaseGenerateRequest {
  skillDirName: string;
  template: string;
}

/** showcase:publish 请求参数 */
export interface ShowcasePublishRequest {
  skillDirName: string;
  details?: {
    problem: string;
    solution: string;
    screenshots: string[];
  };
  securityChecked: boolean;
}

/** showcase:publish 返回值 */
export interface ShowcasePublishResult {
  url: string;
}

/** showcase:publish-result 事件数据（M->R 推送） */
export interface ShowcasePublishResultEvent {
  skillDirName: string;
  success: boolean;
  url?: string;
  error?: string;
}
