/**
 * 终端管理域类型定义
 * 来源: DEV-PLAN.md §2.1 terminal:*
 */

/** 终端状态枚举（10 个状态） */
export enum TerminalState {
  Created = 'Created',
  Starting = 'Starting',
  Running = 'Running',
  Busy = 'Busy',
  WaitingInput = 'WaitingInput',
  Stopping = 'Stopping',
  Stopped = 'Stopped',
  Disconnected = 'Disconnected',
  Failed = 'Failed',
  Removed = 'Removed',
}

/** terminal:create 请求参数 */
export interface TerminalCreateRequest {
  cwd: string;
}

/** terminal:create 响应 */
export interface TerminalCreateResponse {
  id: string;
  pid: number;
}

/** terminal:write 请求参数 */
export interface TerminalWriteRequest {
  id: string;
  data: string;
}

/** terminal:resize 请求参数 */
export interface TerminalResizeRequest {
  id: string;
  cols: number;
  rows: number;
}

/** terminal:close 请求参数 */
export interface TerminalCloseRequest {
  id: string;
  force?: boolean;
}

/** terminal:list / terminal:get-state 返回的终端信息 */
export interface TerminalInfo {
  id: string;
  pid: number;
  cwd: string;
  state: TerminalState;
  processName?: string;
  customName?: string;
}

/** terminal:output 事件数据（M->R 推送） */
export interface TerminalOutputEvent {
  id: string;
  data: string;
}

/** terminal:state-change 事件数据（M->R 推送） */
export interface TerminalStateChangeEvent {
  id: string;
  state: TerminalState;
  processName?: string;
}

/** terminal:exit 事件数据（M->R 推送） */
export interface TerminalExitEvent {
  id: string;
  code: number;
}

/** terminal:get-foreground-process 返回值 */
export interface ForegroundProcessInfo {
  name: string;
  pid: number;
}
