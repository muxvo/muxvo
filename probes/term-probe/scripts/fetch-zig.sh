#!/usr/bin/env bash
# 下载并校验 ghostty 构建所需的 zig 工具链（版本锁定见 probes/VERSIONS.md）。
# 工具链放在坚果云同步盘之外的缓存目录，不进仓库。
set -euo pipefail

ZIG_VERSION="0.15.2"
ZIG_SHA256="3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b"
ARCH="aarch64-macos"
CACHE_DIR="$HOME/Library/Caches/muxvo-build"
DEST="$CACHE_DIR/zig-$ZIG_VERSION"

if [ -x "$DEST/zig" ] && [ "$("$DEST/zig" version)" = "$ZIG_VERSION" ]; then
  echo "zig $ZIG_VERSION 已就绪：$DEST"
  exit 0
fi

mkdir -p "$CACHE_DIR"
cd "$CACHE_DIR"
TARBALL="zig-$ARCH-$ZIG_VERSION.tar.xz"
echo "下载 zig $ZIG_VERSION ..."
curl -sLO "https://ziglang.org/download/$ZIG_VERSION/$TARBALL"
echo "$ZIG_SHA256  $TARBALL" | shasum -a 256 -c -
tar xf "$TARBALL"
rm -rf "$DEST"
mv "zig-$ARCH-$ZIG_VERSION" "$DEST"
"$DEST/zig" version
echo "zig 安装完成：$DEST"
