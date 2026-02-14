# Muxvo 完整测试用例手册 v1.0 — 索引

## 文档信息
- 项目：Muxvo（Electron 桌面工作台 for AI CLI 工具）
- PRD 版本：V2.0（3064 行）
- 生成日期：2026-02-14
- 生成工具：prd-to-test-2-generate Skill
- 基于：`01_PRD分析报告.md`

---

## 文件结构

```
docs/Muxvo_测试_v2/
├── 01_PRD分析报告.md              ← Phase 1 输出
├── 02_INDEX.md                    ← 本文件（用例索引 + 统计）
├── 02_modules/
│   ├── test_TERM.md               ← 终端管理（103 个用例）
│   ├── test_EDITOR.md             ← 富编辑器覆盖层（52 个用例）
│   ├── test_CHAT.md               ← 聊天历史（61 个用例）
│   ├── test_FILE_CONFIG.md        ← 文件浏览 + 配置管理（90 个用例）
│   ├── test_DATA.md               ← 数据同步（19 个用例）
│   ├── test_V2_INSTALL.md         ← Skill 浏览/安装/安全审查（51 个用例）
│   ├── test_V2_CONTENT.md         ← 评分/展示页/发布/社区/认证（76 个用例）
│   └── test_CROSS.md              ← 应用/引导/性能/异常（50 个用例）
├── 02_integration/
│   └── user_journeys.md           ← L3 集成测试（37 个用例）
├── 02_appendix/
│   └── coverage.md                ← 附录（覆盖矩阵 + 测试数据）
└── 03_检查补充报告.md             ← Phase 3 输出（待生成）
```

---

## 用例统计汇总

### 按层级

| 层级 | 名称 | 用例数 | 占比 |
|------|------|--------|------|
| L1 | 契约层（IPC 格式 + 默认值） | 155 | 28.8% |
| L2 | 规则层（状态机 + 边界值 + 业务规则） | 347 | 64.4% |
| L3 | 场景层（集成测试 + 用户旅程） | 37 | 6.9% |
| **总计** | | **539** | **100%** |

### 按模块

| 模块 | 描述 | L1 | L2 | L3 相关 | 小计(L1+L2) | 文件 |
|------|------|----|----|---------|-------------|------|
| TERM | 终端管理 | 15 | 88 | 8 | 103 | test_TERM.md |
| CHAT | 聊天历史 | 27 | 34 | 5 | 61 | test_CHAT.md |
| EDITOR | 富编辑器 | 8 | 44 | 4 | 52 | test_EDITOR.md |
| FILE | 文件浏览 | 32 | 18 | 4 | 50 | test_FILE_CONFIG.md |
| CONFIG | 配置管理 | 27 | 13 | 3 | 40 | test_FILE_CONFIG.md |
| INSTALL | 安装/更新 | 5 | 20 | 5 | 25 | test_V2_INSTALL.md |
| BROWSER | Skill 浏览器 | 4 | 12 | 3 | 16 | test_V2_INSTALL.md |
| SECURITY | Hook 安全审查 | 2 | 8 | 3 | 10 | test_V2_INSTALL.md |
| SCORE | AI 评分 | 3 | 15 | 4 | 18 | test_V2_CONTENT.md |
| SHOWCASE | 展示页 | 3 | 14 | 3 | 17 | test_V2_CONTENT.md |
| PUBLISH | 发布/分享 | 4 | 17 | 3 | 21 | test_V2_CONTENT.md |
| COMMUNITY | 社区平台 | 3 | 9 | 1 | 12 | test_V2_CONTENT.md |
| AUTH | 认证授权 | 3 | 5 | 2 | 8 | test_V2_CONTENT.md |
| DATA | 数据同步 | 7 | 12 | 6 | 19 | test_DATA.md |
| APP | 应用生命周期 | 5 | 7 | 4 | 12 | test_CROSS.md |
| ONBOARD | 首次引导 | 2 | 8 | 2 | 10 | test_CROSS.md |
| PERF | 性能策略 | 2 | 10 | 3 | 12 | test_CROSS.md |
| ERROR | 异常处理 | 3 | 13 | 2 | 16 | test_CROSS.md |

### 按优先级

