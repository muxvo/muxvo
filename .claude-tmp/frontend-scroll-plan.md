# 前端无限滚动方案分析

## 一、当前实现分析

**文件**: `src/renderer/components/chat/SessionDetail.tsx`

### 当前数据流
1. `ChatHistoryPanel` 通过 `window.api.chat.getSession(projectHash, sessionId)` **一次性加载全部消息**到 `messages` state
2. `SessionDetail` 接收完整的 `messages[]` 数组作为 props
3. 组件内部用 `visibleCount` state 控制显示数量，初始为 `MESSAGE_PAGE_SIZE = 50`
4. 从数组尾部取最后 N 条消息显示：`messages.slice(Math.max(0, messages.length - visibleCount))`
5. 顶部渲染一个"加载更早消息"按钮，点击时 `visibleCount += 50`

### 当前 Virtuoso 配置
```tsx
<Virtuoso
  ref={virtuosoRef}
  data={visibleMessages}
  components={{ Header: headerContent ? () => headerContent : undefined }}
  itemContent={(_index, message) => <MessageBubble key={message.uuid} message={message} />}
  initialTopMostItemIndex={visibleMessages.length - 1}   // 初始滚到底部
  followOutput="auto"                                     // 新消息自动跟随
  style={{ height: '100%' }}
  overscan={200}
/>
```

### 当前问题
1. **用户体验差**: 需要手动点击按钮才能加载更早消息，不符合微信/Telegram 的滚动习惯
2. **滚动位置跳动**: 点击"加载更早消息"后，`visibleMessages` 数组变化导致列表重新渲染，滚动位置可能跳动
3. **数据已在内存中**: 全部消息已通过 IPC 加载，"分页"只是前端显示层的切片，没有真正的后端分页

---

## 二、Virtuoso API 调研

### 版本
- `react-virtuoso@^4.18.1` (package.json)

### 核心 API: `startReached` + `firstItemIndex`

#### `startReached: (index: number) => void`
- **触发时机**: 用户**向上滚动到达列表顶部**时自动触发
- **参数**: 当前列表中第一个可见项的 index
- **用途**: 在此回调中发起加载更早数据的请求
- **注意**: 与 `endReached`（到底部触发）对称

#### `firstItemIndex: number`
- **默认值**: 0
- **用途**: 实现"反向无限滚动" —— 向上 prepend 数据时，**递减此值**以告知 Virtuoso 数据在顶部增加了
- **关键机制**: Virtuoso 内部用 `firstItemIndex` 计算每个 item 的虚拟位置。减少该值 = 在顶部插入新空间，Virtuoso **自动维持滚动位置不跳**
- **约束**: 必须是**正数**。推荐初始设为一个较大值（如 100000），为 prepend 留出空间

#### 滚动位置保持原理
当 `firstItemIndex` 减少 N 且 `data` 前面插入 N 条时，Virtuoso 内部：
1. 检测到 `firstItemIndex` 变化
2. 自动调整内部滚动偏移量，补偿新增内容的高度
3. 用户视觉上看到的内容**不跳动**，新内容出现在可视区域之上

这是 Virtuoso **内置支持**的功能，不需要手动调整 `scrollTop`。

#### `initialTopMostItemIndex`
- 设置初始滚动到哪个 item（当前已在使用：`visibleMessages.length - 1`）
- 在新方案中仍需保留，确保初始加载时显示最新消息（底部）

#### `followOutput`
- 当前设为 `"auto"`，当新消息追加到底部时自动滚动跟随
- 新方案中保留不变

#### `components.Header`
- 可用于渲染顶部加载 spinner
- 当 `isLoading` 时显示 spinner，否则隐藏

---

## 三、推荐方案

### 方案: Virtuoso `startReached` + `firstItemIndex` 纯前端分页

由于**全部消息已在内存中**（`ChatHistoryPanel` 一次性从 IPC 加载），不涉及后端分页。改动仅在 `SessionDetail` 组件内部。

### 伪代码

