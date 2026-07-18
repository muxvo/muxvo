#!/usr/bin/env bash
# 构建 libghostty 双产物并拷贝到 vendor/artifacts/（gitignored）。
# Track A: GhosttyKit.xcframework（完整嵌入 API，含内置 Metal 渲染）—— pin tag v1.3.1
# Track B: libghostty-vt（headless 终端核心，主候选）—— pin main commit
#   ⚠️ 双 pin 原因：vt 的终端状态 C API（terminal/screen/render/formatter）截至 2026-06
#   只存在于 main，v1.3.1 tag 的 vt.h 只有 OSC/SGR/key 解析器。详见 probes/VERSIONS.md。
set -euo pipefail

GHOSTTY_TAG="v1.3.1"
GHOSTTY_COMMIT="332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28"
VT_MAIN_COMMIT="69095e298ab88bb0eb5ba541f4c505f2c22d07f5"
ZIG_VERSION="0.15.2"
CACHE_DIR="$HOME/Library/Caches/muxvo-build"
SRC="$CACHE_DIR/ghostty"
SRC_MAIN="$CACHE_DIR/ghostty-main"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 产物实体放缓存目录（坚果云同步盘外，135MB+），仓库内 vendor/artifacts 是指向它的符号链接
ARTIFACTS="$CACHE_DIR/artifacts"
LINK="$SCRIPT_DIR/../vendor/artifacts"
mkdir -p "$SCRIPT_DIR/../vendor"
[ -L "$LINK" ] || ln -s "$ARTIFACTS" "$LINK"

# --package-release：把已构建的 artifacts 打 tar 上传到本仓库 GitHub release，
# 供 CI 方案 B（macOS job）拉取解包。只打包不重建 ghostty（无需 zig）；pin 短 sha
# 从 probes/VERSIONS.md 读，与 ci.yml 的 grep 逻辑保持一致，防漂移。
if [ "${1:-}" = "--package-release" ]; then
  VERSIONS_MD="$SCRIPT_DIR/../../VERSIONS.md"
  VT_SHA="$(grep 'main commit' "$VERSIONS_MD" | grep -oE '[0-9a-f]{40}' | head -1)"
  [ -n "$VT_SHA" ] || { echo "无法从 $VERSIONS_MD 读取 Track B main commit（40-hex）"; exit 1; }
  SHORT_SHA="${VT_SHA:0:12}"
  TAG="vendor-ghostty-$SHORT_SHA"
  TARBALL="$CACHE_DIR/$TAG.tar.gz"

  [ -f "$ARTIFACTS/lib/libghostty-vt.a" ] || { echo "缺 $ARTIFACTS/lib/libghostty-vt.a——先跑 build-ghostty.sh（无参数）"; exit 1; }
  [ -d "$ARTIFACTS/include/ghostty" ]     || { echo "缺 $ARTIFACTS/include/ghostty——先跑 build-ghostty.sh（无参数）"; exit 1; }

  echo "=== 打包 vendor 产物 -> $TARBALL (pin $VT_SHA) ==="
  # 相对 $ARTIFACTS 打包：解包后恰好重建 artifacts/include + artifacts/lib/libghostty-vt.a
  tar -C "$ARTIFACTS" -czf "$TARBALL" include lib/libghostty-vt.a
  ls -lh "$TARBALL"

  if ! command -v gh >/dev/null 2>&1; then
    echo "SKIPPED: 未装 gh CLI，无法上传 release（tar 已在本地 ${TARBALL}，需人工上传或授权后重跑）"; exit 0
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "SKIPPED: gh 未登录（先 gh auth login），无法上传 release（tar 已在本地 ${TARBALL}）"; exit 0
  fi

  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "release $TAG 已存在，跳过 create"
  else
    echo "=== 创建 release $TAG ==="
    gh release create "$TAG" --title "$TAG" \
      --notes "libghostty-vt vendor 产物（Track B main ${VT_SHA}），供 CI 方案 B 拉取。内容：include/ + lib/libghostty-vt.a。由 build-ghostty.sh --package-release 生成。"
  fi
  echo "=== 上传 ${TARBALL}（--clobber 覆盖同名资产）==="
  gh release upload "$TAG" "$TARBALL" --clobber
  echo "完成: $TAG"
  exit 0
fi

export PATH="$CACHE_DIR/zig-$ZIG_VERSION:$PATH"
command -v zig >/dev/null || { echo "zig 未就绪，先跑 fetch-zig.sh"; exit 1; }

if [ ! -d "$SRC/.git" ]; then
  git clone --filter=blob:none https://github.com/ghostty-org/ghostty.git "$SRC"
fi
cd "$SRC"
git fetch -q --tags origin
git checkout -q "$GHOSTTY_TAG"
ACTUAL="$(git rev-parse HEAD)"
[ "$ACTUAL" = "$GHOSTTY_COMMIT" ] || { echo "tag 漂移！期望 $GHOSTTY_COMMIT 实际 $ACTUAL —— 更新 VERSIONS.md 后再继续"; exit 1; }

echo "=== Track A: GhosttyKit.xcframework @ $GHOSTTY_TAG (native, i18n off) ==="
# -Demit-macos-app=false：探针只要 xcframework；Ghostty.app 打包在 Xcode 16.2 下编译失败（DockTilePlugin），且非所需
zig build -Demit-xcframework=true -Demit-macos-app=false -Dxcframework-target=native -Di18n=false -Doptimize=ReleaseFast

echo "=== Track B: libghostty-vt @ main $VT_MAIN_COMMIT ==="
if [ ! -d "$SRC_MAIN" ]; then
  git -C "$SRC" fetch -q origin main
  git -C "$SRC" worktree add "$SRC_MAIN" "$VT_MAIN_COMMIT"
fi
cd "$SRC_MAIN"
git checkout -q "$VT_MAIN_COMMIT"
# main 上是 -Demit-lib-vt 选项（v1.3.1 是 lib-vt step，两边不同，均为实测）
zig build -Demit-lib-vt=true -Doptimize=ReleaseFast

echo "=== 拷贝产物 ==="
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS/lib" "$ARTIFACTS/include"
cp -R "$SRC/macos/GhosttyKit.xcframework" "$ARTIFACTS/"
cp -R "$SRC/include/ghostty.h" "$ARTIFACTS/include/"          # Track A 嵌入 API 头
find "$SRC_MAIN/zig-out/lib" \( -name "libghostty-vt*.a" -o -name "libghostty-vt*.dylib" \) -exec cp -R {} "$ARTIFACTS/lib/" \;
cp -R "$SRC_MAIN/zig-out/include/ghostty" "$ARTIFACTS/include/" 2>/dev/null \
  || cp -R "$SRC_MAIN/include/ghostty" "$ARTIFACTS/include/"   # vt.h + 子头文件
# 终端运行时资源（terminfo 等，Track A app 需要）
[ -d "$SRC/zig-out/share" ] && cp -R "$SRC/zig-out/share" "$ARTIFACTS/resources"

echo "=== 产物清单 ==="
find "$ARTIFACTS" -maxdepth 3 -not -path "*GhosttyKit.xcframework/*" | head -30
du -sh "$ARTIFACTS/GhosttyKit.xcframework"