| 优先级 | L1+L2 用例数 | L3 用例数 | 合计 | 含义 |
|--------|-------------|-----------|------|------|
| P0 | ~150 | 5 | ~155 | 核心流程（不通过则系统不可用） |
| P1 | ~210 | 18 | ~228 | 重要功能（影响用户体验） |
| P2 | ~142 | 14 | ~156 | 场景测试（边界/异常/旅程） |

### 按功能版本

| 版本 | 模块 | L1+L2 用例数 |
|------|------|-------------|
| V1 — 终端工作台 | TERM, EDITOR, CHAT, FILE, CONFIG | 306 |
| V2 — Skill Showcase | BROWSER, INSTALL, SECURITY, SCORE, SHOWCASE, PUBLISH, COMMUNITY, AUTH | 127 |
| 跨功能 | APP, DATA, ONBOARD, PERF, ERROR | 69 |

---

## 附录 A：用例索引

> 此索引为 test-from-doc 的解析入口，包含所有用例。

### TERM 模块（103 个用例）— test_TERM.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| TERM_L1_01_ipc_create | L1 | P0 | terminal:create IPC 消息格式 |
| TERM_L1_02_ipc_write | L1 | P0 | terminal:write IPC 消息格式 |
| TERM_L1_03_ipc_resize | L1 | P0 | terminal:resize IPC 消息格式 |
| TERM_L1_04_ipc_close | L1 | P0 | terminal:close IPC 消息格式 |
| TERM_L1_05_ipc_output | L1 | P0 | terminal:output(push) 推送格式 |
| TERM_L1_06_ipc_state_change | L1 | P0 | terminal:state-change(push) 推送格式 |
| TERM_L1_07_ipc_exit | L1 | P0 | terminal:exit(push) 推送格式 |
| TERM_L1_08_default_window | L1 | P1 | 默认窗口尺寸 1400x900 |
| TERM_L1_09_default_font | L1 | P1 | 默认 fontSize=14 |
| TERM_L1_10_default_theme | L1 | P1 | 默认 theme=dark |
| TERM_L1_11_default_name | L1 | P1 | 新终端默认无名称（灰色斜体占位符） |
| TERM_L1_12_default_column_ratios | L1 | P1 | 默认 columnRatios=[1,1] 等分 |
| TERM_L1_13_default_row_ratios | L1 | P1 | 默认 rowRatios=[1,1] 等分 |
| TERM_L1_14_default_tile_border | L1 | P1 | 默认 border=var(--border) |
| TERM_L1_15_default_tile_opacity | L1 | P1 | 默认 opacity=1 |
| TERM_L2_01~TERM_L2_88 | L2 | P0-P2 | Grid 布局(11) + 进程状态机(16) + 视图模式(11) + Esc 优先级(8) + Tile CSS(5) + 聚焦模式(5) + 命名(9) + 边框调整(5) + 归组(3) + 特殊规则(15) |

### EDITOR 模块（52 个用例）— test_EDITOR.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| EDITOR_L1_01~08 | L1 | P0-P1 | IPC 格式（文本发送/图片/剪贴板/模式切换/默认值） |
| EDITOR_L2_01~44 | L2 | P0-P2 | 状态机(11) + 按键穿透(8) + 文本转发(8) + 图片发送(7) + 自动检测(4) + 临时清理(3) + UI映射(3) |

### CHAT 模块（61 个用例）— test_CHAT.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| CHAT_L1_01~27 | L1 | P0-P1 | IPC 格式（面板/会话/搜索/导出/推送/布局） |
| CHAT_L2_01~34 | L2 | P0-P2 | 状态机(10) + 双源读取(4) + JSONL 解析(5) + 搜索规则(6) + mtime 同步(3) + 特殊规则(6) |

### FILE 模块（50 个用例）— test_FILE_CONFIG.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| FILE_L1_01~32 | L1 | P0-P1 | IPC 格式（目录读取/文件读写/监听/选择/临时文件） |
| FILE_L2_01~18 | L2 | P0-P2 | 状态机(3个：面板/三栏/目录切换) + 尺寸规则 + Markdown 预览 + 编辑保存 |

