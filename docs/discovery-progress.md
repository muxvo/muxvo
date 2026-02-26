# Discovery 发现页 — 进度摘要

> 生成时间: 2026-02-26
> 当前分支: `master`（清理工作在此分支完成）
> 计划文件: `~/.claude/plans/majestic-weaving-wreath.md`

---

## 1. 功能目标

为 Muxvo 新建"发现页"，让用户可以：

1. **浏览官方 skill/hook/plugin** — 来自 Claude Code (Anthropic)、Codex (OpenAI)、Gemini CLI (Google)
2. **浏览社区发布的 skill/hook/plugin** — 存储在 Supabase
3. **一键安装到本地** — 默认安装到 Claude Code (`~/.claude/skills/`)，可选 Codex (`~/.codex/skills/`) 或 Gemini CLI (`~/.gemini/skills/`)
4. **发布自己的 skill/hook/plugin** — 上传到社区

### 关键发现

三大 CLI 工具（CC、Codex、Gemini CLI）统一采用 [Agent Skills 规范](https://agentskills.io/specification)，技能格式完全互通：目录 + `SKILL.md`（YAML frontmatter + Markdown body）。

### 官方源信息

| CLI 工具 | GitHub Org | 官方 Skill 仓库 | 本地路径 |
|---------|-----------|----------------|---------|
| Claude Code | `anthropics` | `anthropics/skills` | `~/.claude/skills/` |
| Codex | `openai` | `openai/skills` | `~/.codex/skills/` |
| Gemini CLI | `google-gemini` | `google-gemini/gemini-skills` + `gemini-cli-extensions` org | `~/.gemini/skills/` |

---

## 2. 已完成: Step 0 — 清理旧代码

### 删除的目录 (7 个)

| 目录 | 说明 |
|------|------|
| `src/modules/marketplace/` (18 files) | 旧商城模块 |
| `src/modules/showcase/` (~5 files) | 旧 showcase 生成 |
| `src/modules/score/` (~3 files) | 旧 AI 评分 |
| `src/modules/publish/` (~8 files) | 旧发布流程 |
| `src/main/services/marketplace/` (2 files) | 旧安装/下载服务 |
| `src/renderer/features/marketplace/` (1 file) | 旧 marketplace store |
| `src/renderer/components/marketplace/` (1 file) | 旧 source labels |

### 删除的单文件 (11 个)

| 文件 | 说明 |
|------|------|
| `src/main/ipc/marketplace-handlers.ts` | 旧 marketplace IPC |
| `src/main/ipc/showcase-handlers.ts` | 旧 showcase IPC |
| `src/main/ipc/score-handlers.ts` | 旧 score IPC |
| `src/shared/types/marketplace.types.ts` | 旧类型 |
| `src/shared/types/showcase.types.ts` | 旧类型 |
| `src/shared/types/score.types.ts` | 旧类型 |
| `src/shared/types/publish-draft.types.ts` | 旧类型 |
| `tests/l1/v2.test.ts` | 旧 marketplace 测试 |
| `tests/l2/v2-install.test.ts` | 旧安装测试 |
| `tests/specs/l1/v2.spec.json` | 旧测试 spec |
| `tests/specs/l2/score-calc.spec.json` | 旧评分 spec |
| `tests/specs/l2/publish-rules.spec.json` | 旧发布 spec |
| `tests/specs/l2/security-rules.spec.json` | 旧安全 spec |

### 修改的文件

| 文件 | 操作 |
|------|------|
| `src/shared/constants/channels.ts` | 删除 MARKETPLACE/SCORE/SHOWCASE 块，新增 DISCOVERY 块 (11 channels) |
| `src/main/index.ts` | 删除 registerMarketplaceHandlers / registerScoreHandlers / registerShowcaseHandlers 调用 |
| `src/preload/index.ts` | 删除 marketplace / score / showcase API 域 |
| `src/shared/types/index.ts` | 删除 4 个旧类型导出 |
| `src/shared/constants/paths.ts` | 删除 MUXVO_SKILL_SCORES_SUBDIR 等 4 个旧路径常量 |
| `src/shared/utils/perf-config.ts` | `marketplacePageSize` → `discoveryPageSize` |
| `tests/l2/v2-content.test.ts` | 删除 SCORE/SHOWCASE/PUBLISH 测试块 (1093行→237行) |
| `tests/l2/cross.test.ts` | 删除 marketplace/showcase 错误测试，更新 perf 引用 |
| `tests/l3/user-journeys.test.ts` | 删除 14 个引用已删模块的测试块 |
| `tests/specs/l2/boundaries.spec.json` | 删除 SHOWCASE/PUBLISH cases (16→13) |
| `tests/specs/l2/perf-thresholds.spec.json` | `marketplacePageSize` → `discoveryPageSize` |
| `tests/helpers/mock-ipc.ts` | 更新注释 |

### 验证结果

- 516 tests passing
- verify:coverage passing
- 无新增 TypeScript 编译错误

---

## 3. 待完成: Step 1~4 — 构建 Discovery 功能

### 新增 IPC Channel (`channels.ts` 中已添加)

```
DISCOVERY: {
  FETCH, GET_DETAIL, SEARCH,
  INSTALL, UNINSTALL, GET_INSTALLED,
  PUBLISH, UNPUBLISH,
  INSTALL_PROGRESS, PUBLISH_PROGRESS, PACKAGES_LOADED
}
```

### 需要新建的文件

**Main Process (9 个文件):**

| 文件 | 职责 |
|------|------|
| `src/main/ipc/discovery-handlers.ts` | IPC handler |
| `src/main/services/discovery/github-source.ts` | GitHub API 拉取官方 skill |
| `src/main/services/discovery/supabase-source.ts` | Supabase 拉取社区 skill |
| `src/main/services/discovery/local-source.ts` | 扫描本地已安装 skill |
| `src/main/services/discovery/aggregator.ts` | 聚合三个源 + 缓存 |
| `src/main/services/discovery/installer.ts` | 下载 + 解压 + 写入目标目录 |
| `src/main/services/discovery/publisher.ts` | 打包 + 上传 Supabase |
| `src/main/services/supabase/client.ts` | Supabase 客户端单例 |
| `src/main/services/supabase/community-api.ts` | Supabase CRUD 封装 |

**Shared (2 个文件):**

| 文件 | 职责 |
|------|------|
| `src/shared/types/discovery.types.ts` | 全部发现页类型 |
| `src/shared/constants/supabase.ts` | SUPABASE_URL + ANON_KEY |

**Renderer (9 个文件):**

| 文件 | 职责 |
|------|------|
| `src/renderer/components/discovery/DiscoveryPanel.tsx` | 顶层面板容器 |
| `src/renderer/components/discovery/DiscoveryPanel.css` | 样式 |
| `src/renderer/components/discovery/DiscoverySidebar.tsx` | 左侧过滤栏 |
| `src/renderer/components/discovery/PackageGrid.tsx` | 卡片网格 |
| `src/renderer/components/discovery/PackageCard.tsx` | 单个包卡片 |
| `src/renderer/components/discovery/PackageDetail.tsx` | 右侧详情 |
| `src/renderer/components/discovery/PublishDialog.tsx` | 发布对话框 |
| `src/renderer/hooks/useDiscovery.ts` | 数据 hook |

**状态机 (3 个文件):**

| 文件 | 职责 |
|------|------|
| `src/modules/discovery/discovery-machine.ts` | 发现页状态机 |
| `src/modules/discovery/install-machine.ts` | 安装生命周期 |
| `src/modules/discovery/publish-machine.ts` | 发布生命周期 |

### 需要修改的现有文件

| 文件 | 操作 |
|------|------|
| `src/preload/index.ts` | 新增 `discovery` 域到 `window.api` |
| `src/main/index.ts` | 新增 `registerDiscoveryHandlers()` 调用 |
| `src/renderer/contexts/PanelContext.tsx` | 新增 `discoveryPanel` state + actions |
| `src/renderer/components/layout/MenuBar.tsx` | 新增 Discovery tab |
| `src/renderer/App.tsx` | 新增 DiscoveryPanel overlay 渲染 |
| `src/renderer/i18n/locales/zh.ts` | 新增 discovery.* 翻译 |
| `src/renderer/i18n/locales/en.ts` | 新增 discovery.* 翻译 |

### Supabase 后端

4 张核心表: `profiles`, `packages`, `package_versions`, `package_stats`
Storage: `packages` bucket (公开读取)
Edge Functions: `auth-github`, `publish-package`, `sync-github-official`

### 团队分工 (5 人)

| 成员 | 负责 | 依赖 |
|------|------|------|
| **lead** | 清理 ✅ + PanelContext/MenuBar/App 集成 + i18n | 无 |
| **backend** | Supabase 项目 + schema + Edge Functions + client | 无 |
| **datasource** | github-source + supabase-source + local-source + aggregator + discovery-machine | 依赖 backend |
| **ui** | 全部 renderer 组件 + useDiscovery hook + CSS | 依赖 lead |
| **install** | discovery-handlers + installer + publisher + machines + preload | 依赖 datasource |

---

## 4. 注意事项

### 分支问题

- 清理工作在 `master` 分支完成（而非 `branch7`）
- `branch7` 分支已存在但未使用
- 下次开始前需确认：是否将后续工作迁移到独立分支

### CLAUDE.md 文档过时

项目根目录的 `CLAUDE.md` 仍然引用了已删除的文件：
- `marketplace-handlers.ts`
- `score-handlers.ts`
- `showcase-handlers.ts`
- `marketplace:*`, `score:*`, `showcase:*` IPC channels

建议在后续步骤中更新。

### UI 布局参考

```
+------------+-------------------------------+--------------------+
| Sidebar    |  Package Grid                 | Detail             |
| (220px)    |  (flex, 可滚动)                | (400px, 选中显示)   |
|            |                               |                    |
| ┌────────┐ |  ┌──────┐ ┌──────┐ ┌──────┐  | PackageName        |
| │ Search │ |  │ Card │ │ Card │ │ Card │  | by @author         |
| └────────┘ |  └──────┘ └──────┘ └──────┘  |                    |
|            |  ┌──────┐ ┌──────┐ ┌──────┐  | [Install ▾]        |
| Source     |  │ Card │ │ Card │ │ Card │  |  └ Claude Code     |
|  ○ All     |  └──────┘ └──────┘ └──────┘  |  └ Codex           |
|  ○ Anthropic|                              |  └ Gemini CLI      |
|  ○ OpenAI  |                               |                    |
|  ○ Google  |                               | README.md          |
|  ○ Community|                              | ─────────────────  |
|            |                               | Compatible:        |
| Type       |                               |  CC  Codex  Gemini |
|  □ Skill   |                               |                    |
|  □ Hook    |                               | Tags: #util #git   |
|  □ Plugin  |                               |                    |
|            |  [Loading...] / [No results]  | Versions           |
| ──────── │ |                               |  v1.2.0 (latest)   |
| [Publish]  |                               |  v1.1.0            |
+------------+-------------------------------+--------------------+
```

---

## 5. 下次继续的步骤

1. 确认分支策略（在 master 继续 or 切到新分支）
2. 启动 5 人 Team，按计划文件 `~/.claude/plans/majestic-weaving-wreath.md` 执行 Step 1~4
3. 执行顺序：
   - lead 做 Panel 骨架 + backend 搭 Supabase（并行）
   - datasource 做数据源（依赖 backend）
   - ui 做界面 + install 做 IPC/安装/发布（并行）
   - 集成测试
