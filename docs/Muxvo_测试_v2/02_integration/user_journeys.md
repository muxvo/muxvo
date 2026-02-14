# Muxvo L3 集成测试用例

## 文档信息
- 基于：`01_PRD分析报告.md`
- 测试层级：L3（场景层）
- 测试实现方式：Playwright/Spectron E2E + 时间模拟
- 覆盖 6 类集成测试类型

---

## 一、完整用户旅程（5 个）

### JOURNEY_L3_01_first_time_user: 新用户首次使用完整旅程

**场景**：全新安装 Muxvo，完成引导，创建终端，使用 CC

| 步骤 | 操作 | 涉及模块 | 验证点 |
|------|------|----------|--------|
| 1 | 启动 Muxvo（首次） | APP, ONBOARD | `onboardingCompleted=false`，触发引导 |
| 2 | 完成 4 步引导 | ONBOARD | 每步页面正确展示，可前进/后退 |
| 3 | 引导完成 | ONBOARD, APP | `onboardingCompleted=true`，进入空 Grid |
| 4 | 点击"+ 新建终端" | TERM | 弹出目录选择器 |
| 5 | 选择目录，创建终端 | TERM | Grid=1x1 全屏，状态 Starting→Running |
| 6 | 在 CC 终端输入问题 | EDITOR, TERM | 富编辑器可见，Enter 发送文本到 PTY |
| 7 | CC 处理并响应 | TERM | 状态 Running→Busy→Running |
| 8 | 关闭应用 | APP | 保存 Grid 布局 + 终端列表到 config.json |
| 9 | 重新打开 Muxvo | APP, TERM | 恢复上次的终端（在记录 cwd 重启新 shell） |

**验证点**：
- 引导不再触发（状态锁定）
- 关闭→重启后 Grid 布局一致
- 终端重启后是空白 shell，不恢复旧输出

---

### JOURNEY_L3_02_daily_workflow: 日常工作流旅程

**场景**：用户日常使用 Muxvo 进行多项目开发

| 步骤 | 操作 | 涉及模块 | 验证点 |
|------|------|----------|--------|
| 1 | 启动 Muxvo（有上次会话） | APP, TERM | 恢复 3 个终端，Grid=3x1 |
| 2 | 新建第 4 个终端（同目录） | TERM | 自动归组到同目录终端旁边，Grid=2x2 |
| 3 | 双击第 1 个终端进入聚焦 | TERM | 左侧 75%，右侧栏显示其余 3 个 |
| 4 | 打开文件面板 | FILE | 右侧 320px 滑出面板，300ms 过渡 |
| 5 | 点击 .md 文件预览 | FILE | 三栏临时视图：终端/Markdown渲染/目录 |
| 6 | Esc 关闭三栏视图 | FILE, TERM | 回到三栏前的模式（聚焦模式） |
| 7 | Esc 退出聚焦模式 | TERM | 回到 2x2 平铺 |
| 8 | 打开聊天历史 | CHAT | 面板加载，显示所有项目会话 |
| 9 | 搜索关键词 | CHAT | 300ms 去抖后触发搜索，显示结果 |
| 10 | 查看某条会话详情 | CHAT, DATA | 双源读取（CC原始→镜像fallback） |

**验证点**：
- Grid 布局随终端数量正确变化
- 聚焦→文件面板→三栏→Esc 返回路径正确
- Esc 优先级：三栏(4级)→文件面板(5级)→聚焦(6级)
- 搜索去抖生效

---

### JOURNEY_L3_03_skill_lifecycle: Skill 完整生命周期旅程

**场景**：用户发现、安装、评分、发布 Skill 的完整流程

