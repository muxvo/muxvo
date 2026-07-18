# visual-diff（M0 探针 3 → M2 视觉回归流水线）

老 app（golden）与新 web 复刻（current）的截图比对：**布局包围盒 ≤1px + 像素感知阈值（文本区放宽）**，超阈值出 diff 热力图 HTML。

## 用法

```bash
# 1. 起两个 dev server
cd ../../../muxvo-legacy && npm run fixture:serve   # golden 源：http://localhost:5199/fixture.html
cd ../web && npm run dev                            # current 源：http://localhost:5198/?screenshot=1

# 2. 截图 + 比对（在本目录）
npm install            # 仅 pixelmatch + pngjs；playwright 复用 muxvo-legacy/node_modules
npm run golden         # 截老 app 15 张 → golden/（已提交，作为老版对照基准）
npm run current        # 截新 web 15 张 → current/（gitignored）
npm run compare        # 双层断言 → report/index.html（gitignored）
npm run all            # 三步连跑

# 指定场景：node src/capture.mjs golden f1 f4
```

## 关键文件

- `fixtures/_CONTRACT.md` —— 两侧共用的 fixture 契约（schema / 页面窗口契约 / 终端内容静态样式）
- `fixtures/fixtures.json` —— 15 个场景（spec §8 矩阵 F1-F9，F3 补 f3b 覆盖 lastRowCentered）
- `golden/` —— 老 app 注入 fixture 的截图基准（1440×900@2x，已提交）
- `report/index.html` —— 新旧并排 + diff 热力图 + PASS/FAIL

## 阈值（compare.mjs 顶部）

| 层 | 标准 |
|---|---|
| 布局 | 关键元素包围盒逐个配对，Δx/Δy/Δw/Δh ≤ 1 CSS px |
| 像素（chrome） | 文本区外 diff 像素 ≤ 0.5%（pixelmatch threshold 0.12） |
| 像素（文本区） | `.tile-terminal` 内 ≤ 5% |

## 环境备注

- 浏览器：直连下载被墙且 npmmirror 缺对应构建，capture 固定用本机
  `~/Library/Caches/ms-playwright/chromium_headless_shell-1200/`（原 pin 1223 于 2026-07-02 被
  Playwright GC 清理后换 pin；等价实证与权威记载见 `src/capture.mjs` 头注释，vendor 留有
  1223 zip 备份），可用 `CHROMIUM_PATH` 覆盖。两侧同一浏览器渲染，比对公平性不受影响。
- npm 安装用 `--registry=https://registry.npmmirror.com`。
