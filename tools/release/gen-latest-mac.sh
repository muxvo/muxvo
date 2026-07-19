#!/bin/bash
# 老客户端 electron-updater feed 文件 latest-mac.yml 生成（distribution.md §4.2，Path A 用）。
#
# 格式 = spike 实测最小充分集（M7 批0 spike-report + 老 dist 样本对拍）：
#   version + files:[{url, sha512(base64), size}] + 顶层 path + 顶层 sha512 + releaseDate。
#   · sha512 = **base64**（非 hex）：openssl dgst -sha512 -binary | base64。
#   · url/path = **zip 文件名**（相对 release asset；github provider 老客户端自拼下载直链）。
#   ⚠️必须指 **zip**（Squirrel.Mac 装 zip 内 .app）——老 dist 里 Mar 31 的 dmg 形态样本勿照抄。
#   ⚠️不产 blockmap（J7：异构工件无老基线可差分，只发 zip 强制全量下载）。
#
# ⚠️⚠️R-04：本工具只在本地产 latest-mac.yml 文件，**不上传、不触任何 feed、不发 release**。
#   在野老客户端 feed 硬指 muxvo/muxvo——latest-mac.yml 挂上该仓 release 那一刻即全量开闸，
#   上架 = 升级链路端到端验证完 + 用户明确点头后的最后一步。
#
# 用法：
#   tools/release/gen-latest-mac.sh <zip-path> [version]
#     <zip-path>  签名+公证后打包的更新 zip（scripts/app.sh pack 产物）
#     [version]   语义版本（如 2.0.0）；缺省从文件名 <name>-<version>-<arch>.zip 推
#   env：
#     MUXVO_LATEST_MAC_OUT=<file>  输出文件（缺省 <zip 同目录>/latest-mac.yml）
set -euo pipefail

ZIP="${1:-}"
VERSION="${2:-}"

[ -n "$ZIP" ] || { echo "用法: gen-latest-mac.sh <zip-path> [version]（详见脚本头）" >&2; exit 2; }
[ -f "$ZIP" ] || { echo "错误：zip 不存在：$ZIP" >&2; exit 2; }
case "$ZIP" in
  *.zip) ;;
  *) echo "错误：latest-mac.yml 必须指 zip（Squirrel 装 zip 内 .app），拿到：$ZIP" >&2; exit 2 ;;
esac

FNAME="$(basename "$ZIP")"
if [ -z "$VERSION" ]; then
  # 从 <name>-<version>-<arch>.zip 推版本（对齐老 artifactName 命名）。
  VERSION="$(echo "$FNAME" | sed -nE 's/^.*-([0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?)-(arm64|x64)\.zip$/\1/p')"
  [ -n "$VERSION" ] || { echo "错误：无法从文件名推版本（$FNAME），请显式传 version 参数。" >&2; exit 2; }
fi

OUT="${MUXVO_LATEST_MAC_OUT:-$(dirname "$ZIP")/latest-mac.yml}"

SHA512="$(openssl dgst -sha512 -binary "$ZIP" | base64)"
SIZE="$(stat -f%z "$ZIP")"
RELEASE_DATE="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

cat > "$OUT" <<YAML
version: $VERSION
files:
  - url: $FNAME
    sha512: $SHA512
    size: $SIZE
path: $FNAME
sha512: $SHA512
releaseDate: '$RELEASE_DATE'
YAML

echo "[latest-mac] 完成：$OUT" >&2
echo "[latest-mac]   version=$VERSION  file=$FNAME  size=$SIZE" >&2
echo "[latest-mac] ⚠️ R-04：本文件仅本地产物，未上传任何 feed。上架 = 用户点头后的最后一步。" >&2
echo "$OUT"