| 步骤 | 操作 | 涉及模块 | 验证点 |
|------|------|----------|--------|
| 1 | 打开 Skill 聚合浏览器 | BROWSER | 6 个来源异步加载 |
| 2 | 搜索 Skill | BROWSER | 300ms 去抖，跨源搜索结果合并 |
| 3 | 选择一个 Hook，点击安装 | INSTALL, SECURITY | 弹出安全审查对话框 |
| 4 | 查看源码，确认安装 | SECURITY, INSTALL | 状态 NotInstalled→Downloading→Installing→Installed |
| 5 | 选择一个 Skill，点击安装 | INSTALL | 直接安装（无需审查），状态变化正确 |
| 6 | 对本地 Skill 进行 AI 评分 | SCORE | 检查 CC 终端运行中→运行评分→显示结果 |
| 7 | 保存评分卡为 PNG | SCORE | 图片正确生成 |
| 8 | 生成展示页 | SHOWCASE | 从评分结果+SKILL.md 自动生成 |
| 9 | 预览并编辑展示页 | SHOWCASE | 预览↔编辑切换 |
| 10 | 发布到商城 | PUBLISH | 安全检查→填写详情→GitHub Pages |
| 11 | 分享 | PUBLISH | 7 渠道分享面板正确展示 |

**验证点**：
- Hook 安装需审查，Skill 安装直接进行
- AI 评分缓存机制生效
- 发布安全检查阻止含 API Key 的内容
- 展示页可预览后再发布

---

### JOURNEY_L3_04_config_management: 配置管理完整旅程

**场景**：用户浏览和编辑 CC 配置

| 步骤 | 操作 | 涉及模块 | 验证点 |
|------|------|----------|--------|
| 1 | 打开 ~/.claude/ 可视化浏览器 | CONFIG | 8 种资源类型卡片列表 |
| 2 | 浏览 Skills 分类 | CONFIG | 列出所有已安装 Skill |
| 3 | 预览某个 Skill 内容 | CONFIG | Markdown 渲染预览 |
| 4 | 切换到 Settings | CONFIG | settings.json 可编辑 |
| 5 | 修改 fontSize 为 16 | CONFIG | 保存成功，终端字体更新 |
| 6 | 编辑 CLAUDE.md | CONFIG | 编辑器打开，可编辑保存 |
| 7 | 外部修改 CLAUDE.md | CONFIG, DATA | chokidar 检测变化，推送 resource-change 事件 |
| 8 | 浏览器界面自动刷新 | CONFIG | 显示最新内容 |

**验证点**：
- 8 种资源类型全部可浏览
- Settings/CLAUDE.md 可编辑保存
- 文件变化实时推送

---

### JOURNEY_L3_05_rich_editor_modes: 富编辑器模式切换旅程

**场景**：用户在 CC 终端使用富编辑器，经历各种模式切换

| 步骤 | 操作 | 涉及模块 | 验证点 |
|------|------|----------|--------|
| 1 | 创建终端，CC 启动 | TERM, EDITOR | 默认 RichEditor 模式 |
| 2 | 输入多行文本 | EDITOR | Shift+Enter 换行，Enter 发送 |
| 3 | 粘贴图片 | EDITOR | 图片缩略图显示，CC: 写剪贴板→Ctrl+V |
| 4 | CC 进入 vim（ASB 信号） | EDITOR | 自动切换到 RawTerminal 模式 |
| 5 | 在 vim 中编辑 | EDITOR, TERM | 键盘直通 xterm.js |
| 6 | 退出 vim（ASB 恢复信号） | EDITOR | 自动恢复 RichEditor 模式 |
| 7 | 按 Ctrl+C | EDITOR, TERM | 穿透到终端中断进程，编辑器内容保留 |
| 8 | 手动切换到 RawTerminal | EDITOR | 快捷键切换 |
| 9 | 手动切回 RichEditor | EDITOR | 快捷键切换 |
| 10 | 关闭终端 | TERM, EDITOR | 临时图片文件被清理 |

**验证点**：
- ASB 信号 `\x1b[?1049h` / `\x1b[?1049l` 正确触发模式切换
- Ctrl+C/Z/D 穿透到终端，其他键在编辑器处理
- 图片发送走剪贴板模拟流程
- 终端关闭时临时文件清理

---

## 二、模块完整流程（8 个）

### MODULE_L3_01_terminal_lifecycle: 终端完整生命周期

**场景**：单个终端从创建到移除的完整生命周期

