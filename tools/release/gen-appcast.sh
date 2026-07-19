#!/bin/bash
# 生产 appcast.xml 生成（distribution.md §4.1）。
#
# Sparkle generate_appcast 吃「装更新档的目录」（内含签名 zip）+ EdDSA 私钥 → 产 appcast.xml
# （含 enclosure url / sparkle:edSignature / version / minimumSystemVersion，minOS 从 zip 内 .app 的
#  Info.plist LSMinimumSystemVersion 推断）。SUFeedURL 指该 appcast，SUPublicEDKey 验签。
#
# ⚠️ feed 宿主 = 公开仓 muxvo/muxvo 的 GitHub Releases（2026-07-19 统一 feed 终裁：latest-mac.yml
#    与 appcast.xml 同挂该仓；enclosure url 指 release asset 下载直链）。env MUXVO_PUBLIC_REPO 可覆盖。
#
# ⚠️ 补签兜底：实测本机 generate_appcast 用外部 --ed-key-file 私钥时**不写 edSignature**
#    （sign_update 用同一私钥可签；两工具 key 处理不同）。故本脚本在 generate_appcast 后逐个
#    enclosure 校验，缺 edSignature 者用 sign_update 现算补入——保证 CI（Secret 落盘私钥）产出
#    必带签名。keychain 私钥路径下 generate_appcast 原生写签，补签步为 no-op。
#
# ⚠️⚠️R-04：本工具只在本地产 appcast.xml 文件，**不上传、不触任何 feed、不发 release**。
#
# 用法：
#   tools/release/gen-appcast.sh <archives-dir> [tag]
#     <archives-dir>  装签名 zip 的目录（如 scripts/app.sh pack 的 $MUXVO_DIST_OUT）
#     [tag]           release git tag（如 v2.0.0）；或 env MUXVO_RELEASE_TAG
#   env：
#     MUXVO_PUBLIC_REPO=<owner/repo>   feed 宿主公开仓（缺省 muxvo/muxvo）
#     MUXVO_SPARKLE_ED_KEY_FILE=<file> 私钥文件（CI 从 Secret 落盘）；缺省取登录钥匙串
#     MUXVO_SPARKLE_ED_KEY_STDIN=1     从 stdin 读私钥（CI：echo "$SECRET" | gen-appcast.sh …）
#     MUXVO_SPARKLE_ED_ACCOUNT=<name>  钥匙串账户槽（缺省 muxvo——默认槽 ed25519 属 VowKy 勿用，
#                                      2026-07-19 发版复查定谳；仅钥匙串路径生效）
#     MUXVO_APPCAST_OUT=<file>         输出 appcast 文件名（缺省 <archives-dir>/appcast.xml）
set -euo pipefail

SCRATCH="${MUXVO_SCRATCH:-$HOME/Library/Caches/muxvo-build/spm-scratch}"
SPARKLE_BIN="${MUXVO_SPARKLE_BIN:-$SCRATCH/artifacts/sparkle/Sparkle/bin}"
GEN_APPCAST="$SPARKLE_BIN/generate_appcast"
SIGN_UPDATE="$SPARKLE_BIN/sign_update"

ARCHIVES_DIR="${1:-}"
TAG="${2:-${MUXVO_RELEASE_TAG:-}}"
PUBLIC_REPO="${MUXVO_PUBLIC_REPO:-muxvo/muxvo}"   # 统一 feed 终裁（2026-07-19）

[ -n "$ARCHIVES_DIR" ] || { echo "用法: gen-appcast.sh <archives-dir> [tag]（详见脚本头）" >&2; exit 2; }
[ -d "$ARCHIVES_DIR" ] || { echo "错误：archives 目录不存在：$ARCHIVES_DIR" >&2; exit 2; }
[ -x "$GEN_APPCAST" ] || { echo "错误：未找到 generate_appcast（$GEN_APPCAST）。先 scripts/app.sh build 拉依赖。" >&2; exit 2; }
[ -x "$SIGN_UPDATE" ] || { echo "错误：未找到 sign_update（$SIGN_UPDATE）。" >&2; exit 2; }
[ -n "$TAG" ] || { echo "错误：缺 release tag（arg2 或 MUXVO_RELEASE_TAG，如 v2.0.0）。" >&2; exit 2; }

# enclosure 下载前缀 = 公开仓 release asset 直链。
DL_PREFIX="https://github.com/$PUBLIC_REPO/releases/download/$TAG/"

OUT="${MUXVO_APPCAST_OUT:-$ARCHIVES_DIR/appcast.xml}"

