/**
 * IPC 统一错误响应格式
 * 来源: DEV-PLAN.md §2.12
 */

/** IPC 错误对象 */
export interface IPCError {
  /** 错误码，格式为 "域.错误类型"（如 "terminal.spawn_failed"） */
  code: string;
  /** 人类可读的错误描述 */
  message: string;
  /** 可选的附加信息（如原始异常堆栈、失败路径等） */
  details?: any;
}

/** IPC 统一响应包装 */
export interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: IPCError;
}