```
Step 1: 点击"+ 新建终端"
        → Created（灰色, 禁用输入）
        ↓
Step 2: 选择目录, spawn claude
        → Starting（黄色闪烁, "启动中..."）
        ↓
Step 3: 进程 stdout 就绪
        → Running（绿色呼吸, 输入可用）
        ↓
Step 4: CC 开始处理
        → Busy（绿色快速脉冲, "处理中..."）
        ↓
Step 5: CC 输出选项
        → WaitingInput（琥珀色呼吸, 显示选项）
        ↓
Step 6: 用户点击关闭
        → Stopping（灰色闪烁, "正在关闭..."）
        ↓
Step 7: 进程退出 code=0
        → Stopped（灰色, 禁用）→ Removed
```

验证点：每种状态的颜色、动画、输入栏状态正确

---

### MODULE_L3_02_chat_history_flow: 聊天历史完整流程

```
Step 1: 打开聊天历史面板
        → Closed→Loading→Ready
        ↓
Step 2: 搜索关键词
        → Ready(EmptySearch→Searching→Results)
        ↓
Step 3: 300ms 去抖触发搜索
        ↓
Step 4: 点击某条会话
        → SessionDetail（双源读取）
        ↓
Step 5: CC 原始文件不可读
        → 自动切换到 Muxvo 镜像（无感知）
        ↓
Step 6: 导出会话
        → Markdown 格式导出
```

---

### MODULE_L3_03_file_browse_edit: 文件浏览编辑完整流程

```
Step 1: 点击文件图标 → 文件面板滑出（300ms 过渡）
Step 2: 浏览目录树 → 点击 .md 文件
Step 3: 进入三栏临时视图 → 左栏终端/中栏Markdown渲染/右栏目录
Step 4: 切换到编辑模式 → 修改内容
Step 5: 保存 → 文件写入成功
Step 6: Esc 退出三栏 → 回到之前的视图模式
```

验证点：
- 面板过渡动画 300ms
- 三栏宽度（左250px, 右280px）可拖拽调整
- 编辑未保存时 Esc 弹出确认对话框
- 保存后 chokidar 检测变化

---

### MODULE_L3_04_skill_install_flow: Skill 安装完整流程

```
Step 1: 在浏览器中选择 Skill → 点击"安装"
Step 2: 按钮变为"下载中..." + 进度条
        → NotInstalled→Downloading
Step 3: 下载完成，开始安装
        → Downloading→Installing
Step 4: 安装完成
        → Installing→Installed（绿色"已安装"按钮）
Step 5: hover 按钮 → 显示"卸载"
Step 6: 点击"卸载" → 确认 → NotInstalled
```

---

### MODULE_L3_05_hook_install_flow: Hook 安装完整流程（含安全审查）

```
Step 1: 在浏览器中选择 Hook → 点击"安装"
Step 2: 弹出安全审查对话框
        → 显示触发事件 + 执行命令 + 源码
Step 3: 展开源码 → 风险关键词高亮
Step 4: 用户点击"确认安装"
        → SecurityReview→Installing→Installed
```

---

### MODULE_L3_06_scoring_flow: AI 评分完整流程

```
Step 1: 选中本地 Skill → 点击"AI 评分"
Step 2: 检查缓存 → 缓存 miss（内容 hash 不匹配）
Step 3: 检查 CC 终端运行中 → 运行评分 Skill
        → NotScored→Scoring
Step 4: 评分完成 → 显示雷达图 + 总分 + 等级
        → Scored
Step 5: 验证后处理：总分 = 加权平均（容差 +-2）
Step 6: 缓存评分结果 → 关联内容 hash
Step 7: 再次评分同一 Skill（内容未变）→ 直接返回缓存
```

---

### MODULE_L3_07_showcase_publish_flow: 展示页发布完整流程

```
Step 1: 有评分结果 → 点击"生成展示页"
        → NotGenerated→Generating
Step 2: 生成完成 → 进入预览
        → Previewing
Step 3: 切换到编辑 → 修改内容
        → Editing
Step 4: 切回预览确认 → 点击"发布"
        → Publishing
Step 5: 安全检查通过 → GitHub Pages 发布
        → Published
Step 6: 弹出分享面板 → 7 渠道选择
```

---

### MODULE_L3_08_oauth_login_flow: GitHub OAuth 登录完整流程

