# V2 安装模块组测试用例（BROWSER + INSTALL + SECURITY）

## 模块信息

| 项目 | 说明 |
|------|------|
| 覆盖功能 | N2（Skill 聚合浏览器）、O（一键安装）、T（更新检测）、U（Hook 安全审查） |
| PRD 位置 | 6.14-6.15、8.5-8.7、8.11-8.12、11.1 |
| 测试层级 | L1（IPC 契约）、L2（规则/状态机/边界） |
| 用例总数 | 50 |

---

## 一、BROWSER 模块（Skill 聚合浏览器）

### 1.1 状态机

```
                    点击 Skills / 浏览更多
[*] ──> Closed ──────────────────────────────> Loading
                                                 │
                              ┌───────────────────┼───────────────────┐
                              v                   v                   v
                           Ready            PartialReady          LoadError
                              │                   │                   │
                              │  失败源重试成功     │                   │ 点击重试
                              │<──────────────────┘                   │──> Loading
                              │                                       │
                     ┌────────┴────────┐                              │ Esc/关闭
                     v                 v                              v
                 Discovery <──> SearchResults                      Closed
                     │                 │
                     v                 v
                 PackageDetail <───────┘
                     │
                     │ 点击返回
                     v
                 Discovery
                     │
                     │ Esc / 点击 x
                     v
                  Closed
```

### 1.2 状态机转换路径覆盖表

| # | 转换路径 | 触发条件 | 覆盖用例 |
|---|---------|----------|----------|
| 1 | Closed -> Loading | 点击 Skills 按钮 / 浏览更多 | BROWSER_L1_01 |
| 2 | Loading -> Ready | 所有源加载成功 | BROWSER_L1_01 |
| 3 | Loading -> PartialReady | 部分源成功，部分失败 | BROWSER_L2_03 |
| 4 | Loading -> LoadError | 所有源加载失败 | BROWSER_L2_04 |
| 5 | PartialReady -> Ready | 失败源重试成功 | BROWSER_L2_05 |
| 6 | Ready(Discovery) -> Ready(SearchResults) | 输入搜索词（300ms 去抖） | BROWSER_L2_01 |
| 7 | Ready(SearchResults) -> Ready(Discovery) | 清空搜索框 | BROWSER_L2_06 |
| 8 | Ready(Discovery) -> Ready(PackageDetail) | 点击某个包 | BROWSER_L1_02 |
| 9 | Ready(SearchResults) -> Ready(PackageDetail) | 点击搜索结果中的包 | BROWSER_L2_07 |
| 10 | Ready(PackageDetail) -> Ready(Discovery) | 点击返回 | BROWSER_L2_08 |
| 11 | Ready -> Closed | Esc / 点击关闭 | BROWSER_L2_09 |
| 12 | LoadError -> Closed | Esc / 关闭 | BROWSER_L2_04 |
| 13 | LoadError -> Loading | 点击重试 | BROWSER_L2_10 |

**覆盖率：13/13 路径 ✅**

### 1.3 L1 契约层测试

| 编号 | 用例名 | 输入 | 预期输出 | 优先级 |
|------|--------|------|----------|--------|
| BROWSER_L1_01_fetch_sources | marketplace:fetch-sources IPC 格式验证 | 调用 `marketplace:fetch-sources` | 返回 `{ sources: Array<{ name, url, status, packages[] }>, totalCount: number }`，包含 6 个来源（本地文件、CC 官方、GitHub、npm、社区、自定义） | P0 |
| BROWSER_L1_02_search_ipc | marketplace:search IPC 格式验证 | 调用 `marketplace:search` 传入 `{ query: "commit", filters?: {...} }` | 返回 `{ results: Package[], totalCount: number, sources: string[] }`，Package 结构符合 7.3 数据模型 | P0 |
| BROWSER_L1_03_package_detail | 包详情数据结构验证 | 点击某个包查看详情 | 返回完整 Package 结构：id, name, type, displayName, description, readme, author, category, tags, license, stats, latestVersion, versions[], createdAt, updatedAt | P1 |
| BROWSER_L1_04_source_labels | 来源标识验证 | 浏览器加载完成 | 每个包显示来源标签（Anthropic 官方 / SkillsMP / GitHub / npm / 社区 / 本地） | P1 |

