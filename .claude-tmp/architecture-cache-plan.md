# 聊天消息无限滚动 — 架构与缓存策略分析

## 1. 当前数据流分析

### 组件层次

```
ChatHistoryPanel (三栏容器, 状态管理中心)
├── ProjectList       ← projects: ProjectInfo[]
├── SessionList       ← sessions: SessionSummary[]
└── SessionDetail     ← messages: SessionMessage[] + loading
```

### 当前消息加载流程

1. 用户点击 session → `ChatHistoryPanel` 调用 `window.api.chat.getSession(projectHash, sessionId)`
2. 后端 `chat-handlers.ts:getSession` 默认 `{ limit: 100 }` → `readSession()` 从 JSONL 文件尾部读取最后 100 条
3. 后端使用 tail-read 优化: 文件 > 2MB 时只读最后 2MB 字节再解析
4. 前端 `SessionDetail` 收到全部 messages，用 `visibleCount` 状态控制分页展示（默认 50 条），用户点击"加载更早消息"按钮增加 visibleCount
5. 实时更新: `onSessionUpdate` 事件触发时重新全量获取当前 session 的消息

### 当前问题

- **非无限滚动**: 用户需点击按钮加载更多，不是滚动触发
- **无前端缓存**: 切换 A → B → A 会重新发起 IPC 请求
- **一次加载上限 100 条**: 无法查看更早的历史消息（除非改 limit）
- **全量刷新**: 实时更新时重新获取全部 100 条，而非增量追加

---

## 2. 推荐的数据流改动

### 状态管理层级: ChatHistoryPanel 持有缓存，SessionDetail 只负责渲染

**原因:**
- `ChatHistoryPanel` 已管理 `messages` 状态和 session 切换逻辑
- 缓存需要跨 session 切换保留（A → B → A），只有父组件能做到
- `SessionDetail` 应保持纯展示职责，接收 `messages` 数组 + 加载回调

### 改动后的数据流

```
ChatHistoryPanel
├── messageCache: Map<sessionId, { messages: SessionMessage[], hasMore: boolean, oldestLoaded: number }>
├── loadInitialMessages(sessionId)    → 获取最新 N 条，存入 cache
├── loadEarlierMessages(sessionId)    → 获取更早的一批，prepend 到 cache
├── handleRealtimeUpdate(sessionId)   → 增量追加新消息到 cache 尾部
│
└── SessionDetail
    ├── messages (来自 cache)
    ├── hasMore (是否还有更早消息)
    ├── onLoadEarlier() → 触发 loadEarlierMessages
    └── 滚动到顶部时自动调用 onLoadEarlier (Virtuoso startReached)
```

### 具体改动点

#### ChatHistoryPanel 新增:
```typescript
// 缓存结构
interface SessionMessageCache {
  messages: SessionMessage[];
  hasMore: boolean;       // 是否还有更早的消息
  totalOnServer: number;  // 后端文件中消息总条数（可选，用于进度提示）
}

const messageCacheRef = useRef<Map<string, SessionMessageCache>>(new Map());
```

#### SessionDetail 接口变更:
```typescript
interface SessionDetailProps {
  messages: SessionMessage[];
  loading?: boolean;
  loadingEarlier?: boolean;   // 新增: 正在加载更早消息
  hasMore?: boolean;          // 新增: 是否有更早消息可加载
  onLoadEarlier?: () => void; // 新增: 请求加载更早消息的回调
}
```

#### SessionDetail 的 Virtuoso 配置:
```typescript
<Virtuoso
  ref={virtuosoRef}
  data={messages}
  startReached={() => hasMore && onLoadEarlier?.()}  // 自动触发加载
  firstItemIndex={firstItemIndex}  // 关键: 保持滚动位置
  initialTopMostItemIndex={messages.length - 1}
  itemContent={...}
/>
```

---

## 3. 推荐的缓存策略

### 3.1 缓存范围: 最多缓存 5 个 session

```typescript
const MAX_CACHED_SESSIONS = 5;
```

**理由:**
- 用户通常在 2~3 个 session 之间来回切换
- 5 个 session 覆盖绝大多数使用场景，同时控制内存
- LRU 策略: 当缓存第 6 个 session 时，淘汰最久未访问的

### 3.2 切换行为: A → B → A