```tsx
const MESSAGE_PAGE_SIZE = 50;
const FIRST_ITEM_INDEX = 100000; // 足够大的初始虚拟索引

export function SessionDetail({ messages, loading }: SessionDetailProps) {
  const { t } = useI18n();
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // 当前已显示的消息数量（从最新往前算）
  const [displayCount, setDisplayCount] = useState(MESSAGE_PAGE_SIZE);
  // 是否正在"加载"更早消息（模拟加载延迟，防止连续触发）
  const [loadingOlder, setLoadingOlder] = useState(false);

  // 从尾部取 displayCount 条消息
  const startIndex = Math.max(0, messages.length - displayCount);
  const visibleMessages = messages.slice(startIndex);
  const hasEarlier = startIndex > 0;

  // firstItemIndex: 初始值 - 已加载条数偏移量
  // 每次 prepend 更多消息时，这个值递减
  const firstItemIndex = FIRST_ITEM_INDEX - visibleMessages.length + MESSAGE_PAGE_SIZE;

  // 当切换会话时重置
  const messageKey = messages.length > 0 ? messages[0].uuid : '';
  useEffect(() => {
    setDisplayCount(MESSAGE_PAGE_SIZE);
    setLoadingOlder(false);
  }, [messageKey]);

  // startReached: 用户滚到顶部时自动加载更早消息
  const handleStartReached = useCallback(() => {
    if (!hasEarlier || loadingOlder) return;

    setLoadingOlder(true);
    // 短暂延迟，让 spinner 可见 + 防止连续触发
    setTimeout(() => {
      setDisplayCount(prev => Math.min(prev + MESSAGE_PAGE_SIZE, messages.length));
      setLoadingOlder(false);
    }, 300);
  }, [hasEarlier, loadingOlder, messages.length]);

  // Header: 顶部 spinner 或"已加载全部"提示
  const Header = useCallback(() => {
    if (loadingOlder) {
      return (
        <div className="session-detail__loading-older">
          <span className="session-detail__spinner" />
        </div>
      );
    }
    if (!hasEarlier) {
      return (
        <div className="session-detail__all-loaded">
          {t('chat.allMessagesLoaded')}
        </div>
      );
    }
    return null;
  }, [loadingOlder, hasEarlier, t]);

  return (
    <div className="session-detail">
      <Virtuoso
        ref={virtuosoRef}
        data={visibleMessages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={visibleMessages.length - 1}
        startReached={handleStartReached}
        components={{ Header }}
        itemContent={(_index, message) => (
          <MessageBubble key={message.uuid} message={message} />
        )}
        followOutput="auto"
        style={{ height: '100%' }}
        overscan={200}
      />
    </div>
  );
}
```

### 关键改动点

| 改动 | 说明 |
|------|------|
| 删除 `<button>` "加载更早消息" | 替换为自动触发 |
| 新增 `startReached` 回调 | 用户滚到顶部时自动扩展 `displayCount` |
| 新增 `firstItemIndex` prop | 告知 Virtuoso 数据在顶部增长，保持滚动位置 |
| Header 改为 spinner | 加载中显示旋转动画，全部加载完显示提示文字 |
| 300ms 延迟 | 防抖 + 让用户感知到加载过程 |

### CSS 新增

```css
/* 顶部加载 spinner */
.session-detail__loading-older {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.session-detail__spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.session-detail__all-loaded {
  text-align: center;
  padding: 8px 0;
  font-size: 11px;
  color: var(--text-muted);
}
```

---

## 四、`firstItemIndex` 计算详解

这是方案中最关键也最容易出错的部分：

### 场景演算

假设总共 200 条消息，PAGE_SIZE = 50，FIRST_ITEM_INDEX = 100000：

| 阶段 | displayCount | visibleMessages.length | startIndex | firstItemIndex | 效果 |
|------|-------------|----------------------|------------|---------------|------|
| 初始加载 | 50 | 50 | 150 | 100000 | 显示最新 50 条，从底部开始 |
| 第一次 startReached | 100 | 100 | 100 | 99950 | 前面插入 50 条，位置不跳 |
| 第二次 startReached | 150 | 150 | 50 | 99900 | 再插入 50 条 |
| 第三次 startReached | 200 | 200 | 0 | 99850 | 全部显示，顶部显示"已加载全部" |

**核心公式**: `firstItemIndex = FIRST_ITEM_INDEX - visibleMessages.length + MESSAGE_PAGE_SIZE`

