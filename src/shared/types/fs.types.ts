/**
 * 文件系统域类型定义
 * 来源: DEV-PLAN.md §2.2 fs:*
 */

/** fs:read-dir 返回的文件条目 */
export interface FileEntry {
  /** 文件/目录名 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 文件大小（字节） */
  size?: number;
  /** 最后修改时间（ISO8601） */
  modifiedAt?: string;
}

/** fs:read-dir 请求参数 */
export interface ReadDirRequest {
  path: string;
}

/** fs:read-file 请求参数 */
export interface ReadFileRequest {
  path: string;
  /** 编码方式，默认 utf-8；base64 用于读取二进制文件（如图片） */
  encoding?: 'utf-8' | 'base64';
}

/** fs:read-file 返回值 */
export interface ReadFileResponse {
  content: string;
  encoding: string;
}

/** fs:write-file 请求参数 */
export interface WriteFileRequest {
  path: string;
  content: string;
}

/** fs:watch-start 请求参数 */
export interface WatchStartRequest {
  id: string;
  paths: string[];
}

/** fs:watch-stop 请求参数 */
export interface WatchStopRequest {
  id: string;
}

/** fs:change 事件数据（M->R 推送） */
export interface FileChangeEvent {
  path: string;
  event: 'add' | 'change' | 'unlink';
  isNew?: boolean;
}

/** fs:select-directory 返回值 */
export interface SelectDirectoryResult {
  path: string;
}

/** fs:write-temp-image 请求参数 */
export interface WriteTempImageRequest {
  imageData: string;
  format: 'png' | 'jpg';
}

/** fs:write-clipboard-image 请求参数 */
export interface WriteClipboardImageRequest {
  imagePath: string;
}
