# API 接口契约文档

> 此文档由 Claude Code Hook 自动生成（AST 解析版）
> 生成时间: 2026-02-26T04:13:39.607Z
> 项目路径: /Users/rl/Nutstore_Files/my_nutstore/520-program/muxvo
> 扫描文件数: 224
> 接口总数: 110

## 基础信息

- **请求方式**: 见各接口标注
- **认证方式**: token 参数或 Authorization header

## 接口列表

### main

#### `GET accessToken`

- **位置**: `main/index.ts:86`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET refreshToken`

- **位置**: `main/index.ts:87`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {成员访问}`

- **位置**: `main/ipc/fs-watcher-handlers.ts:32`
- **调用函数**: `watchers.get()`
- **请求参数**: 无额外参数

#### `DELETE {成员访问}`

- **位置**: `main/ipc/fs-watcher-handlers.ts:76`
- **调用函数**: `watchers.delete()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{表达式: $to.pos}` | object | 是 |

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

- **位置**: `main/services/chat-dual-source.ts:438`
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

### 用户认证

#### `POST ${...}${...}`

- **位置**: `main/services/auth/backend-client.ts:50`
- **调用函数**: `fetch()`
- **请求参数**: 无额外参数
- **响应字段**:
  - `ok`
  - `json`
  - `statusText`
  - `status`

#### `POST /auth/github/init`

- **位置**: `main/services/auth/backend-client.ts:74`
- **调用函数**: `request()`
- **请求参数**: 无额外参数

#### `POST /auth/google/init`

- **位置**: `main/services/auth/backend-client.ts:79`
- **调用函数**: `request()`
- **请求参数**: 无额外参数

#### `POST /auth/email/send`

- **位置**: `main/services/auth/backend-client.ts:84`
- **调用函数**: `request()`
- **请求参数**: 无额外参数

#### `POST /auth/email/verify`

- **位置**: `main/services/auth/backend-client.ts:92`
- **调用函数**: `request()`
- **请求参数**: 无额外参数

#### `POST /auth/refresh`

- **位置**: `main/services/auth/backend-client.ts:100`
- **调用函数**: `request()`
- **请求参数**: 无额外参数

#### `POST /auth/logout`

- **位置**: `main/services/auth/backend-client.ts:108`
- **调用函数**: `request()`
- **请求参数**: 无额外参数

#### `POST /user/me`

- **位置**: `main/services/auth/backend-client.ts:116`
- **调用函数**: `request()`
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

#### `GET {变量:t}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:357`
- **调用函数**: `xr.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: e}` | object | 是 |

#### `GET {变量:e}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:453`
- **调用函数**: `Sr.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: t}` | object | 是 |

#### `GET {变量:n}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:843`
- **调用函数**: `t.get()`
- **请求参数**: 无额外参数

#### `GET {变量:u}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:890`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:f}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:892`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:l}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:1470`
- **调用函数**: `e.get()`
- **请求参数**: 无额外参数

#### `GET {变量:a}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:1793`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:T}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:1805`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:r}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:2867`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {动态路径}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:2868`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:o}`

