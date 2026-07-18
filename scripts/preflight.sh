#!/bin/bash
# Muxvo 本地主闸（任务 13）：push 前必须全绿。八步依序，任一红即非零退出。
#
#   1. bridge codegen --check --selftest（≤15 台账五项 + 六反例红灯自验）
#   2. web tsc --noEmit + vitest run（M2 任务1 起：spec-runner 只查测试存在性，vitest 真执行）
#   3. scripts/app.sh test（全部 Swift 测试，含 SIGKILL 4 场景）
#   4. spec-runner（legacy 176 case 1:1 归属 + CHECKSUMS 完整性）
#   5. visual-diff：current + compare + bridge-isolation + golden 完整性
#      —— 严禁 golden / all（会重生成老版对照基准；golden 出 diff = 改动错了，回头改代码）
#   6. 字面量纪律 grep + contract-recorder fixtures secret-scan（机器固化纪律）
#   7. spec-coverage（编排规格案例池 ↔ 测试存在性 1:1 兜底；legacy 走步骤 4 spec-runner，编排走此）
#   8. 单文件 ≤2000 行（上下文安全纪律；>1500 黄色提醒）
#
# 日志：每步独立落 ~/Library/Caches/muxvo-build/logs/preflight-<时间戳>/，
#       失败时打印末 20 行；命令不经管道直连（防 | tail 吞退出码出假绿）。
#
# 可选项（默认不跑）：bench_vt_ingest 基准（probes/term-probe）。原因：依赖
#   vendor 产物（libghostty-vt，不进 git），且基准数字仅在显式跑 bench 时有意义。
#   手动跑：cd probes/term-probe && swift build -c release && \
#           .build/release/probe-cli bench-vt-ingest
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOGDIR="$HOME/Library/Caches/muxvo-build/logs/preflight-$STAMP"
mkdir -p "$LOGDIR"

# ---------- dev server 收尸（只杀自己起的） ----------
# 刻意不用 EXIT trap：实测 bash 3.2 在 set -u 致命展开错误后执行 EXIT trap 会把
# 退出码洗成 0（主闸绝不允许假绿，复现见任务 13 执行记录）。改为显式收尸：
# 全部红灯路径（run_logged / 各失败分支）与步骤 5 成功收尾都显式调 cleanup；
# 意外致命错误最多留下一个良性 vite（serve 的是本仓库 web，下次 preflight 验明
# 身份后直接复用），退出码正确性优先于进程洁癖。
VITE_PID=""
STARTED_VITE=0
CLEANED_UP=0
cleanup() {
  [ "$CLEANED_UP" = 1 ] && return 0
  CLEANED_UP=1
  if [ "$STARTED_VITE" = 1 ] && [ -n "${VITE_PID}" ] && kill -0 "${VITE_PID}" 2>/dev/null; then
    kill "${VITE_PID}" 2>/dev/null || true
    wait "${VITE_PID}" 2>/dev/null || true
  fi
  return 0
}
trap 'cleanup; trap - INT; kill -INT $$' INT
trap 'cleanup; trap - TERM; kill -TERM $$' TERM

# ---------- 步骤执行器：日志落盘，红灯打印末 20 行并退出 ----------
run_logged() { # run_logged <日志文件> <描述> <命令...>
  local log="$1" desc="$2"
  shift 2
  if "$@" >"$log" 2>&1; then
    echo "  ✓ $desc"
  else
    # 变量紧邻全角字符必须用 ${} 花括号：bash 3.2 会把多字节字符的首字节并进变量名
    echo "  ✗ $desc 红灯（完整日志: ${log}）" >&2
    echo "  ---- 日志末 20 行 ----" >&2
    tail -20 "$log" >&2 || true
    cleanup
    exit 1
  fi
}

# 子 shell 函数（不污染主 shell 工作目录）
web_tsc() ( cd "$ROOT/web" && exec npx tsc --noEmit )
web_test() ( cd "$ROOT/web" && exec npx vitest run )
vd() ( cd "$ROOT/tools/visual-diff" && exec npm run "$1" )

# ---------- 1. 桥协议 ----------
echo "[1/8] bridge codegen --check --selftest ..."
run_logged "$LOGDIR/step1-codegen.log" "codegen 五项检查 + 六反例自验" \
  node "$ROOT/bridge/codegen.mjs" --check --selftest