```
Step 1: 用户点击"GitHub 登录"
        → LoggedOut→Authorizing
Step 2: 生成 code_verifier + code_challenge
Step 3: 启动本地 HTTP 服务器 → 打开系统浏览器
Step 4: GitHub 回调 → 携带 authorization_code
Step 5: 用 code + code_verifier 换取 access_token
Step 6: 存储到 Electron safeStorage
        → LoggedIn
Step 7: 关闭本地 HTTP 服务器 → 显示用户头像
```

---

## 三、跨模块联动（6 个）

### CROSS_L3_01_terminal_create_triggers: 新建终端触发多模块更新

**触发操作**：用户新建第 5 个终端

**联动验证**：

| 模块 | 预期变化 | 验证方式 |
|------|----------|----------|
| TERM | 新终端 Tile 创建，状态 Created→Starting→Running | 检查 Tile 状态点颜色 |
| TERM | Grid 重新计算：5 个→上 3 下 2 | 检查 CSS Grid 布局 |
| TERM | 同目录归组：排列到同目录终端旁边 | 检查 Tile 顺序 |
| DATA | 开始监听新终端的 CC 数据目录 | chokidar watch 被调用 |
| EDITOR | 新终端默认 RichEditor 模式 | 检查编辑器可见性 |

---

### CROSS_L3_02_terminal_close_triggers: 关闭终端触发多模块更新

**触发操作**：关闭第 3 个终端（共 4 个→3 个）

**联动验证**：

| 模块 | 预期变化 | 验证方式 |
|------|----------|----------|
| TERM | 终端进程 Stopping→Stopped→Removed | 状态点变化 |
| TERM | Grid 重新计算：4 个→3 个（2x2→3x1） | CSS Grid 变化 |
| EDITOR | 临时图片文件清理 | 临时文件不存在 |
| DATA | 停止监听该终端的 CC 数据目录 | chokidar unwatch |
| PERF | 缓冲区资源释放 | 内存使用下降 |

---

### CROSS_L3_03_file_change_triggers: 文件变化触发多模块联动

**触发操作**：CC 写入新的聊天记录到 JSONL 文件

**联动验证**：

| 模块 | 预期变化 | 验证方式 |
|------|----------|----------|
| DATA | chokidar 检测到文件变化 | change 事件触发 |
| DATA | 延迟 200ms 后读取文件 | 读取时间 >= change时间+200ms |
| DATA | 镜像同步：复制到 Muxvo 目录 | 镜像文件存在且内容一致 |
| CHAT | 搜索索引增量更新 | 新内容可被搜索到 |
| CHAT | 面板显示新会话 | session-update push 触发 |

---

### CROSS_L3_04_install_triggers: Skill 安装触发多模块联动

**触发操作**：安装一个新 Skill

**联动验证**：

| 模块 | 预期变化 | 验证方式 |
|------|----------|----------|
| INSTALL | 状态 NotInstalled→Installed | 按钮变为"已安装" |
| INSTALL | 注册表 marketplace.json 更新 | 文件内容包含新 Skill |
| BROWSER | 浏览器中该 Skill 状态更新 | 显示"已安装"标签 |
| CONFIG | ~/.claude/ 目录新增文件 | 文件存在 |
| CONFIG | resource-change 推送 | 配置浏览器可见新资源 |

---

### CROSS_L3_05_score_to_showcase: 评分结果驱动展示页生成

**触发操作**：AI 评分完成后点击"生成展示页"

**联动验证**：

| 模块 | 预期变化 | 验证方式 |
|------|----------|----------|
| SCORE | 评分结果缓存 | get-cached 返回结果 |
| SHOWCASE | 展示页自动填充评分数据 | 雷达图 + 总分 + 等级 |
| SHOWCASE | SKILL.md 内容提取到展示页 | 描述/用法/示例 |
| SHOWCASE | OG Card 自动生成 | meta 标签正确 |

---

### CROSS_L3_06_esc_priority_chain: Esc 键优先级链完整验证

**触发操作**：从最深层依次 Esc

