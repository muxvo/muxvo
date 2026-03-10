/**
 * 配置管理域 + 应用状态域类型定义
 * 来源: DEV-PLAN.md §2.4 config:* + §2.5 app:*
 */

/** config:get-resources 资源类型 */
export type ResourceType =
  | 'skills'
  | 'hooks'
  | 'plans'
  | 'tasks'
  | 'mcp'
  | 'plugins';

/** config:get-resources 返回的资源项 */
export interface Resource {
  /** 资源名称 */
  name: string;
  /** 资源类型 */
  type: ResourceType;
  /** 资源路径 */
  path: string;
  /** 最后修改时间（ISO8601） */
  updatedAt?: string;
  /** 来源工具（'claude' | 'codex' | 'gemini'），可选 */
  source?: string;
  /** 级别（'system' | 'project'），可选 */
  level?: 'system' | 'project';
}

/** config:get-settings 返回的 CC settings.json 配置 */
export interface CCSettings {
  [key: string]: unknown;
}

/** config:get-claude-md 的 scope 参数 */
export type ClaudeMdScope = 'global' | 'project';

/** 上下文 MD 文件的工具来源 */
export type ContextMdTool = 'claude' | 'gemini';

/** config:get-claude-md 请求参数 */
export interface ClaudeMdRequest {
  scope: ClaudeMdScope;
  projectPath?: string;
  /** 工具来源，默认 'claude'（读 CLAUDE.md），'gemini' 读 GEMINI.md */
  tool?: ContextMdTool;
}

/** config:resource-change 事件数据（M->R 推送） */
export interface ResourceChangeEvent {
  type: string;
  event: string;
  name: string;
}

// ---- 应用状态域 (app:*) ----

/** 终端持久化配置项 */
export interface OpenTerminalConfig {
  cwd: string;
  customName?: string;
  active?: boolean;
}

/** Grid 布局配置 */
export interface GridLayout {
  columnRatios: number[];
  /** Per-row independent column ratios (new format) */
  perRowColumnRatios?: number[][];
  rowRatios: number[];
}

/** 终端光标样式 */
export type TerminalCursorStyle = 'block' | 'underline' | 'bar';

/** 终端主题名称 */
export type TerminalThemeName = 'dark' | 'light' | 'monokai' | 'dracula' | 'solarized-dark';

/** 终端配置 */
export interface TerminalConfig {
  themeName: TerminalThemeName;
  fontFamily: string;
  fontSize: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
}

/** Dock 角标通知模式 */
export type DockBadgeMode = 'off' | 'realtime' | 'timed';

/** 保存的工作区（一组终端快照） */
export interface SavedWorkspace {
  /** 工作区名称 */
  name: string;
  /** 终端列表 */
  terminals: OpenTerminalConfig[];
  /** 保存时间（ISO8601） */
  savedAt: string;
}

/** app:get-config 返回的 Muxvo 本地配置 */
export interface MuxvoConfig {
  window: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
  openTerminals: OpenTerminalConfig[];
  gridLayout: GridLayout;
  /** 三栏临时视图左栏宽度 */
  ftvLeftWidth?: number;
  /** 三栏临时视图右栏宽度 */
  ftvRightWidth?: number;
  theme: string;
  fontSize: number;
  terminal?: TerminalConfig;
  /** 启动时自动创建的终端数量 (1-5) */
  startupTerminalCount?: number;
  /** Custom session titles: sessionId -> displayName (from terminal rename or history panel rename) */
  sessionCustomTitles?: Record<string, string>;
  /** 全局缩放级别（0=100%，每±1步=10%缩放，范围 -5~+10） */
  zoomLevel?: number;
  /** 双击终端 tile 是否切换到聚焦模式（默认 false） */
  doubleClickToFocus?: boolean;
  /** 是否在文件面板显示隐藏文件（dotfiles），默认 false */
  showHiddenFiles?: boolean;
  /** Dock 角标通知模式（默认 'off'） */
  dockBadgeMode?: DockBadgeMode;
  /** 定时模式检查间隔（分钟），默认 1，最小 1 */
  dockBadgeIntervalMin?: number;
  /** 是否已弹过 Dock 角标权限提示（持久化，只弹一次） */
  dockBadgePermissionNotified?: boolean;
  /** 保存的工作区列表（最多 10 个） */
  savedWorkspaces?: SavedWorkspace[];
}

/** app:get-preferences 返回的用户偏好 */
export interface UserPreferences {
  [key: string]: unknown;
}

/** app:memory-warning 事件数据（M->R 推送） */
export interface MemoryWarningEvent {
  usageMB: number;
  threshold: number;
}

/** app:detect-cli-tools 返回值 */
export interface CLIToolsDetection {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}
