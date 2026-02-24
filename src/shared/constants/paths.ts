/**
 * 路径常量
 * 来源: DEV-PLAN.md §5 目录结构 + PRD 附录 A
 *
 * 注意: MUXVO_DATA_DIR 在运行时通过 Electron app.getPath('userData') 获取,
 * 这里仅提供相对子路径常量。
 */

import { join } from 'path';
import { homedir } from 'os';

// ---- CC 数据目录 ----

/** CC 根数据目录 ~/.claude/ */
export const CC_DATA_DIR = join(homedir(), '.claude');

/** CC 全局设置 */
export const CC_SETTINGS_PATH = join(CC_DATA_DIR, 'settings.json');

/** CC 全局指令 */
export const CC_CLAUDE_MD_PATH = join(CC_DATA_DIR, 'CLAUDE.md');

/** CC MCP 配置 */
export const CC_MCP_PATH = join(CC_DATA_DIR, 'mcp.json');

/** CC Skills 目录 */
export const CC_SKILLS_DIR = join(CC_DATA_DIR, 'skills');

/** CC Hooks 目录 */
export const CC_HOOKS_DIR = join(CC_DATA_DIR, 'hooks');

/** CC Plans 目录 */
export const CC_PLANS_DIR = join(CC_DATA_DIR, 'plans');

/** CC Tasks 目录 */
export const CC_TASKS_DIR = join(CC_DATA_DIR, 'tasks');

/** CC Projects 目录（含 session JSONL 和 MEMORY.md） */
export const CC_PROJECTS_DIR = join(CC_DATA_DIR, 'projects');

/** CC Plugins 目录 */
export const CC_PLUGINS_DIR = join(CC_DATA_DIR, 'plugins');

// ---- Gemini CLI 数据目录 ----

/** Gemini CLI 根数据目录 ~/.gemini/ */
export const GEMINI_DATA_DIR = join(homedir(), '.gemini');

/** Gemini CLI Skills 目录 */
export const GEMINI_SKILLS_DIR = join(GEMINI_DATA_DIR, 'skills');

/** Gemini CLI 全局指令 */
export const GEMINI_MD_PATH = join(GEMINI_DATA_DIR, 'GEMINI.md');

// ---- Muxvo 数据目录子路径（相对于 app.getPath('userData')） ----

/** Muxvo 聊天历史镜像子目录 */
export const MUXVO_CHAT_HISTORY_SUBDIR = 'chat-history';

/** Muxvo 评分缓存子目录 */
export const MUXVO_SKILL_SCORES_SUBDIR = 'skill-scores';

/** Muxvo 展示页配置子目录 */
export const MUXVO_SHOWCASES_SUBDIR = 'showcases';

/** Muxvo 发布草稿子目录 */
export const MUXVO_PUBLISH_DRAFTS_SUBDIR = 'publish-drafts';

/** Muxvo 搜索索引子目录 */
export const MUXVO_SEARCH_INDEX_SUBDIR = 'search-index';

/** Muxvo 应用配置文件名 */
export const MUXVO_CONFIG_FILENAME = 'config.json';

/** Muxvo 用户偏好文件名 */
export const MUXVO_PREFERENCES_FILENAME = 'preferences.json';

/** Muxvo 包注册表文件名 */
export const MUXVO_MARKETPLACE_FILENAME = 'marketplace.json';

/** Muxvo 埋点数据文件名 */
export const MUXVO_ANALYTICS_FILENAME = 'analytics.json';

/** Muxvo 日志子目录 */
export const MUXVO_LOGS_SUBDIR = 'logs';