### CONFIG 模块（40 个用例）— test_FILE_CONFIG.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| CONFIG_L1_01~27 | L1 | P1 | IPC 格式（资源列表/内容/设置/CLAUDE.md/memory/推送） |
| CONFIG_L2_01~13 | L2 | P1-P2 | 状态机 + 8 种资源类型 + 编辑保存 + 搜索 |

### BROWSER 模块（16 个用例）— test_V2_INSTALL.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| BROWSER_L1_01~04 | L1 | P1 | IPC 格式（来源获取/搜索/详情/标签） |
| BROWSER_L2_01~12 | L2 | P0-P2 | 状态机(6: Loading/Ready/PartialReady/LoadError) + 去抖 + 排序 + 筛选 + 降级 |

### INSTALL 模块（25 个用例）— test_V2_INSTALL.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| INSTALL_L1_01~05 | L1 | P0-P1 | IPC 格式（安装/卸载/状态/更新检测/进度推送） |
| INSTALL_L2_01~20 | L2 | P0-P2 | 状态机(10: 安装链路) + 更新检测 + 批量更新 + 版本冲突 + UI 映射 |

### SECURITY 模块（10 个用例）— test_V2_INSTALL.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| SECURITY_L1_01~02 | L1 | P0 | 审查对话框 IPC 格式 |
| SECURITY_L2_01~08 | L2 | P0-P1 | 审查流程 + 风险关键词高亮 + 用户选择 + 分支处理 |

### SCORE 模块（18 个用例）— test_V2_CONTENT.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| SCORE_L1_01~03 | L1 | P1 | IPC 格式（评分/检查/缓存/推送） |
| SCORE_L2_01~15 | L2 | P1-P2 | 状态机(5) + 评分维度(6维) + 等级制 + 缓存机制 + 后处理验证 + 安全防护 + 重试 |

### SHOWCASE 模块（17 个用例）— test_V2_CONTENT.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| SHOWCASE_L1_01~03 | L1 | P2 | IPC 格式（生成/发布/取消发布） |
| SHOWCASE_L2_01~14 | L2 | P1-P2 | 状态机(8) + 模板 + OG Card + 图片限制 |

### PUBLISH 模块（21 个用例）— test_V2_CONTENT.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| PUBLISH_L1_01~04 | L1 | P2 | IPC 格式 |
| PUBLISH_L2_01~17 | L2 | P1-P2 | 安全检查(4: API Key/路径/文件/大小) + 发布流程 + 分享(7渠道) + 版本管理 + 名称冲突 |

### COMMUNITY 模块（12 个用例）— test_V2_CONTENT.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| COMMUNITY_L1_01~03 | L1 | P2 | IPC 格式 |
| COMMUNITY_L2_01~09 | L2 | P2 | Feed 流 + 点赞/评论 + 排行榜 + 个人主页 |

### AUTH 模块（8 个用例）— test_V2_CONTENT.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| AUTH_L1_01~03 | L1 | P2 | IPC 格式（登录/登出/状态） |
| AUTH_L2_01~05 | L2 | P2 | 状态机(3) + OAuth PKCE + Token 过期/取消 |

### APP 模块（12 个用例）— test_CROSS.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| APP_L1_01~05 | L1 | P0-P1 | IPC 格式（配置/偏好/内存警告/CLI检测） |
| APP_L2_01~07 | L2 | P0-P1 | 状态机(6: 启动→恢复→运行→保存→关闭) + 默认配置 + 分析数据保留 |

### DATA 模块（19 个用例）— test_DATA.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| DATA_L1_01~07 | L1 | P0 | IPC 格式（监听启停/事件推送/同步状态） |
| DATA_L2_01~12 | L2 | P0-P1 | 状态机(5: 监听) + 同步规则 + JSONL并发读取 + 文件锁处理 |

### ONBOARD 模块（10 个用例）— test_CROSS.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| ONBOARD_L1_01~02 | L1 | P1 | 引导步骤格式 |
| ONBOARD_L2_01~08 | L2 | P1-P2 | 4步引导 + 跳过 + 状态锁定（完成后不再触发） |

### PERF 模块（12 个用例）— test_CROSS.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| PERF_L1_01~02 | L1 | P1 | 性能指标格式 |
| PERF_L2_01~10 | L2 | P1-P2 | 缓冲区限制 + 虚拟滚动 + 去抖 + 分页 + 内存监控(60s/2GB) |