当 `visibleMessages.length` 从 50 增长到 100 时，`firstItemIndex` 从 100000 减少到 99950。Virtuoso 检测到 firstItemIndex 减少了 50，自动在顶部补偿 50 个 item 的空间，滚动位置不变。

### 替代简化方案

如果觉得 `firstItemIndex` 计算复杂，可以用更简单的方式：

```tsx
// 方案 B: 用 ref 记录 firstItemIndex，每次 prepend 时递减
const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX);

const handleStartReached = useCallback(() => {
  if (!hasEarlier || loadingOlder) return;
  setLoadingOlder(true);
  setTimeout(() => {
    const increment = Math.min(MESSAGE_PAGE_SIZE, startIndex);
    setFirstItemIndex(prev => prev - increment);
    setDisplayCount(prev => prev + increment);
    setLoadingOlder(false);
  }, 300);
}, [hasEarlier, loadingOlder, startIndex]);
```

这个方案更直观：每次 prepend N 条，`firstItemIndex` 就减 N。

---

## 五、初始加载从底部开始

当前实现已正确使用 `initialTopMostItemIndex={visibleMessages.length - 1}` 从底部开始显示。新方案保持不变。

另外 `followOutput="auto"` 确保实时更新时（`onSessionUpdate` 推送新消息）自动滚到底部。

---

## 六、潜在风险和边界情况

### 1. `startReached` 连续触发
**风险**: 如果可视区域很高、消息很短，一次 prepend 50 条可能仍不够填满视口，导致 `startReached` 立即再次触发。
**对策**:
- `loadingOlder` 锁防止并发触发
- 300ms 延迟给 Virtuoso 时间完成布局
- 如果 50 条仍不够，下一个 `startReached` 会自动加载更多

### 2. 会话切换时的 state 重置
**风险**: 切换会话时需要重置 `displayCount` 和 `firstItemIndex`。
**对策**: 已有 `messageKey` 监听 `messages[0].uuid` 变化来重置。新方案中也需要重置 `firstItemIndex`（如果使用方案 B 的 state 方式）。

### 3. 实时更新时消息追加
**风险**: `onSessionUpdate` 推送新消息时，`messages` 数组尾部增加。这不影响 `firstItemIndex`，因为 append 不改变顶部虚拟索引。
**对策**: `followOutput="auto"` 处理 append 场景，无需额外处理。

### 4. FIRST_ITEM_INDEX 耗尽
**风险**: 理论上如果有超过 100000 条消息，`firstItemIndex` 会变为负数。
**对策**: 实际上单个 Claude Code 会话不可能有 10 万条消息。即使如此，可以设 `FIRST_ITEM_INDEX = 1000000`。

### 5. `initialTopMostItemIndex` 与 `firstItemIndex` 的交互
**风险**: `initialTopMostItemIndex` 是**相对于 data 数组**的索引（0-based），不受 `firstItemIndex` 影响。
**对策**: 当前写法 `visibleMessages.length - 1` 始终正确，无需修改。

### 6. CSS margin 导致高度计算错误
**风险**: Virtuoso 文档警告，item 元素的 CSS margin 会导致 `contentRect` 测量不准确。
**现状**: 当前 `.message-bubble` 使用 `margin-bottom: 16px`，这**可能**影响滚动高度计算。
**对策**:
- 短期：观察是否有问题，Virtuoso 4.x 对此已有改善
- 长期：如有问题，将 `margin-bottom` 改为 `padding-bottom` 包裹在外层 div

### 7. 无消息 / 消息数 < PAGE_SIZE 的边界
**风险**: 如果消息总数不足 50 条，`startReached` 不应触发。
**对策**: `hasEarlier = startIndex > 0` 检查，且 `handleStartReached` 中有 `!hasEarlier` 守卫。

---

## 七、总结

| 方面 | 建议 |
|------|------|
| **核心方案** | Virtuoso `startReached` + `firstItemIndex`，纯前端分页 |
| **不使用** VirtuosoMessageList | 它是商业付费组件（`@virtuoso.dev/message-list`），需要 license |
| **改动范围** | 仅 `SessionDetail.tsx` + `SessionDetail.css` |
| **不改动** | `ChatHistoryPanel.tsx`（数据加载层不变） |
| **后续可扩展** | 若未来需要后端分页（超大会话），将 `handleStartReached` 中的同步 slice 改为异步 IPC 调用即可 |