```
初始状态: 平铺模式 + 聚焦 + 文件面板 + 三栏视图 + Skill 浏览器 + 安全审查对话框

Step 1: Esc → 关闭安全审查对话框（优先级 1）
Step 2: Esc → 关闭文件夹选择器（优先级 2）— 如果打开
Step 3: Esc → 关闭 Skill 浏览器（优先级 3）
Step 4: Esc → 关闭三栏临时视图（优先级 4）
Step 5: Esc → 关闭文件面板（优先级 5）
Step 6: Esc → 退出聚焦模式（优先级 6）
Step 7: Esc → 平铺模式（无操作）（优先级 7）
```

验证点：每次 Esc 只关闭当前最高优先级层，不影响其他层

---

## 四、数据一致性（4 个）

### CONSIST_L3_01_chat_sync_consistency: 聊天历史同步一致性

| 测试场景 | 操作 | 验证点 |
|----------|------|--------|
| CC 写入新会话 | CC 在终端中完成一轮对话 | 镜像文件与 CC 原始文件内容一致 |
| CC 删除会话文件 | 手动删除 CC 侧 JSONL | Muxvo 镜像保留（仅同步不删除） |
| sessionId 去重 | 两个文件含相同 sessionId | 只保留一份，不重复显示 |
| mtime 精度 | 同一秒内修改文件 | `Math.floor(mtimeMs/1000)` 比较，同秒视为未变 |

---

### CONSIST_L3_02_config_persistence: 配置持久化一致性

| 测试场景 | 操作 | 验证点 |
|----------|------|--------|
| Grid 布局保存 | 关闭 3 终端 2x2 布局应用 | config.json 包含正确的 openTerminals 和 Grid 信息 |
| 列宽比例保存 | 拖拽调整列宽后关闭 | columnRatios/rowRatios 正确持久化 |
| 重启恢复 | 重新打开 Muxvo | 终端数量、Grid 布局、列宽比例与关闭前一致 |
| 偏好设置保存 | 修改 fontSize 为 16 | preferences.json 更新，重启后生效 |

---

### CONSIST_L3_03_install_registry: 安装注册表一致性

| 测试场景 | 操作 | 验证点 |
|----------|------|--------|
| 安装后注册 | 安装 Skill | marketplace.json 新增记录，包含版本/来源/安装时间 |
| 卸载后清除 | 卸载 Skill | marketplace.json 移除记录，本地文件删除 |
| 更新后版本 | 更新 Skill | marketplace.json 版本号更新，旧版本覆盖 |
| 浏览器状态同步 | 安装/卸载 | 浏览器中对应 Skill 的按钮状态实时变化 |

---

### CONSIST_L3_04_score_cache_consistency: 评分缓存一致性

| 测试场景 | 操作 | 验证点 |
|----------|------|--------|
| 首次评分 | 评分 Skill A | 结果缓存 + 内容 hash 记录 |
| 内容未变 | 再次评分 Skill A | 直接返回缓存，不调用 CC |
| 内容变更 | 修改 SKILL.md 后评分 | 重新评分（hash 不匹配），新结果覆盖旧缓存 |
| promptVersion 变更 | 更新评分 Skill 版本 | 所有旧缓存失效，需重新评分 |

---

## 五、边界时间测试（8 个）

### TIME_L3_01_jsonl_read_delay: JSONL 读取延迟边界

**时间点**：文件变化检测后的 200ms 延迟

| 测试场景 | 时间 | 操作 | 预期结果 |
|----------|------|------|----------|
| 延迟前读取 | 变化后 <200ms | 触发读取 | 读到旧内容或部分内容 |
| 延迟后读取 | 变化后 >=200ms | 触发读取 | 读到完整新内容 |
| 连续变化 | 200ms 内多次变化 | 观察行为 | 仅最后一次触发读取 |

---

### TIME_L3_02_search_debounce: 搜索去抖边界

**时间点**：300ms 去抖

| 测试场景 | 时间间隔 | 操作 | 预期结果 |
|----------|----------|------|----------|
| 快速输入 | 每字 <300ms | 连续输入 5 个字符 | 仅最后一次触发搜索 |
| 慢速输入 | 每字 >300ms | 逐字输入 3 个字符 | 每个字符都触发搜索 |
| 边界值 | 恰好 300ms | 输入后等待 300ms | 触发搜索 |