### ERROR 模块（16 个用例）— test_CROSS.md

| 用例编号 | 层级 | 优先级 | 场景描述 |
|----------|------|--------|----------|
| ERROR_L1_01~03 | L1 | P1 | 统一错误响应格式 |
| ERROR_L2_01~13 | L2 | P1-P2 | 终端失败 + 文件读取 + 网络超时 + 安装失败 + 评分失败 + 降级策略 |

### L3 集成测试（37 个用例）— 02_integration/user_journeys.md

| 用例编号 | 类型 | 场景描述 |
|----------|------|----------|
| JOURNEY_L3_01 | 完整用户旅程 | 新用户首次使用（APP→ONBOARD→TERM→EDITOR） |
| JOURNEY_L3_02 | 完整用户旅程 | 日常工作流（多终端+聚焦+文件+搜索） |
| JOURNEY_L3_03 | 完整用户旅程 | Skill 完整生命周期（发现→安装→评分→发布） |
| JOURNEY_L3_04 | 完整用户旅程 | 配置管理（浏览→编辑→文件监听联动） |
| JOURNEY_L3_05 | 完整用户旅程 | 富编辑器模式切换（多模式+按键穿透+图片） |
| MODULE_L3_01~08 | 模块完整流程 | 8 个核心模块的端到端流程 |
| CROSS_L3_01~06 | 跨模块联动 | 终端创建/关闭/文件变化/安装/评分/Esc 链 |
| CONSIST_L3_01~04 | 数据一致性 | 聊天同步/配置持久化/注册表/评分缓存 |
| TIME_L3_01~08 | 边界时间 | 200ms延迟/300ms去抖/5s超时/60s检查/6h轮询/24h清理 |
| RECOVER_L3_01~06 | 异常恢复 | 终端重连/安装重试/监听恢复/评分重试/同步恢复/降级 |

---

## 状态机覆盖总结

| 状态机 | PRD 位置 | 测试文件 | 路径覆盖 |
|--------|---------|----------|----------|
| 应用生命周期 | 6.1 | test_CROSS.md | ✅ |
| 终端进程 | 6.2 | test_TERM.md | ✅ 16/16 |
| 视图模式 | 6.3 | test_TERM.md | ✅ 11/11 |
| Tile 交互 | 6.4 | test_TERM.md | ✅ |
| 文件面板 | 6.5 | test_FILE_CONFIG.md | ✅ |
| 三栏临时视图 | 6.6 | test_FILE_CONFIG.md | ✅ |
| 目录切换 | 6.7 | test_FILE_CONFIG.md | ✅ |
| 自定义名称 | 6.8 | test_TERM.md | ✅ 9/9 |
| Grid 边框调整 | 6.9 | test_TERM.md | ✅ |
| 聊天历史面板 | 6.10 | test_CHAT.md | ✅ |
| 配置管理器 | 6.11 | test_FILE_CONFIG.md | ✅ |
| 文件监听 | 6.12 | test_DATA.md | ✅ |
| 富编辑器 | 6.13 | test_EDITOR.md | ✅ 11/11 |
| Skill 浏览器 | 6.14 | test_V2_INSTALL.md | ✅ |
| 包安装 | 6.15 | test_V2_INSTALL.md | ✅ |
| AI 评分 | 6.16 | test_V2_CONTENT.md | ✅ |
| 用户认证 | 6.17 | test_V2_CONTENT.md | ✅ |
| Showcase | 6.18 | test_V2_CONTENT.md | ✅ |

**18/18 状态机已覆盖** ✅

---

## 特殊规则覆盖总结

分析报告附录 H 中识别的 40 条特殊规则，全部在模块用例中生成了对应测试。

详见各模块文件末尾的"特殊规则覆盖确认"章节。

---

## 下一步

```
✅ 测试用例生成完成

输出文件：
- 02_INDEX.md（本文件）
- 02_modules/（8 个模块文件，502 个 L1/L2 用例）
- 02_integration/user_journeys.md（37 个 L3 用例）

总计：539 个测试用例

下一步：运行 /prd-to-test-3-review 检查补充
```