### 1.4 L2 规则层测试

| 编号 | 用例名 | 前置条件 | 操作步骤 | 预期结果 | 计算过程/验证方式 | 优先级 |
|------|--------|---------|----------|----------|-----------------|--------|
| BROWSER_L2_01_search_debounce_300ms | 搜索 300ms 去抖 | 浏览器已打开，Ready 状态 | 1. 快速连续输入 "c","co","com","comm","commi","commit"（每次间隔 50ms） | 仅在最后一次输入后 300ms 发出一次搜索请求，中间不发请求 | 输入 6 次 x 50ms = 300ms < 去抖 300ms，仅最后 "commit" 触发搜索 | P1 |
| BROWSER_L2_02_default_sort | 默认排序规则 | 浏览器首次打开 | 1. 等待加载完成 2. 查看列表排序 | 默认按来源优先排序展示，Discovery 视图 | 验证排序：来源权重排序（如 Anthropic 官方 > 社区 > GitHub） | P1 |
| BROWSER_L2_03_partial_ready | 部分源失败降级 | 网络正常 | 1. 打开浏览器 2. 模拟其中 2 个源返回错误 | 状态为 PartialReady：显示已加载源的数据 + 失败源显示"暂不可用"错误提示 | 6 个源中 4 个成功 + 2 个失败 = PartialReady 状态 | P0 |
| BROWSER_L2_04_all_sources_fail | 所有源加载失败 | 网络不可用 | 1. 断开网络 2. 打开浏览器 | 状态为 LoadError，显示"无法连接聚合源，请检查网络"+ [重试] 按钮 | 6 个源全部失败 -> LoadError | P0 |
| BROWSER_L2_05_partial_to_ready | 失败源自动重试成功 | PartialReady 状态 | 1. 等待自动重试 | 失败源重试成功后状态从 PartialReady 变为 Ready，列表补充新加载的包 | 自动重试 1 次（参考分析报告待澄清 #3） | P1 |
| BROWSER_L2_06_clear_search | 清空搜索恢复 Discovery | 处于 SearchResults 状态 | 1. 清空搜索框 | 恢复 Discovery 视图，显示默认排序列表 | SearchResults -> Discovery 转换 | P1 |
| BROWSER_L2_07_search_to_detail | 搜索结果点击详情 | 处于 SearchResults 状态 | 1. 点击搜索结果中的某个包 | 进入 PackageDetail 视图，展示完整包信息 | SearchResults -> PackageDetail 转换 | P1 |
| BROWSER_L2_08_detail_back | 详情页返回 | 处于 PackageDetail 视图 | 1. 点击返回按钮 | 返回 Discovery 视图（非 SearchResults） | PackageDetail -> Discovery 转换 | P2 |
| BROWSER_L2_09_close_esc | Esc 关闭浏览器 | 浏览器 Ready 状态，UI 层有焦点 | 1. 按 Esc 键 | 浏览器关闭，Ready -> Closed | Esc 优先级第 3 级（安全审查 > 文件夹选择器 > Skill 浏览器） | P1 |
| BROWSER_L2_10_retry_from_error | 加载失败重试 | LoadError 状态 | 1. 恢复网络 2. 点击[重试] | 重新进入 Loading 状态，成功后到 Ready | LoadError -> Loading -> Ready | P1 |
| BROWSER_L2_11_sidebar_filter | 左侧边栏筛选 | Ready 状态，多个来源数据已加载 | 1. 在左侧边栏选择"仅显示 Anthropic 官方" | 列表仅显示来源为 Anthropic 官方的包 | 筛选条件：source === "anthropic" | P1 |
| BROWSER_L2_12_concurrent_loading | 异步加载并发处理 | 浏览器首次打开 | 1. 观察 Loading 状态 | 6 个来源并行请求，任一返回即开始显示（渐进式），全部完成后进入 Ready/PartialReady | 并行 6 个请求，非串行 | P1 |

---

## 二、INSTALL 模块（安装/卸载/更新）

### 2.1 状态机