# ---------- 2. web 类型检查 + 单测 ----------
echo "[2/8] web tsc --noEmit + vitest run ..."
run_logged "$LOGDIR/step2-web-tsc.log" "web TypeScript 零错误" web_tsc
# 刻意不用 --passWithNoTests：glob 打错导致零测试命中必须红，不许静默假绿
run_logged "$LOGDIR/step2-web-vitest.log" "web vitest 全部通过" web_test

# ---------- 3. Swift 测试（含 SIGKILL） ----------
echo "[3/8] scripts/app.sh test（含 SIGKILL 集成，约数分钟）..."
run_logged "$LOGDIR/step3-swift-test.log" "Swift 全部测试" "$ROOT/scripts/app.sh" test

# ---------- 4. spec-runner ----------
echo "[4/8] spec-runner（176 case 1:1 归属）..."
run_logged "$LOGDIR/step4-spec-runner.log" "spec-runner 双宇宙 1:1" \
  node "$ROOT/tools/spec-runner/run.mjs"

# ---------- 5. visual-diff ----------
echo "[5/8] visual-diff（current + compare + bridge-isolation）..."

# 前置断言：playwright 复用 ../muxvo-legacy/node_modules（capture.mjs 隐式依赖）
PLAYWRIGHT_PKG="$ROOT/../muxvo-legacy/node_modules/playwright/package.json"
if [ ! -f "$PLAYWRIGHT_PKG" ]; then
  echo "  ✗ 缺少 ../muxvo-legacy/node_modules/playwright（visual-diff 复用老仓库的 playwright，" >&2
  echo "    见 tools/visual-diff/src/capture.mjs 头注释；请先在 muxvo-legacy 下 npm install）" >&2
  exit 1
fi
# 前置断言：本机 chromium headless shell（直连下载被墙，CHROMIUM_PATH 可覆盖）
# B5 起 pin 1200（1223 被 playwright GC 清理；1200 vs 冻结 golden 实测像素级等价，见 capture.mjs 头注释）
CHROMIUM_BIN="${CHROMIUM_PATH:-$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell}"
if [ ! -x "$CHROMIUM_BIN" ]; then
  echo "  ✗ 缺少 chromium headless shell: ${CHROMIUM_BIN}（可设 CHROMIUM_PATH 覆盖）" >&2
  exit 1
fi

# dev server：检测 5198 并验明身份；身份不符红灯（绝不对陌生服务截图）；不在则自起
if curl -fsS --max-time 2 http://localhost:5198/ 2>/dev/null | grep -q "<title>Muxvo</title>"; then
  echo "  ✓ 复用已运行的 5198 dev server（身份已验证）"
elif curl -fsS --max-time 2 -o /dev/null http://localhost:5198/ 2>/dev/null; then
  echo "  ✗ 5198 端口被非 Muxvo 服务占用，拒绝复用（请释放端口或停掉该服务）" >&2
  exit 1
else
  echo "  · 5198 无服务，自起 vite（退出时自动收尸）..."
  # exec 绕开 npm wrapper：拿到的 PID 即 vite 的 node 进程，kill 一次干净
  ( cd "$ROOT/web" && exec node node_modules/vite/bin/vite.js ) >"$LOGDIR/step5-vite.log" 2>&1 &
  VITE_PID=$!
  STARTED_VITE=1
  ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      echo "  ✗ vite 进程启动即退出（日志: $LOGDIR/step5-vite.log）" >&2
      tail -20 "$LOGDIR/step5-vite.log" >&2 || true
      cleanup
      exit 1
    fi
    if curl -fsS --max-time 1 http://localhost:5198/ 2>/dev/null | grep -q "<title>Muxvo</title>"; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [ "$ready" != 1 ]; then
    echo "  ✗ vite 30s 内未就绪（日志: $LOGDIR/step5-vite.log）" >&2
    cleanup
    exit 1
  fi
  # 预热：触发 vite 按需编译，避免首请求吃掉 capture 的 waitForFunction 预算
  curl -fsS --max-time 10 -o /dev/null 'http://localhost:5198/src/main.tsx' 2>/dev/null || true
  echo "  ✓ vite 就绪（PID ${VITE_PID}）"
fi

run_logged "$LOGDIR/step5-current.log" "capture current（全场景截图）" vd current
run_logged "$LOGDIR/step5-compare.log" "compare（包围盒 ≤1px + pixelmatch）" vd compare
run_logged "$LOGDIR/step5-bridge-isolation.log" "bridge-isolation（截图契约隔离 A/B）" vd bridge-isolation

