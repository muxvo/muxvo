# API 接口契约文档

> 此文档由 Claude Code Hook 自动生成（AST 解析版）
> 生成时间: 2026-02-19T16:43:27.602Z
> 项目路径: /Users/rl/Nutstore_Files/my_nutstore/520-program/muxvo
> 扫描文件数: 237
> 接口总数: 10

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

#### `GET {变量:path}`

- **位置**: `main/services/data-sync/sync-manager.ts:99`
- **调用函数**: `lockedFiles.get()`
- **请求参数**: 无额外参数

#### `GET {变量:id}`

- **位置**: `main/services/terminal/manager.ts:96`
- **调用函数**: `outputBuffers.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:id}`

- **位置**: `main/services/terminal/manager.ts:138`
- **调用函数**: `terminals.delete()`
- **请求参数**: 无额外参数

### modules

#### `GET {变量:event}`

- **位置**: `modules/marketplace/directory-watcher.ts:23`
- **调用函数**: `listeners.get()`
- **请求参数**: 无额外参数

#### `GET change`

- **位置**: `modules/marketplace/directory-watcher.ts:28`
- **调用函数**: `listeners.get()`
- **请求参数**: 无额外参数

#### `GET {变量:key}`

- **位置**: `modules/score/cache.ts:37`
- **调用函数**: `store.get()`
- **请求参数**: 无额外参数

### 组件

#### `DELETE {变量:folderName}`

- **位置**: `renderer/components/file/FilePanel.tsx:82`
- **调用函数**: `next.delete()`
- **请求参数**: 无额外参数

---

## 接口索引

| 方法 | 接口路径 | 所属模块 | 文件位置 |
|-----|---------|---------|---------|
| GET | `{成员访问}` | main | main/ipc/fs-watcher-handlers.ts:32 |
| DELETE | `{成员访问}` | main | main/ipc/fs-watcher-handlers.ts:76 |
| GET | `{变量:date}` | API 服务 | main/services/analytics/tracker.ts:39 |
| GET | `{变量:path}` | API 服务 | main/services/data-sync/sync-manager.ts:99 |
| GET | `{变量:id}` | API 服务 | main/services/terminal/manager.ts:96 |
| DELETE | `{变量:id}` | API 服务 | main/services/terminal/manager.ts:138 |
| GET | `{变量:event}` | modules | modules/marketplace/directory-watcher.ts:23 |
| GET | `change` | modules | modules/marketplace/directory-watcher.ts:28 |
| GET | `{变量:key}` | modules | modules/score/cache.ts:37 |
| DELETE | `{变量:folderName}` | 组件 | renderer/components/file/FilePanel.tsx:82 |