```
                    用户点击安装
[*] ──> NotInstalled ──────────────> Downloading
              ^                          │
              │                    ┌─────┴──────┐
              │                    v            v
              │              SecurityReview  Installing ──> InstallFailed
              │              (Hook 类型)    (Skill 类型)       │
              │                │      │         │              │ 用户关闭
              │  用户取消       │      │         v              v
              │<───────────────┘      │     Installed ──> NotInstalled
              │                       │         │
              │  用户确认              │         │ 检测到新版本
              │                       v         v
              │                   Installing  UpdateAvailable
              │                                 │      │
              │                    用户点击更新   │      │ 用户点击卸载
              │                                 v      v
              │                           Downloading  Uninstalling
              │                                            │
              │<───────────────────────────────────────────┘
              │          删除本地文件+注册表记录
```

### 2.2 状态机转换路径覆盖表

| # | 转换路径 | 触发条件 | 覆盖用例 |
|---|---------|----------|----------|
| 1 | NotInstalled -> Downloading | 用户点击安装 | INSTALL_L1_01 |
| 2 | Downloading -> SecurityReview | 类型为 Hook | INSTALL_L2_03 |
| 3 | Downloading -> Installing | 类型为 Skill，下载完成 | INSTALL_L2_04 |
| 4 | SecurityReview -> Installing | 用户确认安装 | INSTALL_L2_03 |
| 5 | SecurityReview -> NotInstalled | 用户取消 | INSTALL_L2_05 |
| 6 | Installing -> Installed | 解压+注册完成 | INSTALL_L1_01 |
| 7 | Installing -> InstallFailed | 解压/写入失败 | INSTALL_L2_06 |
| 8 | InstallFailed -> NotInstalled | 用户关闭错误提示 | INSTALL_L2_07 |
| 9 | Installed -> UpdateAvailable | 检测到新版本 | INSTALL_L2_08 |
| 10 | UpdateAvailable -> Downloading | 用户点击更新 | INSTALL_L2_09 |
| 11 | Installed -> Uninstalling | 用户点击卸载 | INSTALL_L1_02 |
| 12 | UpdateAvailable -> Uninstalling | 用户点击卸载 | INSTALL_L2_10 |
| 13 | Uninstalling -> NotInstalled | 删除本地文件+注册表记录 | INSTALL_L1_02 |

**覆盖率：13/13 路径 ✅**

### 2.3 状态 UI 映射验证表

| 状态 | 按钮文案 | 按钮样式 | 附加信息 | 覆盖用例 |
|------|---------|---------|---------|----------|
| NotInstalled | 安装 | amber 实心按钮 | - | INSTALL_L2_11 |
| Downloading | 下载中... | 灰色禁用+进度条 | 显示下载进度 | INSTALL_L2_11 |
| SecurityReview | - | - | 安全审查对话框 | INSTALL_L2_11 |
| Installing | 安装中... | 灰色禁用+旋转图标 | - | INSTALL_L2_11 |
| Installed | 已安装 ✓ | 绿色描边按钮 | hover 显示"卸载" | INSTALL_L2_11 |
| UpdateAvailable | 更新到 x.y.z | amber 描边按钮+徽章 | 显示更新日志链接 | INSTALL_L2_11 |
| InstallFailed | 重试安装 | 红色描边按钮 | 显示错误原因 | INSTALL_L2_11 |
| Uninstalling | 卸载中... | 灰色禁用 | - | INSTALL_L2_11 |

### 2.4 L1 契约层测试

