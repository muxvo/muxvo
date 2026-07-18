#!/bin/bash
# 终端 golden 生成/复跑（terminal-rendering.md §6）。
# 门控跑 MuxvoTermGoldenTests → 用 TerminalRenderer.renderOffscreen 同 encode 路径渲固定 fixture
# → tools/term-golden/golden/<id>.png + SHASUMS256.txt。需 GPU；无 GPU/headless 时生成器早退降级待补。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "==> 生成终端 golden（MUXVO_TERM_GOLDEN=1，MuxvoTermGoldenTests）" >&2
MUXVO_TERM_GOLDEN=1 "$ROOT/scripts/app.sh" test --filter TermGoldenGenerator "$@"
echo "==> golden 落 $ROOT/tools/term-golden/golden/（即截即 commit，人复核后提交）" >&2
ls -la "$ROOT/tools/term-golden/golden/" >&2 || true
