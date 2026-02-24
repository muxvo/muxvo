# API 接口契约文档

> 此文档由 Claude Code Hook 自动生成（AST 解析版）
> 生成时间: 2026-02-24T14:35:33.091Z
> 项目路径: /Users/rl/Nutstore_Files/my_nutstore/520-program/muxvo
> 扫描文件数: 212
> 接口总数: 13

## 基础信息

- **请求方式**: 见各接口标注
- **认证方式**: token 参数或 Authorization header

## 接口列表

### main

#### `GET {成员访问}`

- **位置**: `main/ipc/fs-watcher-handlers.ts:32`
- **调用函数**: `watchers.get()`
- **请求参数**: 无额外参数

#### `DELETE {成员访问}`

- **位置**: `main/ipc/fs-watcher-handlers.ts:76`
- **调用函数**: `watchers.delete()`
- **请求参数**: 无额外参数

### API 服务

#### `GET {变量:date}`

- **位置**: `main/services/analytics/tracker.ts:39`
- **调用函数**: `grouped.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:key}`

- **位置**: `main/services/chat-dual-source.ts:42`
- **调用函数**: `summaryCache.delete()`
- **请求参数**: 无额外参数

#### `GET {变量:cacheKey}`

- **位置**: `main/services/chat-dual-source.ts:380`
- **调用函数**: `summaryCache.get()`
- **请求参数**: 无额外参数

#### `GET {变量:key}`

- **位置**: `main/services/chat-watcher.ts:33`
- **调用函数**: `pendingTimers.get()`
- **请求参数**: 无额外参数

#### `GET {变量:path}`

- **位置**: `main/services/data-sync/sync-manager.ts:99`
- **调用函数**: `lockedFiles.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:terminalId}`

- **位置**: `main/services/terminal/input-detector.ts:105`
- **调用函数**: `buffers.delete()`
- **请求参数**: 无额外参数

#### `GET {变量:id}`

- **位置**: `main/services/terminal/manager.ts:96`
- **调用函数**: `outputBuffers.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:id}`

- **位置**: `main/services/terminal/manager.ts:142`
- **调用函数**: `terminals.delete()`
- **请求参数**: 无额外参数

### 组件

#### `DELETE {变量:p}`

- **位置**: `renderer/components/file/FilePanel.tsx:137`
- **调用函数**: `next.delete()`
- **请求参数**: 无额外参数

#### `DELETE {变量:folderPath}`

- **位置**: `renderer/components/file/FilePanel.tsx:139`
- **调用函数**: `next.delete()`
- **请求参数**: 无额外参数

### renderer

#### `DELETE {变量:fn}`

- **位置**: `renderer/stores/terminal-config.ts:42`
- **调用函数**: `listeners.delete()`
- **请求参数**: 无额外参数

---

## 接口索引

| 方法 | 接口路径 | 所属模块 | 文件位置 |
|-----|---------|---------|---------|
| GET | `{成员访问}` | main | main/ipc/fs-watcher-handlers.ts:32 |
| DELETE | `{成员访问}` | main | main/ipc/fs-watcher-handlers.ts:76 |
| GET | `{变量:date}` | API 服务 | main/services/analytics/tracker.ts:39 |
| DELETE | `{变量:key}` | API 服务 | main/services/chat-dual-source.ts:42 |
| GET | `{变量:cacheKey}` | API 服务 | main/services/chat-dual-source.ts:380 |
| GET | `{变量:key}` | API 服务 | main/services/chat-watcher.ts:33 |
| GET | `{变量:path}` | API 服务 | main/services/data-sync/sync-manager.ts:99 |
| DELETE | `{变量:terminalId}` | API 服务 | main/services/terminal/input-detector.ts:105 |
| GET | `{变量:id}` | API 服务 | main/services/terminal/manager.ts:96 |
| DELETE | `{变量:id}` | API 服务 | main/services/terminal/manager.ts:142 |
| DELETE | `{变量:p}` | 组件 | renderer/components/file/FilePanel.tsx:137 |
| DELETE | `{变量:folderPath}` | 组件 | renderer/components/file/FilePanel.tsx:139 |
| DELETE | `{变量:fn}` | renderer | renderer/stores/terminal-config.ts:42 |