| 场景 | 行为 |
|------|------|
| A 在缓存中 | 直接使用缓存，不发 IPC 请求 |
| A 不在缓存中（被 LRU 淘汰） | 重新加载最新 N 条 |
| 回到 A 时的滚动位置 | 回到最底部（最新消息）— 与微信一致 |

### 3.3 缓存失效: 与 onSessionUpdate 协调

```
收到 onSessionUpdate({ projectHash, sessionId })
  ├── sessionId === 当前选中的 session
  │   → 增量加载：获取最新消息追加到 cache 尾部
  │   → 方案: 对比已缓存最后一条消息的 timestamp，只请求更新的
  │
  └── sessionId !== 当前选中的 session
      └── sessionId 在缓存中
          → 标记为 stale（脏标记）
          → 下次切换到该 session 时，做增量刷新
```

**增量加载实现:**

目前后端只支持 `limit`（取最后 N 条），不支持 `after` 时间戳过滤。需要后端新增参数:

```typescript
// 后端 readSession 新增 options
interface ReadSessionOptions {
  limit?: number;
  after?: string;  // ISO timestamp, 只返回此时间之后的消息
}
```

如果不改后端，前端也可以用一个简单的 workaround: 重新获取最新 N 条，对比 uuid 去重后追加。对于实时更新场景，新消息通常只有 1~5 条，重复获取 100 条中大部分已有数据虽然浪费一些，但因为是本地 IPC + 本地文件读取，延迟很低（< 50ms），可接受。

**推荐: 短期用前端去重方案，长期加 `after` 参数优化。**

### 3.4 缓存 TTL

不需要 TTL。缓存的生命周期由两个因素控制:
1. LRU 淘汰（超过 5 个 session）
2. 切换项目时清空所有缓存（因为不同项目间几乎不会来回切换）

---

## 4. 后端分页方案（与后端专家协调）

### 当前 readSession 支持的参数:
```typescript
readSession(projectHash, sessionId, options?: { limit?: number })
```

### 需要新增的能力:

**方案 A: offset + limit（推荐）**

```typescript
readSession(projectHash, sessionId, options?: {
  limit?: number;    // 每次返回的条数，默认 50
  offset?: number;   // 从第 N 条开始（0 = 最新的）
})
```

前端第一次加载: `{ limit: 50, offset: 0 }` — 最新 50 条
用户上滑: `{ limit: 50, offset: 50 }` — 第 51~100 条
用户继续: `{ limit: 50, offset: 100 }` — 第 101~150 条

**方案 B: cursor-based（before timestamp）**

```typescript
readSession(projectHash, sessionId, options?: {
  limit?: number;
  before?: string;   // ISO timestamp, 返回此时间之前的消息
})
```

**推荐方案 A**，因为:
- JSONL 文件是有序的，offset 可以直接映射到行号
- 不需要解析 timestamp 做对比
- 后端已有 tail-read 优化，offset 可以自然扩展

### 后端还需要返回总条数

```typescript
// getSession 返回值扩展
{
  messages: SessionMessage[];
  total: number;    // 该 session 消息总条数（用于 hasMore 判断和 UI 提示）
}
```

获取 total 的方式: 可以在第一次读取时用 `wc -l` 级别的行计数（流式扫描只数行不解析），或者在 extractSessionSummary 中缓存。

---

## 5. 内存管理分析

### 消息大小估算

| 消息类型 | 平均大小 | 说明 |
|----------|----------|------|
| user 消息 | ~0.5 KB | 纯文本，通常 1-3 句话 |
| assistant 文本 | ~2-5 KB | Markdown 文本，可能较长 |
| assistant tool_use | ~1-2 KB | 工具名 + JSON 输入 |
| tool_result | ~2-10 KB | 工具输出，可能含代码片段 |
| **加权平均** | **~3 KB** | 考虑 assistant 通常含多个 block |

### 内存消耗场景

| 场景 | 消息数 | 估算内存 | 可接受？ |
|------|--------|----------|----------|
| 1 session, 50 条 | 50 | ~150 KB | 完全可以 |
| 1 session, 200 条 | 200 | ~600 KB | 完全可以 |
| 1 session, 1000 条 | 1000 | ~3 MB | 可以 |
| 5 session 缓存, 各 200 条 | 1000 | ~3 MB | 可以 |
| 5 session 缓存, 各 1000 条 | 5000 | ~15 MB | 可接受，但接近上限 |

### 内存上限策略

