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
}

/** config:get-settings 返回的 CC settings.json 配置 */
export interface CCSettings {
  [key: string]: unknown;
}

/** config:get-claude-md 的 scope 参数 */
export type ClaudeMdScope = 'global' | 'project';

/** config:get-claude-md 请求参数 */
export interface ClaudeMdRequest {
  scope: ClaudeMdScope;
  projectPath?: string;
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