| 编号 | 用例名 | 输入 | 预期输出 | 优先级 |
|------|--------|------|----------|--------|
| INSTALL_L1_01_install_ipc | marketplace:install IPC 格式验证 | 调用 `marketplace:install` 传入 `{ packageName: "commit-helper", source: "skillsmp", version: "1.2.0" }` | 返回 `{ success: boolean, installedPath: string, registryUpdated: boolean }` | P0 |
| INSTALL_L1_02_uninstall_ipc | marketplace:uninstall IPC 格式验证 | 调用 `marketplace:uninstall` 传入 `{ packageName: "commit-helper" }` | 返回 `{ success: boolean, cleanedPaths: string[] }`，本地文件和注册表记录已删除 | P0 |
| INSTALL_L1_03_get_installed | marketplace:get-installed IPC 格式验证 | 调用 `marketplace:get-installed` | 返回 `{ packages: InstalledPackage[] }`，每项包含 name, type, version, source, installedAt, updatedAt | P0 |
| INSTALL_L1_04_check_updates | marketplace:check-updates IPC 格式验证 | 调用 `marketplace:check-updates` | 返回 `{ updates: Array<{ packageName, currentVersion, latestVersion, source, changelog }> }` | P1 |
| INSTALL_L1_05_progress_push | install-progress push 事件格式验证 | 安装过程中监听 `marketplace:install-progress` | 收到 push 事件 `{ packageName: string, stage: "downloading"|"installing"|"registering", progress: number(0-100) }` | P1 |

### 2.5 L2 规则层测试

| 编号 | 用例名 | 前置条件 | 操作步骤 | 预期结果 | 计算过程/验证方式 | 优先级 |
|------|--------|---------|----------|----------|-----------------|--------|
| INSTALL_L1_01_update_check_interval | 更新检测 6h 轮询间隔 | 已安装若干包 | 1. 启动 Muxvo（触发首次检测） 2. 等待 6 小时 | 启动时检测一次 + 每 6 小时自动检测一次，合计第一天检测 ~4 次 | 时间点：0h, 6h, 12h, 18h；间隔 = 6 * 3600 * 1000 ms | P1 |
| INSTALL_L2_02_version_conflict | 已安装包本地已修改时的版本冲突 | 包已安装，用户手动修改了本地文件 | 1. 检测到更新 2. 用户点击更新 | 提示"本地文件已修改，覆盖还是保留本地版本？"，用户选择覆盖则更新，选择保留则跳过 | 检测方式：比较本地文件 hash 与安装时记录的 hash | P1 |
| INSTALL_L2_03_hook_security_review | Hook 类型安装触发安全审查 | 浏览器中选择一个 Hook 类型的包 | 1. 点击安装 2. 系统下载完成 | 弹出安全审查对话框（转入 SecurityReview 状态），而非直接安装 | type === "hook" -> SecurityReview 分支 | P0 |
| INSTALL_L2_04_skill_direct_install | Skill 类型直接安装（无安全审查） | 浏览器中选择一个 Skill 类型的包 | 1. 点击安装 | 直接进入 Installing 状态（跳过 SecurityReview），下载 -> 解压到 `~/.claude/skills/{name}/` -> 完成 | type === "skill" -> Installing 分支 | P0 |
| INSTALL_L2_05_cancel_security_review | 安全审查取消安装 | SecurityReview 对话框已打开 | 1. 点击"取消" | 关闭对话框，状态回到 NotInstalled，不安装不写注册表 | SecurityReview -> NotInstalled | P1 |
| INSTALL_L2_06_install_fail | 安装失败状态 | 下载成功，但目标目录无写入权限 | 1. 模拟写入 `~/.claude/skills/` 失败 | 状态变为 InstallFailed，按钮显示"重试安装"（红色描边），显示错误原因"无法写入目录" | Installing -> InstallFailed | P1 |
| INSTALL_L2_07_retry_after_fail | 安装失败后重试 | InstallFailed 状态 | 1. 修复权限问题 2. 点击"重试安装" | 重新进入 Downloading -> Installing -> Installed | InstallFailed -> NotInstalled -> Downloading | P1 |
| INSTALL_L2_08_update_detection | 更新检测与徽章显示 | 包 "commit-helper" v1.0.0 已安装 | 1. 启动 Muxvo 2. 聚合源返回 v1.2.0 可用 | 菜单栏 [Skills] 按钮显示红色数字徽章；列表中该包显示 amber 色"更新可用"徽章 | currentVersion(1.0.0) < latestVersion(1.2.0) -> UpdateAvailable | P1 |
| INSTALL_L2_09_single_update | 单个包更新流程 | 包处于 UpdateAvailable 状态 | 1. 点击"更新到 1.2.0" | 进入 Downloading -> Installing -> Installed，版本更新为 1.2.0，注册表 updatedAt 更新 | UpdateAvailable -> Downloading -> Installing -> Installed | P1 |
| INSTALL_L2_10_uninstall_with_update | 有更新时卸载 | 包处于 UpdateAvailable 状态 | 1. 点击卸载 | 进入 Uninstalling -> NotInstalled，忽略可用更新，删除本地文件和注册表 | UpdateAvailable -> Uninstalling -> NotInstalled | P2 |
| INSTALL_L2_11_ui_state_mapping | 全状态 UI 映射验证 | 依次进入各状态 | 1. 遍历所有 8 个安装状态 | 每个状态的按钮文案、样式、附加信息与 PRD 6.15 定义一致（见 2.3 表） | 逐一验证 8 个状态的 UI | P0 |
| INSTALL_L2_12_batch_update | 批量更新 | 3 个包都有可用更新 | 1. 点击浏览器顶部"3 个更新可用，[全部更新]" | 3 个包依次/并行更新，全部完成后徽章消失 | 批量更新入口在聚合浏览器顶部 | P2 |
| INSTALL_L2_13_registry_write | 安装后注册表写入 | 安装一个包成功 | 1. 检查 `~/Library/Application Support/Muxvo/marketplace.json` | 注册表 installed 字段新增条目，包含 type, version, packageId, source, sourceUrl, installedAt | 验证 JSON 结构与 7.5 数据模型一致 | P1 |
| INSTALL_L2_14_chokidar_refresh | 安装后列表自动刷新 | 安装一个 Skill 到 `~/.claude/skills/` | 1. 等待安装完成 | chokidar 监听到目录变化，Skills 列表自动刷新，无需手动操作 | chokidar 监听 `~/.claude/skills/` 目录 | P1 |
| INSTALL_L2_15_download_fail_retry | 下载失败自动重试 | 网络不稳定 | 1. 点击安装 2. 模拟首次下载失败 | 自动重试 1 次；仍失败则提示"下载失败，请稍后重试" | 重试策略：自动重试 1 次（PRD 11.1） | P1 |
| INSTALL_L2_16_integrity_check | 包完整性校验失败 | 下载的包文件损坏 | 1. 模拟 tar.gz 校验不通过 | 拒绝安装，提示"文件校验失败，请重新下载" | hash 校验失败 -> 阻止安装 | P1 |
| INSTALL_L2_17_hook_settings_write | Hook 安装后写入 settings.json | 安装一个 Hook 包成功 | 1. 检查 `~/.claude/settings.json` | hooks 配置中新增条目，包含 event、command 字段 | Hook 安装需额外写入 settings.json 的 hooks 配置 | P0 |
| INSTALL_L2_18_uninstall_cleanup | 卸载清理完整性 | 包已安装 | 1. 点击卸载 | 1. 删除本地文件目录 2. 删除注册表条目 3. Hook 类型额外清除 settings.json 中的配置 | 清理 3 个位置：文件 + 注册表 + settings(Hook) | P1 |
| INSTALL_L2_19_install_usage_guide | 安装后使用引导 | 安装完成 | 1. 观察安装完成后的 UI | 显示使用引导提示："在 CC 中说 {示例提示词}" | 引导用户如何使用新安装的 Skill | P2 |