- **位置**: `renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:3513`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:value}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:2788`
- **调用函数**: `CapturedStacks.get()`
- **请求参数**: 无额外参数

#### `GET {变量:newIdx}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:3471`
- **调用函数**: `existingChildren.get()`
- **请求参数**: 无额外参数

#### `DELETE {动态路径}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:3551`
- **调用函数**: `oldFiber.delete()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: to2}` | object | 是 |

#### `GET {变量:flags}{动态}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:7665`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:resourceType}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:8498`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:wakeable}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:9405`
- **调用函数**: `pingCache.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:wakeable}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:9410`
- **调用函数**: `pingCache.delete()`
- **请求参数**: 无额外参数

#### `GET {变量:domEventName}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:9836`
- **调用函数**: `topLevelEventsToReactNames.get()`
- **请求参数**: 无额外参数

#### `GET {变量:currentProps}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11418`
- **调用函数**: `pendingProps.get()`
- **请求参数**: 无额外参数

#### `GET {变量:type}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11429`
- **调用函数**: `styles$243.get()`
- **请求参数**: 无额外参数

#### `GET {变量:styleProps}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11528`
- **调用函数**: `preloadPropsMap.get()`
- **请求参数**: 无额外参数

#### `GET {变量:instance$249}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11547`
- **调用函数**: `preloadPropsMap.get()`
- **请求参数**: 无额外参数

#### `GET {变量:ownerDocument}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11591`
- **调用函数**: `caches.get()`
- **请求参数**: 无额外参数

#### `GET {变量:nodeKey}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11600`
- **调用函数**: `cache.get()`
- **请求参数**: 无额外参数

#### `GET {变量:root2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11723`
- **调用函数**: `precedencesByRoot.get()`
- **请求参数**: 无额外参数

#### `GET {变量:node}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:11739`
- **调用函数**: `precedences.get()`
- **请求参数**: 无额外参数

#### `GET {变量:pointerId}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:12135`
- **调用函数**: `queuedPointers.get()`
- **请求参数**: 无额外参数

#### `GET {变量:s16}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:13794`
- **调用函数**: `Fn$2.get()`
- **请求参数**: 无额外参数

#### `GET {动态表达式}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:13813`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:t}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:14111`
- **调用函数**: `http.delete()`
- **请求参数**: 无额外参数

#### `GET {变量:o2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:15186`
- **调用函数**: `s16.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:e}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:16304`
- **调用函数**: `http.delete()`
- **请求参数**: 无额外参数

#### `GET {变量:ze2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:16810`
- **调用函数**: `u3.get()`
- **请求参数**: 无额外参数

#### `GET W`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:17020`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:c}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:17077`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:f2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:17097`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:r10}{动态表达式}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:17513`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {成员访问}{动态}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:17843`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:e}{变量:o2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:18126`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:e}{变量:n}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:18129`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:l2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:18313`
- **调用函数**: `s16.get()`
- **请求参数**: 无额外参数

#### `GET {变量:i9}{动态}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:18556`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {成员访问}{成员访问}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:18978`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `PUT {变量:t}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:19092`
- **调用函数**: `http.put()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: e}` | object | 是 |

#### `PUT {变量:e}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:19448`
- **调用函数**: `http.put()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: u3}` | object | 是 |

#### `GET {成员访问}{变量:e}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:19799`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:r10}{动态}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:19815`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {成员访问}{变量:r10}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:19820`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:r10}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:20347`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:i9}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:20778`
- **调用函数**: `http.delete()`
- **请求参数**: 无额外参数

#### `GET {成员访问}{变量:o2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:20885`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:i9}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:24708`
- **调用函数**: `zi.get()`
- **请求参数**: 无额外参数

#### `GET {变量:A2}{成员访问}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:26430`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:h2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:26435`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:A2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:26531`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:codePoint}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:33238`
- **调用函数**: `decodeMap.get()`
- **请求参数**: 无额外参数

#### `GET {变量:doc2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:92047`
- **调用函数**: `resolveCache.get()`
- **请求参数**: 无额外参数

#### `GET {变量:attrs}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:94196`
- **调用函数**: `suspiciousAttributeCache.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:from2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:95735`
- **调用函数**: `tr3.delete()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: to2}` | object | 是 |

#### `DELETE {动态表达式}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:97077`
- **调用函数**: `http.delete()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{表达式: $cut.pos}` | object | 是 |

#### `GET {变量:next}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:99361`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:chFrom}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:102233`
- **调用函数**: `http.delete()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: chTo}` | object | 是 |

#### `GET {变量:obj}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:107263`
- **调用函数**: `Reflect.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: key}` | object | 是 |

#### `DELETE {变量:textEnd}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:107619`
- **调用函数**: `tr3.delete()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{表达式: range.to}` | object | 是 |

#### `DELETE {成员访问}{变量:startSpaces}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:107622`
- **调用函数**: `tr3.delete()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: textStart}` | object | 是 |

#### `GET {变量:b2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:108311`
- **调用函数**: `cache.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:a}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:108318`
- **调用函数**: `cache.delete()`
- **请求参数**: 无额外参数

#### `DELETE {变量:b2}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:108319`
- **调用函数**: `cache.delete()`
- **请求参数**: 无额外参数

#### `DELETE {变量:callback}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:108833`
- **调用函数**: `subscribers.delete()`
- **请求参数**: 无额外参数

#### `DELETE {变量:onStoreChange}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:109151`
- **调用函数**: `http.delete()`
- **请求参数**: 无额外参数

#### `DELETE {变量:lineStartPos}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:109758`
- **调用函数**: `tr3.delete()`
- **请求参数**: 无额外参数

#### `GET validate`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:110850`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET render`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:110903`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET truncate`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:110939`
- **调用函数**: `options2.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: val}` | object | 是 |

#### `GET format`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:110940`
- **调用函数**: `options2.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: val}` | object | 是 |

#### `GET formatHref`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:110949`
- **调用函数**: `options2.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: href}` | object | 是 |

#### `GET defaultProtocol`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:110949`
- **调用函数**: `options2.get()`
- **请求参数**: 无额外参数

#### `GET tagName`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:111015`
- **调用函数**: `options2.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: href}` | object | 是 |

#### `GET className`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:111018`
- **调用函数**: `options2.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: href}` | object | 是 |

#### `GET target`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:111019`
- **调用函数**: `options2.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: href}` | object | 是 |

#### `GET rel`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:111020`
- **调用函数**: `options2.get()`
- **请求参数**:
  | 参数名 | 类型 | 必填 |
  |-------|------|-----|
  | `{变量: href}` | object | 是 |

#### `GET {变量:state}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:113782`
- **调用函数**: `historyKey.get()`
- **请求参数**: 无额外参数

#### `GET {变量:markType}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:115461`
- **调用函数**: `activeMarks.get()`
- **请求参数**: 无额外参数

#### `GET {变量:tokenName}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:115565`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `GET {变量:name}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:115570`
- **调用函数**: `http.get()`
- **请求参数**: 无额外参数

#### `DELETE {变量:markType}`

- **位置**: `renderer/out/renderer/assets/index-Br2Wxst6.js:116169`
- **调用函数**: `activeMarks.delete()`
- **请求参数**: 无额外参数

#### `DELETE {变量:fn}`

- **位置**: `renderer/stores/terminal-config.ts:42`
- **调用函数**: `listeners.delete()`
- **请求参数**: 无额外参数

---

## 接口索引

| 方法 | 接口路径 | 所属模块 | 文件位置 |
|-----|---------|---------|---------|
| GET | `accessToken` | main | main/index.ts:86 |
| GET | `refreshToken` | main | main/index.ts:87 |
| GET | `{成员访问}` | main | main/ipc/fs-watcher-handlers.ts:32 |
| DELETE | `{成员访问}` | main | main/ipc/fs-watcher-handlers.ts:76 |
| GET | `{变量:date}` | API 服务 | main/services/analytics/tracker.ts:39 |
| POST | `${...}${...}` | 用户认证 | main/services/auth/backend-client.ts:50 |
| POST | `/auth/github/init` | 用户认证 | main/services/auth/backend-client.ts:74 |
| POST | `/auth/google/init` | 用户认证 | main/services/auth/backend-client.ts:79 |
| POST | `/auth/email/send` | 用户认证 | main/services/auth/backend-client.ts:84 |
| POST | `/auth/email/verify` | 用户认证 | main/services/auth/backend-client.ts:92 |
| POST | `/auth/refresh` | 用户认证 | main/services/auth/backend-client.ts:100 |
| POST | `/auth/logout` | 用户认证 | main/services/auth/backend-client.ts:108 |
| POST | `/user/me` | 用户认证 | main/services/auth/backend-client.ts:116 |
| DELETE | `{变量:key}` | API 服务 | main/services/chat-dual-source.ts:42 |
| GET | `{变量:cacheKey}` | API 服务 | main/services/chat-dual-source.ts:438 |
| GET | `{变量:key}` | API 服务 | main/services/chat-watcher.ts:33 |
| GET | `{变量:path}` | API 服务 | main/services/data-sync/sync-manager.ts:99 |
| DELETE | `{变量:terminalId}` | API 服务 | main/services/terminal/input-detector.ts:105 |
| GET | `{变量:id}` | API 服务 | main/services/terminal/manager.ts:96 |
| DELETE | `{变量:id}` | API 服务 | main/services/terminal/manager.ts:142 |
| DELETE | `{变量:p}` | 组件 | renderer/components/file/FilePanel.tsx:137 |
| DELETE | `{变量:folderPath}` | 组件 | renderer/components/file/FilePanel.tsx:139 |
| GET | `{变量:t}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:357 |
| GET | `{变量:e}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:453 |
| GET | `{变量:n}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:843 |
| GET | `{变量:u}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:890 |
| GET | `{变量:f}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:892 |
| GET | `{变量:l}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:1470 |
| GET | `{变量:a}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:1793 |
| GET | `{变量:T}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:1805 |
| GET | `{变量:r}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:2867 |
| GET | `{动态路径}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:2868 |
| GET | `{变量:o}` | renderer | renderer/out/renderer/assets/addon-ligatures-De7GL7Qy.js:3513 |
| GET | `{变量:value}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:2788 |
| GET | `{变量:newIdx}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:3471 |
| DELETE | `{动态路径}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:3551 |
| GET | `{变量:flags}{动态}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:7665 |
| GET | `{变量:resourceType}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:8498 |
| GET | `{变量:wakeable}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:9405 |
| DELETE | `{变量:wakeable}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:9410 |
| GET | `{变量:domEventName}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:9836 |
| GET | `{变量:currentProps}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11418 |
| GET | `{变量:type}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11429 |
| GET | `{变量:styleProps}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11528 |
| GET | `{变量:instance$249}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11547 |
| GET | `{变量:ownerDocument}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11591 |
| GET | `{变量:nodeKey}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11600 |
| GET | `{变量:root2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11723 |
| GET | `{变量:node}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:11739 |
| GET | `{变量:pointerId}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:12135 |
| GET | `{变量:s16}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:13794 |
| GET | `{动态表达式}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:13813 |
| DELETE | `{变量:t}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:14111 |
| GET | `{变量:o2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:15186 |
| DELETE | `{变量:e}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:16304 |
| GET | `{变量:ze2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:16810 |
| GET | `W` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:17020 |
| GET | `{变量:c}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:17077 |
| GET | `{变量:f2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:17097 |
| GET | `{变量:r10}{动态表达式}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:17513 |
| GET | `{成员访问}{动态}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:17843 |
| GET | `{变量:e}{变量:o2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:18126 |
| GET | `{变量:e}{变量:n}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:18129 |
| GET | `{变量:l2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:18313 |
| GET | `{变量:i9}{动态}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:18556 |
| GET | `{成员访问}{成员访问}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:18978 |
| PUT | `{变量:t}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:19092 |
| PUT | `{变量:e}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:19448 |
| GET | `{成员访问}{变量:e}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:19799 |
| GET | `{变量:r10}{动态}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:19815 |
| GET | `{成员访问}{变量:r10}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:19820 |
| GET | `{变量:r10}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:20347 |
| DELETE | `{变量:i9}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:20778 |
| GET | `{成员访问}{变量:o2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:20885 |
| GET | `{变量:i9}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:24708 |
| GET | `{变量:A2}{成员访问}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:26430 |
| GET | `{变量:h2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:26435 |
| GET | `{变量:A2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:26531 |
| GET | `{变量:codePoint}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:33238 |
| GET | `{变量:doc2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:92047 |
| GET | `{变量:attrs}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:94196 |
| DELETE | `{变量:from2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:95735 |
| DELETE | `{动态表达式}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:97077 |
| GET | `{变量:next}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:99361 |
| DELETE | `{变量:chFrom}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:102233 |
| GET | `{变量:obj}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:107263 |
| DELETE | `{变量:textEnd}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:107619 |
| DELETE | `{成员访问}{变量:startSpaces}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:107622 |
| GET | `{变量:b2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:108311 |
| DELETE | `{变量:a}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:108318 |
| DELETE | `{变量:b2}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:108319 |
| DELETE | `{变量:callback}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:108833 |
| DELETE | `{变量:onStoreChange}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:109151 |
| DELETE | `{变量:lineStartPos}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:109758 |
| GET | `validate` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:110850 |
| GET | `render` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:110903 |
| GET | `truncate` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:110939 |
| GET | `format` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:110940 |
| GET | `formatHref` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:110949 |
| GET | `defaultProtocol` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:110949 |
| GET | `tagName` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:111015 |
| GET | `className` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:111018 |
| GET | `target` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:111019 |
| GET | `rel` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:111020 |
| GET | `{变量:state}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:113782 |
| GET | `{变量:markType}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:115461 |
| GET | `{变量:tokenName}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:115565 |
| GET | `{变量:name}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:115570 |
| DELETE | `{变量:markType}` | renderer | renderer/out/renderer/assets/index-Br2Wxst6.js:116169 |
| DELETE | `{变量:fn}` | renderer | renderer/stores/terminal-config.ts:42 |