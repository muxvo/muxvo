# 附录：覆盖矩阵与测试数据

## 附录 D：用例统计汇总

### 按模块/层级

| 模块 | L1 | L2 | 小计 | 占比 |
|------|----|----|------|------|
| TERM | 15 | 88 | 103 | 20.5% |
| CHAT | 27 | 34 | 61 | 12.2% |
| EDITOR | 8 | 44 | 52 | 10.4% |
| FILE | 32 | 18 | 50 | 10.0% |
| CONFIG | 27 | 13 | 40 | 8.0% |
| INSTALL | 5 | 20 | 25 | 5.0% |
| PUBLISH | 4 | 17 | 21 | 4.2% |
| DATA | 7 | 12 | 19 | 3.8% |
| SCORE | 3 | 15 | 18 | 3.6% |
| SHOWCASE | 3 | 14 | 17 | 3.4% |
| BROWSER | 4 | 12 | 16 | 3.2% |
| ERROR | 3 | 13 | 16 | 3.2% |
| PERF | 2 | 10 | 12 | 2.4% |
| COMMUNITY | 3 | 9 | 12 | 2.4% |
| APP | 5 | 7 | 12 | 2.4% |
| SECURITY | 2 | 8 | 10 | 2.0% |
| ONBOARD | 2 | 8 | 10 | 2.0% |
| AUTH | 3 | 5 | 8 | 1.6% |
| **L1+L2 总计** | **155** | **347** | **502** | **100%** |

### 按优先级/层级

| 优先级 | L1 | L2 | L3 | 合计 |
|--------|----|----|----|----|
| P0 | ~80 | ~70 | 5 | ~155 |
| P1 | ~55 | ~155 | 18 | ~228 |
| P2 | ~20 | ~122 | 14 | ~156 |
| **合计** | **155** | **347** | **37** | **539** |

---

## 附录 E：验证优先级指南

### P0 用例执行顺序（核心流程）

> 不通过则系统不可用，必须首先验证。

1. **APP**: 应用启动/恢复/关闭（生命周期状态机）
2. **TERM**: 终端创建/Grid 布局/进程状态机
3. **EDITOR**: 富编辑器默认模式/文本发送/按键穿透
4. **CHAT**: 面板打开/会话加载/双源读取
5. **FILE**: 文件面板/Markdown 预览
6. **DATA**: 文件监听/同步
7. **INSTALL**: Skill 安装链路
8. **SECURITY**: Hook 安全审查

### P1 用例执行顺序（重要功能）

9. **TERM**: 聚焦模式/拖拽排序/Esc 优先级/命名
10. **EDITOR**: 图片发送/自动模式检测
11. **CHAT**: 搜索去抖/索引构建
12. **FILE**: 三栏视图/目录切换
13. **CONFIG**: 资源浏览/编辑保存
14. **BROWSER**: 聚合加载/筛选排序
15. **SCORE**: AI 评分/缓存机制
16. **PERF**: 缓冲区/内存监控
17. **ERROR**: 降级/重试

### P2 用例执行顺序（场景测试）

18. **L3 集成测试**: 用户旅程/跨模块联动/边界时间
19. **SHOWCASE/PUBLISH**: 展示页/发布/社区
20. **AUTH**: OAuth PKCE
21. **ONBOARD**: 引导流程

---

## 附录 C：测试数据准备

### 终端相关

```javascript
// 终端创建参数
const terminalFixtures = {
  validCwd: '/Users/test/project',
  invalidCwd: '/nonexistent/path',
  cwdNoPermission: '/root/restricted',
  shellList: ['bash', 'zsh', 'fish'],
  aiToolList: ['claude', 'codex', 'gemini'],
};

// Grid 布局测试数据
const gridFixtures = [
  { count: 1, expectedCols: 1, expectedRows: 1, layout: '1x1 全屏' },
  { count: 2, expectedCols: 2, expectedRows: 1, layout: '2x1 对半' },
  { count: 3, expectedCols: 3, expectedRows: 1, layout: '3x1 三等分' },
  { count: 4, expectedCols: 2, expectedRows: 2, layout: '2x2 四宫格' },
  { count: 5, expectedCols: 3, expectedRows: 2, layout: '上3下2' },
  { count: 6, expectedCols: 3, expectedRows: 2, layout: '3x2 六宫格' },
  { count: 7, expectedCols: 3, expectedRows: 3, layout: 'ceil(√7)=3 列' },
  { count: 20, expectedCols: 5, expectedRows: 4, layout: 'ceil(√20)=5 列' },
];
```

