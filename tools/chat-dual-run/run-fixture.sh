#!/usr/bin/env bash
# 合成语料双跑对照（chat-data.md §8）——构建 muxvo-chat-dump → 生成 fixtures → 全命令 diff（须全绿）。
# 用法：tools/chat-dual-run/run-fixture.sh
# 环境：MUXVO_SCRATCH（默认 spm-scratch）；MUXVO_LEGACY_ROOT（默认本机 legacy 路径）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRATCH="${MUXVO_SCRATCH:-$HOME/Library/Caches/muxvo-build/spm-scratch}"

echo "[run-fixture] 1/2 构建 muxvo-chat-dump ..." >&2
MUXVO_SCRATCH="$SCRATCH" "$ROOT/scripts/app.sh" build --product muxvo-chat-dump >&2
BIN="$(swift build --package-path "$ROOT/app" --scratch-path "$SCRATCH" --show-bin-path)/muxvo-chat-dump"
[ -x "$BIN" ] || { echo "[run-fixture] 未找到可执行 $BIN" >&2; exit 1; }

echo "[run-fixture] 2/2 生成 fixtures + 全命令对照 ..." >&2
CHAT_DUMP_BIN="$BIN" exec node "$HERE/run-fixture.mjs" "$@"