---

### TIME_L3_03_file_panel_transition: 文件面板过渡边界

**时间点**：300ms CSS 过渡动画

| 测试场景 | 时间 | 操作 | 预期结果 |
|----------|------|------|----------|
| 过渡中点击 | <300ms | 点击面板内容 | 无响应或排队到动画完成 |
| 过渡完成 | >=300ms | 点击面板内容 | 正常响应 |
| 快速开关 | 打开后立即关闭 | 连续点击 | 动画不卡顿 |

---

### TIME_L3_04_update_check_interval: 更新检测间隔边界

**时间点**：启动时 + 每 6 小时

| 测试场景 | 时间 | 操作 | 预期结果 |
|----------|------|------|----------|
| 启动时检测 | 应用启动 | 自动触发 | 检测一次更新 |
| 6 小时后 | 启动后 6h | 等待 | 自动触发第二次检测 |
| 6 小时内 | 启动后 <6h | 观察 | 不触发额外检测 |

---

### TIME_L3_05_memory_check: 内存检查间隔边界

**时间点**：每 60 秒

| 测试场景 | 时间 | 操作 | 预期结果 |
|----------|------|------|----------|
| 60s 检查 | 启动后 60s | 观察 | 触发内存检查 |
| 超 2GB | 内存 >2GB 时 | 下次检查 | 菜单栏显示黄色警告图标 |
| 恢复正常 | 内存降到 <2GB | 下次检查 | 黄色警告消失 |

---

### TIME_L3_06_process_stop_timeout: 进程关闭超时边界

**时间点**：5 秒超时

| 测试场景 | 时间 | 操作 | 预期结果 |
|----------|------|------|----------|
| 正常退出 | <5s | 发送关闭 | Stopping→Stopped |
| 超时未退出 | >=5s | 发送关闭但进程不响应 | Stopping→Disconnected |
| 恰好 5s | =5s | 发送关闭 | 触发超时→Disconnected |

---

### TIME_L3_07_watch_retry_interval: 文件监听重试间隔

**时间点**：3 秒间隔，最多 3 次

| 测试场景 | 重试次数 | 操作 | 预期结果 |
|----------|----------|------|----------|
| 首次失败 | 1 | watch 失败 | 3s 后自动重试 |
| 连续失败 | 3 | watch 连续失败 | 3次后停止重试，状态 WatchError |
| 重试成功 | 2 | 第 2 次成功 | 恢复 Watching 状态 |

---

### TIME_L3_08_temp_file_cleanup: 临时文件清理时间边界

**时间点**：终端关闭时 / 24 小时后

| 测试场景 | 触发条件 | 操作 | 预期结果 |
|----------|----------|------|----------|
| 终端关闭 | 关闭含图片的终端 | 检查临时文件 | 文件已删除 |
| 24h 自动清理 | 临时文件存在 >24h | 等待 | 自动清理 |
| 未到 24h | 临时文件存在 <24h | 观察 | 文件保留 |

---

## 六、异常恢复（6 个）

### RECOVER_L3_01_terminal_reconnect: 终端异常断开后重连

```
Step 1: 终端运行中，进程异常退出（exit code != 0）
        → Running→Disconnected（红色状态点）
Step 2: 显示"已断开"状态
        → 输入栏禁用，显示"已断开"
Step 3: 用户点击"重新连接"
        → Disconnected→Starting
Step 4: 新进程启动成功
        → Starting→Running（绿色状态点）
```

验证点：重连后是新进程，不恢复旧内容

---

### RECOVER_L3_02_install_failure_retry: 安装失败后重试

```
Step 1: 安装 Skill，网络中断
        → Downloading→InstallFailed
Step 2: 按钮变为"重试安装"（红色描边）
Step 3: 网络恢复，用户点击重试
        → InstallFailed→Downloading→Installing→Installed
```

---

### RECOVER_L3_03_watch_error_recovery: 文件监听错误恢复

```
Step 1: 文件监听启动
        → Inactive→Watching
Step 2: 监听目录被删除
        → Watching→WatchError
Step 3: 自动重试（3s interval, max 3）
Step 4: 目录恢复，第 2 次重试成功
        → WatchError→Watching
```