# golden 完整性：老版对照基准必须字节级不变（被改 = 有人跑了 golden/all 或手贱）
if [ -n "$(git -C "$ROOT" status --porcelain -- tools/visual-diff/golden)" ]; then
  echo "  ✗ tools/visual-diff/golden/ 有改动——golden 是字节冻结的老版基准，严禁重生成：" >&2
  git -C "$ROOT" status --porcelain -- tools/visual-diff/golden >&2
  cleanup
  exit 1
fi
echo "  ✓ golden 字节级不变"
cleanup # 步骤 6/7/8 不需要 dev server，此处收尸（复用外部 server 时为 no-op）

# ---------- 6. 字面量纪律 grep ----------
# 范围限 app/ 下 *.swift：纪律管的是「代码不得另行构造数据目录路径/flag 文件名」；
# Info.plist 的 CFBundleName（"Muxvo2 Dev"）是 UI 展示名、文档/计划文件是叙述，均不在此列。
# 真正的运行时防线是 DataDirectory.forbiddenLegacyRootNames 的 fatalError 硬保护，grep 是辅助。
echo "[6/8] 字面量纪律 grep（app/ 下 *.swift）..."
ALLOW_DD="$ROOT/app/Sources/MuxvoStorage/DataDirectory.swift"
ALLOW_DD_TESTS="$ROOT/app/Tests/MuxvoStorageTests/DataDirectoryTests.swift"

viol="$(grep -rl --include='*.swift' -F 'graceful_exit.flag' "$ROOT/app" | grep -Fxv "$ALLOW_DD" || true)"
if [ -n "$viol" ]; then
  echo "  ✗ \"graceful_exit.flag\" 只允许出现在 DataDirectory.swift，违规文件：" >&2
  echo "$viol" >&2
  exit 1
fi
viol="$(grep -rl --include='*.swift' -F 'Muxvo2 Dev' "$ROOT/app" | grep -Fxv "$ALLOW_DD" | grep -Fxv "$ALLOW_DD_TESTS" || true)"
if [ -n "$viol" ]; then
  echo "  ✗ \"Muxvo2 Dev\" 只允许出现在 DataDirectory.swift 与 DataDirectoryTests.swift，违规文件：" >&2
  echo "$viol" >&2
  exit 1
fi

# dogfood-r5 W-A 共享归档池：根名字面量与权威访问器纪律（同上 Muxvo2 Dev 体例）。
ALLOW_APPDELEGATE="$ROOT/app/Sources/MuxvoAppCore/AppDelegate.swift"
viol="$(grep -rl --include='*.swift' -F 'Muxvo Shared' "$ROOT/app" | grep -Fxv "$ALLOW_DD" | grep -Fxv "$ALLOW_DD_TESTS" || true)"
if [ -n "$viol" ]; then
  echo "  ✗ \"Muxvo Shared\" 只允许出现在 DataDirectory.swift 与 DataDirectoryTests.swift，违规文件：" >&2
  echo "$viol" >&2
  exit 1
fi
# sharedChatHistoryRootURL( 调用权威：只允许 DataDirectory.swift（定义）、AppDelegate.swift（PR-4 装配注入）、测试文件。
viol="$(grep -rl --include='*.swift' -F 'sharedChatHistoryRootURL(' "$ROOT/app" | grep -Fxv "$ALLOW_DD" | grep -Fxv "$ALLOW_APPDELEGATE" | grep -v '/app/Tests/' || true)"
if [ -n "$viol" ]; then
  echo "  ✗ sharedChatHistoryRootURL( 调用只允许 DataDirectory.swift/AppDelegate.swift/测试文件，违规文件：" >&2
  echo "$viol" >&2
  exit 1
fi
# M7 升级迁移（legacy-migration.md §4）：`.muxvo` 代码字面量只允许 DataDirectory.swift（迁移源唯一派生点）、
# AppDelegate.swift（既有新手引导老版踪迹检测 MUXVO_LEGACY_TRACE_PATH 回退，先于本纪律存在）与测试文件
# （fixture 路径）。带引号前缀只抓字符串字面量，注释叙述（~/.muxvo）不误伤。
viol="$(grep -rl --include='*.swift' -F '".muxvo' "$ROOT/app" | grep -Fxv "$ALLOW_DD" | grep -Fxv "$ALLOW_APPDELEGATE" | grep -v '/app/Tests/' || true)"
if [ -n "$viol" ]; then
  echo "  ✗ \".muxvo 字面量只允许 DataDirectory.swift/AppDelegate.swift/测试文件（legacy-migration.md §4），违规文件：" >&2
  echo "$viol" >&2
  exit 1
