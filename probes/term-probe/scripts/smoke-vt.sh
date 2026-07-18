#!/usr/bin/env bash
# 编译并运行 libghostty-vt C 冒烟测试（构建产物需先由 build-ghostty.sh 就绪）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
A="$HOME/Library/Caches/muxvo-build/artifacts"
[ -f "$A/lib/libghostty-vt.a" ] || { echo "产物缺失，先跑 build-ghostty.sh"; exit 1; }
clang -I"$A/include" "$SCRIPT_DIR/smoke-vt.c" "$A/lib/libghostty-vt.a" -lc++ -o /tmp/muxvo-smoke-vt
/tmp/muxvo-smoke-vt