### 富编辑器相关

```javascript
// ASB 信号
const asbSignals = {
  enterRaw: '\x1b[?1049h',  // 进入 RawTerminal
  exitRaw: '\x1b[?1049l',   // 恢复 RichEditor
};

// 文本转发格式
const textForwardFixtures = {
  claudeCode: {
    separator: '\x1b\r',  // ESC+CR
    submit: '\r',
    multiline: 'line1\x1b\rline2\x1b\rline3\r',
  },
  shell: {
    separator: null,
    submit: '\n',
    multiline: 'line1\nline2\nline3\n',
  },
};

// 图片发送
const imageFixtures = {
  validPng: { format: 'PNG', size: 1024 * 1024 },  // 1MB
  validJpg: { format: 'JPG', size: 2 * 1024 * 1024 },  // 2MB
  tooLarge: { format: 'PNG', size: 6 * 1024 * 1024 },  // 6MB > 5MB 限制
  invalidFormat: { format: 'BMP', size: 1024 },
};
```

### 聊天历史相关

```javascript
// JSONL 测试数据
const jsonlFixtures = {
  validLine: '{"type":"human","content":"hello"}\n',
  invalidLine: '{invalid json}\n',
  incompleteLine: '{"type":"human","content":"hello"',  // 无 \n 结尾
  emptyLine: '\n',
  multiLine: [
    '{"type":"human","content":"Q1"}\n',
    '{"type":"assistant","content":"A1"}\n',
    '{"type":"human","content":"Q2"}\n',
  ].join(''),
};

// 搜索测试数据
const searchFixtures = {
  debounceMs: 300,
  largeFileThreshold: 100 * 1024 * 1024,  // 100MB
  indexTimeoutSingle: 30000,  // 30s
  indexTimeoutTotal: 300000,  // 5min
};

// 三栏布局约束
const chatLayoutFixtures = {
  leftMin: 180,
  centerMin: 280,
  rightMin: 400,
  leftCollapsed: 60,  // 图标模式
};
```

### AI 评分相关

```javascript
// 评分维度权重
const scoreDimensions = [
  { name: '实用性', weight: 0.25 },
  { name: '工程质量', weight: 0.25 },
  { name: '意图清晰度', weight: 0.10 },
  { name: '设计巧妙度', weight: 0.10 },
  { name: '文档完善度', weight: 0.15 },
  { name: '可复用性', weight: 0.15 },
];

// 等级映射
const gradeMap = [
  { range: [0, 39], grade: 'Promising' },
  { range: [40, 59], grade: 'Solid' },
  { range: [60, 79], grade: 'Advanced' },
  { range: [80, 94], grade: 'Expert' },
  { range: [95, 100], grade: 'Masterwork' },
];

// 后处理验证容差
const scoreTolerance = 2;
```

### 安全检查相关

```javascript
// 安全检查模式
const securityPatterns = {
  apiKeyBlock: [/sk-[a-zA-Z0-9]+/, /ghp_[a-zA-Z0-9]+/, /token_[a-zA-Z0-9]+/],
  hardcodedPathWarn: [/\/Users\/[^/]+\//, /\/home\/[^/]+\//],
  sensitiveFileBlock: ['.env', 'credentials.json', '*.pem', '*.key'],
  fileSizeWarn: {
    skill: 1 * 1024 * 1024,   // 1MB
    plugin: 10 * 1024 * 1024,  // 10MB
  },
};
```

### 时间相关

```javascript
// 各种时间常量
const timeConstants = {
  jsonlReadDelay: 200,        // ms
  searchDebounce: 300,        // ms
  filePanelTransition: 300,   // ms
  watchRetryInterval: 3000,   // ms
  watchRetryMax: 3,
  processStopTimeout: 5000,   // ms
  memoryCheckInterval: 60000, // ms
  updateCheckInterval: 6 * 60 * 60 * 1000,  // 6h
  tempFileCleanup: 24 * 60 * 60 * 1000,     // 24h
  analyticsRetention: 90,     // days
  analyticsSummaryRetention: 365,  // days
  memoryWarningThreshold: 2 * 1024 * 1024 * 1024,  // 2GB
};
```

---

## 附录 G：遗漏检查清单

### PRD 功能覆盖检查