fi
echo "  ✓ 五条字面量纪律均合规"

# ⭐R-04 发布防误触发纪律（auto-update.md；M7-PLAN R-04）：在野老客户端在拉 GitHub muxvo/muxvo 的
# latest-mac.yml——更新链路验证完成前，app 源码不得出现任何真 feed 指向：
#   a) 'latest-mac' 全 app/Sources 零容忍（老版 feed 文件名，出现即有误触发面）；
#   b) 'github.com' 不得进 app/Sources/**/*.swift（生产 feed URL 只允许经 Info.plist
#      MuxvoUpdateFeedURL / env 注入，绝不写死；依赖声明在 Package.swift 不在此列）。
viol="$(grep -rl --include='*.swift' -F 'latest-mac' "$ROOT/app/Sources" || true)"
if [ -n "$viol" ]; then
  echo "  ✗ R-04：'latest-mac' 不得出现在 app/Sources（在野老客户端 feed 文件名），违规文件：" >&2
  echo "$viol" >&2
  exit 1
fi
viol="$(grep -rl --include='*.swift' -F 'github.com' "$ROOT/app/Sources" || true)"
if [ -n "$viol" ]; then
  echo "  ✗ R-04：'github.com' 不得写死在 app/Sources（feed 只经 MuxvoUpdateFeedURL/env 注入），违规文件：" >&2
  echo "$viol" >&2
  exit 1
fi
echo "  ✓ R-04 更新 feed 纪律合规（latest-mac/github.com 零命中）"

# secret-scan 门（批1 独立裁决 2026-07-04：接入、硬红、范围严格限 fixtures/）：
# 录制 fixtures（commit 进 git 的真 CC stream-json）不得残留密钥/用户路径/用户名。
# 仓库有 auto-commit，commit 时刻无人工闸，preflight 是 push 前唯一强制闸，故此处硬红。
# 模式含 /Users/<name> 与裸 $USER，扫更宽必假阳——范围不得放大。
run_logged "$LOGDIR/step6-secret-scan.log" "contract-recorder fixtures secret-scan 零命中" \
  node "$ROOT/tools/contract-recorder/scan.mjs" "$ROOT/tools/contract-recorder/fixtures"

# ---------- 7. spec-coverage（编排规格案例池 ↔ 测试存在性 1:1 兜底）----------
# legacy 176 case 的 1:1 归属由步骤 4 spec-runner 兜底；编排规格（M4a 全新、无 legacy oracle）
# 的案例池此前无机器兜底。此步补上：提取 specs/orchestration/ 全量案例池（用例名表 + E2E 场景），
# 逐名断言在测试代码中至少出现一处，缺失即红（详见 tools/spec-coverage/check.mjs 头注）。
echo "[7/8] spec-coverage（编排案例池 ↔ 测试存在性）..."
run_logged "$LOGDIR/step7-spec-coverage.log" "编排规格案例池 1:1 覆盖" \
  node "$ROOT/tools/spec-coverage/check.mjs"

# ---------- 8. 单文件 ≤2000 行 ----------
# 文件集合 = git 跟踪的文本源码/文档（扩展名白名单——黑名单会漏 *.cast 这类大数据文件）；
# 排除 package-lock.json（机器生成锁文件）与 golden/（字节冻结基准）。
# Gen/Protocol.swift 不豁免：越过 1500 黄线正是 codegen 该拆输出文件的信号。
echo "[8/8] 单文件 ≤2000 行检查 ..."
over=0
while IFS= read -r f; do
  case "$f" in
    */package-lock.json | package-lock.json) continue ;;
    tools/visual-diff/golden/*) continue ;;
  esac
  lines=$(wc -l <"$ROOT/$f")
  if [ "$lines" -gt 2000 ]; then
    echo "  ✗ $f: $lines 行（>2000，须拆分）" >&2
    over=1
  elif [ "$lines" -gt 1500 ]; then
    echo "  ⚠ $f: $lines 行（>1500 黄线，建议规划拆分）"
  fi
done < <(git -C "$ROOT" ls-files -- '*.swift' '*.ts' '*.tsx' '*.mjs' '*.js' '*.css' '*.html' '*.sh' '*.md' '*.json' '*.yml' '*.yaml')
if [ "$over" != 0 ]; then
  exit 1
fi
echo "  ✓ 全部文件 ≤2000 行"

echo ""
echo "✅ preflight 全绿（日志目录: ${LOGDIR}）"