---

### RECOVER_L3_04_score_failure_retry: 评分失败后重试

```
Step 1: 触发 AI 评分
        → NotScored→Scoring
Step 2: CC 终端超时
        → Scoring→ScoreFailed
Step 3: 用户点击重试（第 1 次）
        → ScoreFailed→Scoring
Step 4: 再次失败（第 2 次）
Step 5: 再次失败（第 3 次）
Step 6: 显示最终错误 + 手动重试按钮
        → 超过 3 次限制
```

---

### RECOVER_L3_05_sync_interruption: 同步中断恢复

```
Step 1: 聊天历史同步进行中
Step 2: 某个文件被锁定
        → 跳过该文件，继续同步其他文件
Step 3: 下次同步周期
        → 重试之前跳过的文件
Step 4: 文件锁释放
        → 同步成功
```

验证点：锁定文件不阻塞整体同步

---

### RECOVER_L3_06_partial_source_degradation: 部分源加载失败降级

```
Step 1: 打开 Skill 浏览器，6 个来源开始加载
Step 2: 其中 2 个来源超时
        → Loading→PartialReady（显示 4 个来源的结果 + 2 个错误提示）
Step 3: 用户浏览已加载的 Skill
        → 正常使用
Step 4: 失败源自动重试成功
        → PartialReady→Ready（显示全部 6 个来源）
```

---

## 附录 I：集成测试覆盖矩阵

### 设计依据
- PRD 版本：V2.0
- 识别的主要流程：11 个（PRD 第 5 节流程图）
- 识别的时间点：8 个
- 识别的可中断流程：6 个

### 覆盖统计

| 集成测试类型 | 覆盖规则 | 应有数量 | 实际数量 | 状态 |
|--------------|----------|----------|----------|------|
| 完整用户旅程 | 5 个主要功能 | 5 | 5 | ✅ |
| 模块完整流程 | 8 个核心模块 | 8 | 8 | ✅ |
| 跨模块联动 | 6 个副作用操作 | 6 | 6 | ✅ |
| 数据一致性 | 4 个同步点 | 4 | 4 | ✅ |
| 边界时间测试 | 8 个时间点 | 8 | 8 | ✅ |
| 异常恢复 | 6 个可中断流程 | 6 | 6 | ✅ |
| **总计** | | **37** | **37** | ✅ |

### 用例清单

