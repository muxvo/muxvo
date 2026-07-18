# 终端 golden 工具（terminal-rendering.md §6）

「终端真内容 golden」= 用产品渲染路径把固定终端内容渲成 PNG，本机字节冻结做像素回归。
与 `tools/visual-diff/`（web 全窗 golden，`specs/screens.json` 授权）**互不混用**：
本工具授权清单是 `specs/term-golden.json`，产物落 `tools/term-golden/golden/`。

## 渲染路径（测的就是产品路径）

生成器走 `TerminalRenderer.renderOffscreen`（`buildInstances → encode → 离屏 MTLTexture readback`），
与 `TerminalSurfaceView.draw` 同一 `encode` 路径。素材经隔离会话（`spawnShell:false`）
`feed` 固定字节灌入；固定网格 40×12、字体 Menlo 14 @2x、固定 `cursorMode` → 确定性像素。

## 生成 / 复跑

```bash
tools/term-golden/generate.sh          # = 门控跑 MuxvoTermGoldenTests，写 golden/*.png + SHASUMS256.txt
# 等价手动：
MUXVO_TERM_GOLDEN=1 scripts/app.sh test --filter TermGoldenGenerator
```

- 需要 GPU（`MTLCreateSystemDefaultDevice()!=nil`）。无 GPU / 非交互 headless 进程：生成器早退，
  golden 降级「待补」（不造假）。renderOffscreen 走离屏纹理**不触 currentDrawable**，故无 SIGTRAP，
  在有 GPU 的测试进程即可跑（与在屏 present 不同）。
- 门控 `MUXVO_TERM_GOLDEN=1`：未置位时 `TermGoldenGenerator` 用例早退（trivial pass），
  常规 `scripts/app.sh test` 不生成、不判红、不进 CI。

## 纪律（§6）

- 本机字节冻结、**即截即 commit**（生成后留工作树，由人复核后提交）。
- **严禁重生成已有 golden**：改渲染先看 `SHASUMS256.txt` diff，再决定是否授权重截。
- 新增 golden 先登记 `specs/term-golden.json` 再截。

## 目录

- `golden/<id>.png` —— 冻结基准（授权见 `specs/term-golden.json`）
- `golden/SHASUMS256.txt` —— 逐张 SHA-256（确定性排序，回归 diff 用）
- `generate.sh` —— 生成/复跑驱动