---

## 三、SECURITY 模块（Hook 安全审查）

### 3.1 安全审查决策树

```
用户点击安装
    │
    v
包类型判断
    │
    ├── type === "skill"
    │       └── 跳过安全审查 -> 直接安装
    │
    └── type === "hook"
            │
            v
        弹出安全审查对话框
            │
            ├── 展示触发事件（如 Stop、PreToolUse）
            ├── 展示执行命令
            ├── 展示完整源码（默认折叠，可展开）
            ├── 风险关键词高亮（红色标记）
            │
            v
        用户选择
            │
            ├── 点击"确认安装，我信任此代码"
            │       └── 执行安装流程
            │
            └── 点击"取消"
                    └── 关闭对话框，不安装
```

### 3.2 L1 契约层测试

| 编号 | 用例名 | 输入 | 预期输出 | 优先级 |
|------|--------|------|----------|--------|
| SECURITY_L1_01_dialog_data | 安全审查对话框数据结构 | Hook 安装触发安全审查 | 对话框展示：`{ hookName: string, triggerEvent: string, command: string, sourceCode: string, timeout: number }` | P0 |
| SECURITY_L1_02_risk_keywords | 风险关键词列表格式 | 源码包含高风险命令 | 高风险关键词列表：`curl`, `eval`, `rm -rf`, `wget`, `sudo`, `chmod 777` 等标红高亮 | P0 |

