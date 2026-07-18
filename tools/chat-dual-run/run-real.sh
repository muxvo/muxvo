#!/usr/bin/env bash
# 真数据双跑对照（chat-data.md §8）——构建 muxvo-chat-dump → 对本机真实 CC/Codex 语料 per-source 对照。
#
# ⚠️ 只读：本脚本绝不传 --mirror、绝不写 ~/.claude 或 ~/.codex。
# runbook：跑前请**暂停活跃 CC 会话**（活跃会话在 legacy/new 两次读之间追加文件 → 伪差异）。
#
# 用法：tools/chat-dual-run/run-real.sh
# 环境：MUXVO_SCRATCH；MUXVO_LEGACY_ROOT；CC_BASE（默认 ~/.claude/projects）；
#       CODEX_BASE（默认 ~/.codex/sessions）；SAMPLE_N（默认 25）；OUT_DIR。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRATCH="${MUXVO_SCRATCH:-$HOME/Library/Caches/muxvo-build/spm-scratch}"

echo "[run-real] 构建 muxvo-chat-dump ..." >&2
MUXVO_SCRATCH="$SCRATCH" "$ROOT/scripts/app.sh" build --product muxvo-chat-dump >&2
BIN="$(swift build --package-path "$ROOT/app" --scratch-path "$SCRATCH" --show-bin-path)/muxvo-chat-dump"
[ -x "$BIN" ] || { echo "[run-real] 未找到可执行 $BIN" >&2; exit 1; }

echo "[run-real] per-source 真数据对照（只读）..." >&2
CHAT_DUMP_BIN="$BIN" exec node "$HERE/run-real.mjs" "$@"