| PRD 功能编号 | 功能名称 | 覆盖模块 | 状态 |
|-------------|----------|----------|------|
| A | 全屏平铺式终端管理 | TERM | ✅ |
| B | 聚焦模式 | TERM | ✅ |
| C | 终端拖拽排序+边框调整 | TERM | ✅ |
| D | 聊天历史浏览器 | CHAT | ✅ |
| E | 全文搜索 | CHAT | ✅ |
| F | 会话时间线视图 | CHAT | ✅ |
| G | 内置 Markdown 预览 | FILE | ✅ |
| H | 文件浏览器+三栏临时视图 | FILE | ✅ |
| I | 双段式命名 | TERM | ✅ |
| J | ~/.claude/ 可视化浏览器 | CONFIG | ✅ |
| K | Plans/Skills/Hooks/Tasks 分类查看 | CONFIG | ✅ |
| L | Settings/CLAUDE.md 查看与编辑 | CONFIG | ✅ |
| M | 同目录终端自动归组 | TERM | ✅ |
| RE1 | 富编辑器覆盖层（基础） | EDITOR | ✅ |
| RE2 | 富编辑器覆盖层（完善） | EDITOR | ✅ |
| RE3 | 富编辑器覆盖层（高级） | EDITOR | ✅ |
| N2 | Skill 聚合浏览器 | BROWSER | ✅ |
| O | 一键安装 | INSTALL | ✅ |
| T | 更新检测与推送 | INSTALL | ✅ |
| U | Hook 安全审查 | SECURITY | ✅ |
| SR | AI Skill 评分 | SCORE | ✅ |
| SS | Skill Showcase 展示页 | SHOWCASE | ✅ |
| P2 | Skill 发布/分享 | PUBLISH | ✅ |
| SC | Showcase 社区平台 | COMMUNITY | ✅ |

**24/24 功能已覆盖** ✅

### PRD 章节覆盖检查

| PRD 章节 | 内容 | 覆盖状态 |
|----------|------|----------|
| 5. 流程图（11个） | 用户操作流程 | ✅ L3 集成测试覆盖 |
| 6. 状态机（18个） | 状态转换逻辑 | ✅ 18/18 已覆盖 |
| 7. 数据结构（10个） | 字段/类型/默认值 | ✅ L1 默认值用例 |
| 8. 功能规格（16个） | 详细实现规则 | ✅ L2 规则用例 |
| 10. 快捷键（11个） | 键盘操作 | ✅ Esc 优先级 + 编辑器快捷键 |
| 11.1 异常处理（30+场景） | 降级/重试/提示 | ✅ ERROR 模块 + L3 恢复测试 |
| 11.2 性能策略（15项） | 限制/优化 | ✅ PERF 模块 |
| 11.3 空状态（20+种） | 空页面文案 | ⚠️ 部分覆盖（在各模块 L1 中） |
| 13.3 数据埋点（30+事件） | 埋点事件 | ⚠️ 未专项覆盖（建议 Phase 3 补充） |

### AI 易遗漏项检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 部分更新（字段不变验证） | ✅ | 3 条规则已覆盖 |
| 边界时间（前1秒/后1秒） | ✅ | 8 个时间点已覆盖 |
| 累积上限（达到/超过） | ✅ | 12 条规则已覆盖 |
| 状态锁定（尝试逆转） | ✅ | 1 条规则已覆盖 |
| 并发安全（同时操作） | ✅ | 4 条规则已覆盖 |
| 默认值（每个字段） | ✅ | 12 条规则已覆盖 |
| 空状态文案 | ⚠️ | 建议 Phase 3 补充专项用例 |
| 埋点事件触发 | ⚠️ | 建议 Phase 3 评估是否需要 |

---

## 附录 H：特殊规则覆盖汇总

> 完整的特殊规则识别记录见 `01_PRD分析报告.md` 附录 H。
> 以下为覆盖状态汇总。

| 规则类型 | 识别数 | 已覆盖 | 状态 |
|----------|--------|--------|------|
| 部分更新规则 | 3 | 3 | ✅ |
| 多时间点规则 | 8 | 8 | ✅ |
| 条件互斥规则 | 0 | 0 | ⚪ 不适用 |
| 累积上限规则 | 12 | 12 | ✅ |
| 状态锁定规则 | 1 | 1 | ✅ |
| 默认值规则 | 12 | 12 | ✅ |
| 循环周期规则 | 0 | 0 | ⚪ 不适用 |
| 并发安全规则 | 4 | 4 | ✅ |
| **总计** | **40** | **40** | ✅ |