```typescript
const MAX_MESSAGES_PER_SESSION = 2000;  // 单 session 最多缓存 2000 条
const MAX_CACHED_SESSIONS = 5;          // 最多缓存 5 个 session
// 理论最大: 5 × 2000 × 3KB = 30 MB — 对 Electron 应用完全可接受
```

当用户在一个 session 中已加载超过 2000 条时，不再允许"加载更早"，显示提示:
"已加载 2000 条消息，更早的消息请使用导出功能查看"

实际中，绝大多数 session 消息数在 50~500 之间，极少超过 1000。30MB 是理论最大值，实际运行时内存占用通常在 3~5 MB。

---

## 6. 与微信体验的对标分析

| 微信行为 | Muxvo 当前 | 改造后 |
|----------|-----------|--------|
| 进入聊天显示最新消息 | 加载最新 100 条，显示最后 50 条 | 加载最新 50 条，直接显示 |
| 上滑自动加载更早消息 | 手动点击"加载更早消息"按钮 | **Virtuoso startReached 自动触发** |
| 加载时有 loading 指示 | 无（按钮点击瞬间扩展） | **顶部显示 spinner** |
| 已加载消息常驻内存 | 不缓存，每次切换重新加载 | **LRU 缓存 5 个 session** |
| 切换再切回保留位置 | 回到最底部（重新加载） | **回到最底部（设计选择）** |
| 新消息实时追加 | 全量重新获取 100 条 | **增量追加（去重）** |
| 加载时保持滚动位置 | N/A（前端分页展示） | **Virtuoso firstItemIndex 保持位置** |

### 为什么切换回来时回到最底部而非保留位置?

微信聊天中用户切回通常是为了看最新消息。Muxvo 的聊天历史查看器也是如此——用户切到另一个 session 又切回来，最常见的意图是查看最新内容。保留滚动位置在某些场景下有用，但实现复杂度高（需要持久化 scrollTop），且可能让用户困惑（"为什么不在最下面？"）。

---

## 7. 改造优先级和依赖关系

```
Phase 1 (核心): 前端无限滚动 + 后端分页
├── 后端: readSession 支持 offset/limit + 返回 total
├── 前端: SessionDetail 使用 Virtuoso startReached
└── 前端: ChatHistoryPanel 管理分页加载逻辑

Phase 2 (缓存): 减少重复加载
├── 前端: messageCacheRef (LRU, 5 sessions)
├── 前端: 切换 session 时优先使用缓存
└── 前端: onSessionUpdate 增量追加（前端去重方案）

Phase 3 (优化, 可选):
├── 后端: readSession 支持 after 参数（精确增量加载）
├── 前端: 加载更早消息时的 skeleton/spinner 动效
└── 前端: 内存上限提示
```

---

## 8. 关键实现细节

### Virtuoso prepend 时保持滚动位置

这是无限滚动最关键的技术点。`react-virtuoso` 原生支持 `firstItemIndex`:

```typescript
// 初始状态: firstItemIndex = 10000 (一个足够大的起始值)
// 每次 prepend N 条消息时: firstItemIndex -= N
// Virtuoso 根据 firstItemIndex 自动维持滚动位置

const START_INDEX = 100000;
const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);

// 加载更早消息后:
setFirstItemIndex(prev => prev - newMessages.length);
setMessages(prev => [...newMessages, ...prev]);
```

### 后端 total 计算的高效方案

不解析 JSON，只数行中包含 `"type":"user"` 或 `"type":"assistant"` 的行数:

```typescript
// 简单方案: 流式计数，不解析 JSON
async function countMessages(filePath: string): Promise<number> {
  let count = 0;
  const rl = createInterface({ input: createReadStream(filePath) });
  for await (const line of rl) {
    if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) {
      count++;
    }
  }
  return count;
}
```

但这对大文件仍然有 I/O 开销。更好的方案是: 第一次读取时返回 `hasMore: boolean` 而不是 `total: number`。判断方式: 如果返回的消息数 === limit 且 offset + limit < 文件估算行数，则 hasMore = true。

---

## 总结

核心改动量小而精确:
- 后端: `readSession` 新增 `offset` 参数 + 返回 `hasMore`
- 前端 `ChatHistoryPanel`: 新增 `messageCacheRef` + `loadEarlierMessages`
- 前端 `SessionDetail`: props 增加 `hasMore` + `onLoadEarlier`，Virtuoso 配置 `startReached` + `firstItemIndex`

不需要改动: 类型定义、IPC channel 定义、preload API、状态机、项目/会话列表逻辑。