| 用例编号 | 类型 | 场景描述 | 涉及模块 |
|----------|------|----------|----------|
| JOURNEY_L3_01 | 完整用户旅程 | 新用户首次使用 | APP, ONBOARD, TERM, EDITOR |
| JOURNEY_L3_02 | 完整用户旅程 | 日常工作流 | APP, TERM, FILE, CHAT, DATA |
| JOURNEY_L3_03 | 完整用户旅程 | Skill 完整生命周期 | BROWSER, INSTALL, SECURITY, SCORE, SHOWCASE, PUBLISH |
| JOURNEY_L3_04 | 完整用户旅程 | 配置管理 | CONFIG, DATA |
| JOURNEY_L3_05 | 完整用户旅程 | 富编辑器模式切换 | EDITOR, TERM |
| MODULE_L3_01 | 模块完整流程 | 终端生命周期 | TERM |
| MODULE_L3_02 | 模块完整流程 | 聊天历史流程 | CHAT, DATA |
| MODULE_L3_03 | 模块完整流程 | 文件浏览编辑 | FILE |
| MODULE_L3_04 | 模块完整流程 | Skill 安装流程 | INSTALL |
| MODULE_L3_05 | 模块完整流程 | Hook 安装流程 | INSTALL, SECURITY |
| MODULE_L3_06 | 模块完整流程 | AI 评分流程 | SCORE |
| MODULE_L3_07 | 模块完整流程 | 展示页发布流程 | SHOWCASE, PUBLISH |
| MODULE_L3_08 | 模块完整流程 | OAuth 登录流程 | AUTH |
| CROSS_L3_01 | 跨模块联动 | 新建终端触发多更新 | TERM, DATA, EDITOR |
| CROSS_L3_02 | 跨模块联动 | 关闭终端触发多更新 | TERM, EDITOR, DATA, PERF |
| CROSS_L3_03 | 跨模块联动 | 文件变化触发多联动 | DATA, CHAT |
| CROSS_L3_04 | 跨模块联动 | Skill 安装触发多联动 | INSTALL, BROWSER, CONFIG |
| CROSS_L3_05 | 跨模块联动 | 评分驱动展示页 | SCORE, SHOWCASE |
| CROSS_L3_06 | 跨模块联动 | Esc 优先级链 | TERM, FILE, BROWSER, SECURITY |
| CONSIST_L3_01 | 数据一致性 | 聊天历史同步 | CHAT, DATA |
| CONSIST_L3_02 | 数据一致性 | 配置持久化 | APP, TERM |
| CONSIST_L3_03 | 数据一致性 | 安装注册表 | INSTALL, BROWSER |
| CONSIST_L3_04 | 数据一致性 | 评分缓存 | SCORE |
| TIME_L3_01 | 边界时间 | JSONL 读取延迟 | DATA |
| TIME_L3_02 | 边界时间 | 搜索去抖 | CHAT |
| TIME_L3_03 | 边界时间 | 文件面板过渡 | FILE |
| TIME_L3_04 | 边界时间 | 更新检测间隔 | INSTALL |
| TIME_L3_05 | 边界时间 | 内存检查间隔 | PERF |
| TIME_L3_06 | 边界时间 | 进程关闭超时 | TERM |
| TIME_L3_07 | 边界时间 | 文件监听重试 | DATA |
| TIME_L3_08 | 边界时间 | 临时文件清理 | EDITOR |
| RECOVER_L3_01 | 异常恢复 | 终端断开重连 | TERM |
| RECOVER_L3_02 | 异常恢复 | 安装失败重试 | INSTALL |
| RECOVER_L3_03 | 异常恢复 | 文件监听恢复 | DATA |
| RECOVER_L3_04 | 异常恢复 | 评分失败重试 | SCORE |
| RECOVER_L3_05 | 异常恢复 | 同步中断恢复 | DATA |
| RECOVER_L3_06 | 异常恢复 | 部分源降级 | BROWSER |

### 跨模块依赖图

```
终端操作
    ├── TERM：Grid 布局重算
    ├── TERM：自动归组
    ├── EDITOR：富编辑器模式管理
    ├── DATA：文件监听启停
    └── PERF：缓冲区资源管理

文件变化
    ├── DATA：chokidar 检测 + 200ms 延迟
    ├── DATA：镜像同步（仅同步不删除）
    ├── CHAT：索引增量更新
    └── CONFIG：resource-change 推送

Skill 安装
    ├── INSTALL：状态机流转
    ├── SECURITY：Hook 安全审查（分支）
    ├── BROWSER：状态标签更新
    └── CONFIG：资源变化推送

评分→发布链
    ├── SCORE：AI 评分 + 缓存
    ├── SHOWCASE：展示页生成
    ├── PUBLISH：安全检查 + 发布
    └── AUTH：GitHub OAuth（发布前置）
```

---

## 集成测试设计完成确认

- [x] 已识别 PRD 中所有多步骤流程（11 个流程图）
- [x] 6 类集成测试每类都有用例
- [x] 跨模块联动已画出依赖图
- [x] 边界时间测试覆盖所有时间点（8 个）
- [x] 已输出"附录 I：集成测试覆盖矩阵"
- [x] 集成测试总数 = 37 ≥ 20 ✅

---

## 用例统计

| 类型 | 数量 |
|------|------|
| 完整用户旅程 | 5 |
| 模块完整流程 | 8 |
| 跨模块联动 | 6 |
| 数据一致性 | 4 |
| 边界时间测试 | 8 |
| 异常恢复 | 6 |
| **L3 总计** | **37** |

| 优先级 | 数量 |
|--------|------|
| P0 | 5（JOURNEY 1-3, MODULE 1, CROSS 1） |
| P1 | 18（MODULE 2-8, CROSS 2-6, CONSIST 1-2） |
| P2 | 14（CONSIST 3-4, TIME 1-8, RECOVER 1-6） |