### 3.3 L2 规则层测试

| 编号 | 用例名 | 前置条件 | 操作步骤 | 预期结果 | 计算过程/验证方式 | 优先级 |
|------|--------|---------|----------|----------|-----------------|--------|
| SECURITY_L2_01_dialog_content | 对话框完整信息展示 | Hook 包下载完成 | 1. 观察安全审查对话框 | 显示：(1) Hook 名称 (2) 触发事件 (3) 执行命令 (4) 超时时间 (5) 源码（默认折叠） | 验证 5 项信息完整展示 | P0 |
| SECURITY_L2_02_source_expand | 源码展开/折叠 | 安全审查对话框已打开 | 1. 点击"查看源码" | 源码面板展开，显示完整代码内容；再次点击折叠 | 默认折叠 -> 点击展开 -> 再点击折叠 | P1 |
| SECURITY_L2_03_risk_highlight | 风险关键词高亮 | 源码包含 `curl http://... \| bash` 和 `rm -rf /` | 1. 展开源码 | `curl`、`rm -rf` 等关键词标红高亮显示 | 匹配规则：curl, eval, rm -rf, wget, sudo, chmod 等 | P0 |
| SECURITY_L2_04_confirm_install | 确认安装流程 | 安全审查对话框已打开 | 1. 点击"确认安装，我信任此代码" | 对话框关闭，进入 Installing 状态，写入 settings.json hooks 配置 | 按钮文案必须强调"我信任此代码" | P0 |
| SECURITY_L2_05_cancel_no_install | 取消不安装 | 安全审查对话框已打开 | 1. 点击"取消" | 对话框关闭，状态回到 NotInstalled，无任何文件写入 | SecurityReview -> NotInstalled，无副作用 | P1 |
| SECURITY_L2_06_esc_close_dialog | Esc 关闭安全审查对话框 | 安全审查对话框已打开，UI 层焦点 | 1. 按 Esc | 对话框关闭，等同于取消（Esc 优先级第 1 级） | Esc 优先级：安全审查对话框 > 文件夹选择器 > Skill 浏览器 | P1 |
| SECURITY_L2_07_no_risk_keywords | 源码无风险关键词 | Hook 源码内容安全（仅 echo、printf） | 1. 查看审查对话框 | 源码正常显示，无红色高亮标记 | 无匹配关键词 -> 无高亮 | P2 |
| SECURITY_L2_08_multiple_risks | 源码多个风险关键词 | Hook 源码包含 curl + eval + rm -rf | 1. 展开源码 | 3 处关键词全部标红高亮 | 验证多关键词场景，每个独立匹配 | P1 |

---

## 四、用例统计

| 模块 | L1 用例数 | L2 用例数 | 合计 |
|------|----------|----------|------|
| BROWSER | 4 | 12 | 16 |
| INSTALL | 5 | 19 | 24 |
| SECURITY | 2 | 8 | 10 |
| **总计** | **11** | **39** | **50** |

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P0 | 15 | 30% |
| P1 | 28 | 56% |
| P2 | 7 | 14% |

### 特殊规则覆盖确认

| 规则编号 | 规则描述 | 覆盖用例 | 状态 |
|---------|----------|----------|------|
| BROWSER_L2_01_search_debounce_300ms | 搜索 300ms 去抖 | BROWSER_L2_01 | ✅ |
| BROWSER_L2_02_default_sort | 默认按来源优先排序 | BROWSER_L2_02 | ✅ |
| INSTALL_L2_01_update_check_interval | 每 6 小时检测更新 | INSTALL_L1_01 | ✅ |
| INSTALL_L2_02_version_conflict | 本地已修改时版本冲突 | INSTALL_L2_02 | ✅ |