# zip-only staging（2026-07-19 发版实跑抓坑）：generate_appcast 遇同版本 zip+dmg 同目录判
# 「Duplicate updates」硬拒（pack 产物目录恰是这形态）。appcast enclosure 只该指 zip——
# staging 目录只收 *.zip 喂 generate_appcast，dmg 留在原目录不入 feed。
STAGE="$(mktemp -d)"
CLEAN_KEYFILE=""
trap 'rm -rf "$STAGE"; [ -n "$CLEAN_KEYFILE" ] && rm -f "$CLEAN_KEYFILE"' EXIT
shopt -s nullglob
zips=("$ARCHIVES_DIR"/*.zip)
shopt -u nullglob
[ ${#zips[@]} -gt 0 ] || { echo "错误：$ARCHIVES_DIR 内无 zip（appcast enclosure 只吃 zip）。" >&2; exit 2; }
cp "${zips[@]}" "$STAGE/"

# 私钥来源归一到 KEYFILE（空 = 登录钥匙串）。stdin 落 0600 临时文件（generate_appcast + 补签复用）。
KEYFILE=""
if [ -n "${MUXVO_SPARKLE_ED_KEY_FILE:-}" ]; then
  KEYFILE="$MUXVO_SPARKLE_ED_KEY_FILE"
elif [ "${MUXVO_SPARKLE_ED_KEY_STDIN:-}" = "1" ]; then
  KEYFILE="$(mktemp)"; CLEAN_KEYFILE="$KEYFILE"
  chmod 600 "$KEYFILE"; cat > "$KEYFILE"
fi
ED_ACCOUNT="${MUXVO_SPARKLE_ED_ACCOUNT:-muxvo}"
KEY_ARGS=()
if [ -n "$KEYFILE" ]; then
  KEY_ARGS=(--ed-key-file "$KEYFILE")
else
  # 钥匙串路径：显式账户槽（默认槽 ed25519 属 VowKy 项目，绝不能拿它签 Muxvo 更新）。
  KEY_ARGS=(--account "$ED_ACCOUNT")
fi

echo "[appcast] 生成 → $OUT" >&2
echo "[appcast]   archives=$ARCHIVES_DIR  tag=$TAG  repo=$PUBLIC_REPO" >&2
echo "[appcast]   enclosure 前缀=$DL_PREFIX" >&2

# --maximum-deltas 0：不产增量（异构工件无老基线可差分，只发全量 zip；对齐 §4.2「不发 blockmap」哲学）。
"$GEN_APPCAST" \
  --download-url-prefix "$DL_PREFIX" \
  --maximum-deltas 0 \
  -o "$OUT" \
  "${KEY_ARGS[@]}" \
  "$STAGE"

# 补签：逐个 enclosure，缺 sparkle:edSignature 者用 sign_update 现算补入。
python3 - "$OUT" "$STAGE" "$SIGN_UPDATE" "${KEYFILE}" "${ED_ACCOUNT}" <<'PY'
import sys, re, os, subprocess
out, arch_dir, sign_update, keyfile, account = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
xml = open(out, encoding="utf-8").read()
backfilled = 0
def fix(m):
    global backfilled
    tag = m.group(0)
    if "sparkle:edSignature" in tag:
        return tag
    url = re.search(r'url="([^"]+)"', tag)
    if not url:
        return tag
    fname = os.path.basename(url.group(1))
    local = os.path.join(arch_dir, fname)
    if not os.path.exists(local):
        return tag
    cmd = [sign_update]
    if keyfile:
        cmd += ["--ed-key-file", keyfile]
    else:
        cmd += ["--account", account]
    cmd += [local]
    res = subprocess.run(cmd, capture_output=True, text=True)
    sig = re.search(r'sparkle:edSignature="([^"]+)"', res.stdout)
    if not sig:
        sys.stderr.write(f"[appcast]   ⚠️ 补签失败（{fname}）：sign_update 无输出签名\n")
        return tag
    backfilled += 1
    return tag[:-2] + f' sparkle:edSignature="{sig.group(1)}"/>'
new = re.sub(r'<enclosure\b[^>]*/>', fix, xml)
if new != xml:
    open(out, "w", encoding="utf-8").write(new)
sys.stderr.write(f"[appcast]   补签 {backfilled} 个 enclosure（generate_appcast 已签则为 0）\n")
PY

echo "[appcast] 完成：$OUT" >&2
echo "[appcast] ⚠️ R-04：本文件仅本地产物，未上传任何 feed。上架 = 用户逐件点头（D7'）。" >&2
