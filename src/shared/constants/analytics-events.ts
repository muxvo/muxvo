/**
 * Analytics 事件名称常量
 * 设计原则: 从业务问题出发，4 层结构
 *   Layer 1: 会话生命周期 → 用户活跃度 (Q1)
 *   Layer 2: 屏幕/面板    → 功能使用分布 (Q2)
 *   Layer 3: 关键动作      → 转化漏斗 + 功能深度 (Q2+Q3)
 *   Layer 4: 错误事件      → 摩擦点 (Q4)
 */

export const ANALYTICS_EVENTS = {
  // ── Layer 1: 会话生命周期 → Q1 用户活跃度 ──
  SESSION: {
    /** 应用窗口创建完成 | params: {version, platform, restored_count} */
    START: 'session.start',
    /** 应用退出前 | params: {duration_sec, terminal_count, features_used: string[]} */
    END: 'session.end',
    /** 定时心跳（30min）| params: {uptime_sec} — 用于使用时长统计 + 跨天 DAU */
    HEARTBEAT: 'session.heartbeat',
  },

  // ── Layer 2: 屏幕/面板打开 → Q2 功能使用分布 ──
  SCREEN: {
    /** 用户切换到任一面板 | params: {name: 'chat'|'skills'|'mcp'|'hooks'|'plugins'|'settings'} */
    VIEW: 'screen.view',
  },

  // ── Layer 3: 关键动作 → Q2 深度 + Q3 漏斗 ──
  TERMINAL: {
    /** 终端创建成功 | params: {cwd} */
    CREATE: 'terminal.create',
    /** 终端关闭 | params: {duration_sec, had_process} */
    CLOSE: 'terminal.close',
  },

  CHAT: {
    /** 打开聊天历史面板 */
    OPEN: 'chat.open',
    /** 搜索会话 | params: {query_length, result_count} */
    SEARCH: 'chat.search',
    /** 从历史恢复会话 | params: {source} */
    RESUME: 'chat.resume',
    /** 导出聊天记录 | params: {format} */
    EXPORT: 'chat.export',
  },

  SKILL: {
    /** 查看 Skill 详情 | params: {skill_path} */
    SELECT: 'skill.select',
    /** 保存 Skill 编辑 */
    EDIT: 'skill.edit',
  },

  FILE: {
    /** 预览文件 | params: {file_type} */
    PREVIEW: 'file.preview',
  },

  THEME: {
    /** 切换主题 | params: {to: 'dark'|'light'} */
    SWITCH: 'theme.switch',
  },

  ONBOARDING: {
    /** 引导流程结束 | params: {skipped: boolean} */
    COMPLETE: 'onboarding.complete',
    /** 引导每一步完成 | params: {step, total} */
    STEP: 'onboarding.step',
  },

  // ── Layer 4: 错误事件 → Q4 摩擦点 ──
  ERROR: {
    /** IPC 调用返回 success:false | params: {channel, code, message} */
    IPC: 'error.ipc',
    /** 终端创建/运行失败 | params: {type: 'spawn_fail'|'crash'|'timeout'} */
    TERMINAL: 'error.terminal',
    /** 用户操作失败 | params: {feature, action, error} */
    ACTION: 'error.action',
  },
} as const;

/** 从嵌套 const 对象中提取所有叶子值的联合类型 */
type NestedValues<T> = T extends object
  ? { [K in keyof T]: NestedValues<T[K]> }[keyof T]
  : T;

export type AnalyticsEventName = NestedValues<typeof ANALYTICS_EVENTS>;
