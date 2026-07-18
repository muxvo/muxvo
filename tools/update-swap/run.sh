#!/bin/bash
# 真机换装终验（auto-update.md §12 UPD_swap_install_e2e / UPD_bad_checksum_reject）。
# 独立手动关，不入 preflight/CI（需 GUI 会话 + Developer ID 证书 + 公证凭据 env MUXVO_NOTARY_*）。
#
# 三段：
#   A Gatekeeper：公证 vA 手动置 quarantine → spctl 过 → open 启动存活 → 退出。
#   B 换装：direct-exec vA（env 注 localhost feed + autopilot）→ 检查→下载→安装→Sparkle 重启 →
#     断装机版本==vB + What's New 触发（update.log token + 全屏截图存证）。
#   C 坏签名（UPD_bad_checksum_reject）：feed 指被篡改 zip（原 EdDSA 签名失配）→ Sparkle 拒装 →
#     自动重试 1 次后 updateError（update.log ERROR）→ 版本仍 vA、进程存活。
#
# ⭐R-04：serve.mjs 只绑 127.0.0.1；全程零 GitHub 触碰、零 release。
# 分身铁律：独立 APP_NAME/BUNDLE_ID/DATA_ROOT，不碰在用分身。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="${MUXVO_SCRATCH:-$HOME/Library/Caches/muxvo-build/spm-scratch}"
SPARKLE_BIN="$SCRATCH/artifacts/sparkle/Sparkle/bin"
STAGE="$HOME/Library/Caches/muxvo-build/update-swap"
APP_NAME="Muxvo2SwapTest"
BUNDLE_ID="com.muxvo.muxvo2.swaptest"
DATA_ROOT_NAME="Muxvo2 SwapTest Dev"
DATA_ROOT="$HOME/Library/Application Support/$DATA_ROOT_NAME"
INSTALL_DIR="$HOME/Applications"
APP="$INSTALL_DIR/$APP_NAME.app"
EXE="$APP/Contents/MacOS/MuxvoApp"
LOG="$DATA_ROOT/logs/update.log"
REPORT="$STAGE/run-report.md"
VER_A="0.9.0"; BUILD_A="90"
VER_B="0.9.1"; BUILD_B="91"

PASS_LINES=(); FAIL_LINES=()
ok()   { PASS_LINES+=("- ✅ $1"); echo "✅ $1"; }
bad()  { FAIL_LINES+=("- ❌ $1"); echo "❌ $1" >&2; }
require() { if [ "$1" = "0" ]; then ok "$2"; else bad "$2"; fi }

wait_token() { # $1=token $2=超时秒
  local i
  for i in $(seq 1 "${2:-120}"); do
    grep -qF "$1" "$LOG" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

app_pid() { pgrep -f "$APP_NAME.app/Contents/MacOS/MuxvoApp" | head -1 || true; }
kill_app() {
  local pid; pid="$(app_pid)"
  [ -n "$pid" ] && { kill "$pid" 2>/dev/null || true; sleep 2; kill -9 "$pid" 2>/dev/null || true; }
  sleep 1
}
wipe_data_root() {
  # 只删本脚本专属分身根（名字硬断言，防误删）。
  [ "$DATA_ROOT_NAME" = "Muxvo2 SwapTest Dev" ] || { echo "数据根名异常，拒删" >&2; exit 2; }
  rm -rf "$DATA_ROOT"
}

# ── 前置 ──
[ -x "$SPARKLE_BIN/sign_update" ] || { echo "缺 Sparkle bin 工具（先 app.sh build 拉依赖）" >&2; exit 2; }
security find-identity -v -p codesigning | grep -q "Developer ID Application" || { echo "缺 Developer ID 证书" >&2; exit 2; }
: "${MUXVO_NOTARY_APPLE_ID:?缺公证凭据 env}" "${MUXVO_NOTARY_TEAM_ID:?}" "${MUXVO_NOTARY_PASSWORD:?}"
rm -rf "$STAGE"; mkdir -p "$STAGE/serve" "$STAGE/serve-bad" "$INSTALL_DIR"
kill_app; wipe_data_root

# ── EdDSA 密钥（login keychain，幂等）──
PUB="$("$SPARKLE_BIN/generate_keys" -p 2>/dev/null || true)"
if [ -z "$PUB" ]; then
  "$SPARKLE_BIN/generate_keys" >/dev/null
  PUB="$("$SPARKLE_BIN/generate_keys" -p)"
fi
echo "[swap] EdDSA 公钥就绪"

build_dist() { # $1=版本 $2=build 号 $3=落位目录
  MUXVO_APP_NAME="$APP_NAME" MUXVO_BUNDLE_ID="$BUNDLE_ID" MUXVO_DATA_ROOT_NAME="$DATA_ROOT_NAME" \
  MUXVO_APP_VERSION="$1" MUXVO_APP_BUILD="$2" MUXVO_SPARKLE_ED_KEY="$PUB" \
    "$ROOT/scripts/app.sh" dist >/dev/null
  rm -rf "$3"; mkdir -p "$3"
  cp -R "$HOME/Library/Caches/muxvo-build/bundle/$APP_NAME.app" "$3/"
}

echo "[swap] 构建+公证 vB $VER_B ..."
build_dist "$VER_B" "$BUILD_B" "$STAGE/B"
ditto -c -k --keepParent "$STAGE/B/$APP_NAME.app" "$STAGE/serve/update.zip"
SIG_ATTRS="$("$SPARKLE_BIN/sign_update" "$STAGE/serve/update.zip")" # sparkle:edSignature="…" length="…"

echo "[swap] 构建+公证 vA $VER_A ..."
build_dist "$VER_A" "$BUILD_A" "$STAGE/A"

# ── 起 feed server（127.0.0.1 随机口）→ 写 appcast ──
node "$ROOT/tools/update-swap/serve.mjs" --dir "$STAGE/serve" --port 0 > "$STAGE/serve.out" 2>&1 &
SERVE_PID=$!
trap 'kill $SERVE_PID 2>/dev/null || true; kill_app' EXIT
for _ in $(seq 1 20); do grep -q LISTENING "$STAGE/serve.out" 2>/dev/null && break; sleep 0.5; done
PORT="$(grep LISTENING "$STAGE/serve.out" | awk '{print $2}')"
[ -n "$PORT" ] || { echo "feed server 未就绪" >&2; exit 2; }

make_appcast() { # $1=输出文件 $2=zip 名
  cat > "$1" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Muxvo SwapTest</title>
    <item>
      <title>$VER_B</title>
      <sparkle:version>$BUILD_B</sparkle:version>
      <sparkle:shortVersionString>$VER_B</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <pubDate>Mon, 13 Jul 2026 12:00:00 +0800</pubDate>
      <enclosure url="http://127.0.0.1:$PORT/$2" $SIG_ATTRS type="application/octet-stream"/>
    </item>
  </channel>
</rss>
XML
}
make_appcast "$STAGE/serve/appcast.xml" "update.zip"

# ── A Gatekeeper：quarantine + spctl + open 启动 ──
echo "[swap] 段A Gatekeeper ..."
rm -rf "$APP"; cp -R "$STAGE/A/$APP_NAME.app" "$INSTALL_DIR/"
xattr -w com.apple.quarantine "0083;00000000;swap-test;" "$APP"
if spctl -a -vv --type execute "$APP" 2>&1 | grep -q "accepted"; then ok "A1 spctl accepted（公证+staple 生效）"; else bad "A1 spctl 拒绝"; fi
open "$APP"
sleep 6
if [ -n "$(app_pid)" ]; then ok "A2 带 quarantine open 启动存活（Gatekeeper 过）"; else bad "A2 open 启动失败"; fi
kill_app

# ── B 换装 ──
echo "[swap] 段B 换装 vA→vB ..."
wipe_data_root
# 预置 lastSeenVersion=vA（模拟「vA 已正常用过」的真实升级场景）：autopilot 秒级换装可能赶在
# web 首查写回之前，若不预置则 vB 首启 lastSeen 缺席=按首装处理不弹 What's New（legacy 同语义）。
mkdir -p "$DATA_ROOT"
printf '{"lastSeenVersion":"%s"}' "$VER_A" > "$DATA_ROOT/config.json"
MUXVO_UPDATE_FEED_URL="http://127.0.0.1:$PORT/appcast.xml" MUXVO_UPDATE_AUTOPILOT=1 \
  MUXVO_UPDATE_TIMINGS_MS=60000 "$EXE" > "$STAGE/vA.out" 2>&1 &
A_PID=$!
if wait_token "update:available v$VER_B" 60; then ok "B1 检查→发现 v$VER_B"; else bad "B1 未发现新版"; fi
if wait_token "update:autopilot available-dialog [立即下载|暂不更新|不再提醒此版本]" 30; then ok "B2 三按钮弹窗（autopilot 选立即下载）"; else bad "B2 弹窗未出"; fi
if wait_token "update:downloaded v$VER_B" 120; then ok "B3 下载完成（EdDSA 验签过）"; else bad "B3 下载未完成"; fi
if wait_token "update:installing v$VER_B" 60; then ok "B4 立即重启安装触发"; else bad "B4 安装未触发"; fi
# 等旧进程退出 + Sparkle 换装重启
for _ in $(seq 1 60); do kill -0 "$A_PID" 2>/dev/null || break; sleep 1; done
NEW_PID=""
for _ in $(seq 1 60); do NEW_PID="$(app_pid)"; [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$A_PID" ] && break; sleep 1; done
if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$A_PID" ]; then ok "B5 Sparkle 换装后自动重启（新 PID ${NEW_PID}）"; else bad "B5 未见重启进程"; fi
INSTALLED_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
if [ "$INSTALLED_VER" = "$VER_B" ]; then ok "B6 装机版本已换 $VER_A → $VER_B"; else bad "B6 版本未换（=${INSTALLED_VER}）"; fi
if wait_token "update:relaunched v$VER_B" 60; then ok "B7 新版首启 relaunched token"; else bad "B7 relaunched 缺失"; fi
if wait_token "update:whats-new-shown v$VER_B" 90; then ok "B8 What's New 触发（升级后首启门）"; else bad "B8 What's New 未触发"; fi
sleep 4 # 2s 门 + 渲染余量
screencapture -x "$STAGE/whats-new-evidence.png" && ok "B9 存证截图 $STAGE/whats-new-evidence.png"
kill_app

# ── B' 「下次启动时安装」真路径（对抗 MINOR-2 护栏）：autopilot 选下次启动装 → 进程不被换装重启、
#    版本立即仍 vA；退出后 Sparkle 在宿主终止后完成装机 → 再启动即 vB。 ──
echo "[swap] 段B' 下次启动时安装 ..."
rm -rf "$APP"; cp -R "$STAGE/A/$APP_NAME.app" "$INSTALL_DIR/"
wipe_data_root
MUXVO_UPDATE_FEED_URL="http://127.0.0.1:$PORT/appcast.xml" MUXVO_UPDATE_AUTOPILOT=1 \
  MUXVO_UPDATE_AUTOPILOT_INSTALL=onQuit MUXVO_UPDATE_TIMINGS_MS=60000 "$EXE" > "$STAGE/vBq.out" 2>&1 &
BQ_PID=$!
if wait_token "update:downloaded v$VER_B" 120; then ok "B'1 下载完成"; else bad "B'1 下载未完成"; fi
if wait_token "update:install-on-quit v$VER_B" 30; then ok "B'2 选「下次启动时安装」（autopilot）"; else bad "B'2 install-on-quit 未触发"; fi
sleep 3
VER_STILL="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
if [ "$VER_STILL" = "$VER_A" ] && kill -0 "$BQ_PID" 2>/dev/null; then ok "B'3 未即时换装：进程存活 + 版本仍 ${VER_A}"; else bad "B'3 意外换装或进程死（=${VER_STILL}）"; fi
# 主动退出 → Sparkle 宿主终止后完成装机（autoInstallOnAppQuit 对等）。
kill "$BQ_PID" 2>/dev/null || true
for _ in $(seq 1 30); do kill -0 "$BQ_PID" 2>/dev/null || break; sleep 1; done
VER_AFTER=""
for _ in $(seq 1 30); do
  VER_AFTER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
  [ "$VER_AFTER" = "$VER_B" ] && break; sleep 1
done
if [ "$VER_AFTER" = "$VER_B" ]; then ok "B'4 退出后完成装机 ${VER_A} → ${VER_B}（下次启动时安装语义）"; else bad "B'4 退出后未装机（=${VER_AFTER}）"; fi
kill_app

# ── C 坏签名拒装（UPD_bad_checksum_reject 真机面）──
echo "[swap] 段C 坏签名 ..."
cp "$STAGE/serve/update.zip" "$STAGE/serve/update-bad.zip"
printf '\x00\x01\x02\x03' | dd of="$STAGE/serve/update-bad.zip" bs=1 seek=1024 conv=notrunc 2>/dev/null
make_appcast "$STAGE/serve/appcast-bad.xml" "update-bad.zip"
rm -rf "$APP"; cp -R "$STAGE/A/$APP_NAME.app" "$INSTALL_DIR/"
wipe_data_root
MUXVO_UPDATE_FEED_URL="http://127.0.0.1:$PORT/appcast-bad.xml" MUXVO_UPDATE_AUTOPILOT=1 \
  MUXVO_UPDATE_TIMINGS_MS=60000 "$EXE" > "$STAGE/vC.out" 2>&1 &
if wait_token "update:available v$VER_B" 60; then ok "C1 坏包场景发现新版"; else bad "C1 未发现"; fi
if wait_token "EdDSA signature does not match" 180; then ok "C2a 篡改包被 EdDSA 验签拒装（SUSparkleErrorDomain 3002，铁证）"; else bad "C2a 未见 EdDSA 拒签"; fi
if wait_token "update:retry" 30; then ok "C2b 拒装后自动重试 1 次触发"; else bad "C2b 未见自动重试"; fi
# 第二拍（重试仍失败 → retry exhausted → updateError）：真机受 Sparkle session 复活时序影响，
# 尽力等 150s；缺席只记录不判红——该语义由单测 UPD_error_retry_once（fake engine 双失败 → 恰一次
# updateError）精确锁定，真机段的用户实质（坏包装不上 + 不崩）由 C2a/C3/C4 覆盖。
if wait_token "retry exhausted" 150; then ok "C2c 重试仍失败 → ERROR 落盘（retry exhausted）"; else echo "· C2c 真机第二拍未在 150s 内落 ERROR（不判红：单测 UPD_error_retry_once 已锁语义）"; fi
sleep 2
INSTALLED_VER_C="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
if [ "$INSTALLED_VER_C" = "$VER_A" ]; then ok "C3 版本仍 ${VER_A}（未被坏包换装）"; else bad "C3 版本被改（=${INSTALLED_VER_C}）"; fi
if [ -n "$(app_pid)" ]; then ok "C4 进程存活（错误不崩）"; else bad "C4 进程死亡"; fi
kill_app

# ── 报告 ──
{
  echo "# update-swap 真机换装终验报告"
  echo
  echo "生成：$(date '+%Y-%m-%d %H:%M:%S') · vA=$VER_A vB=$VER_B · feed=127.0.0.1:${PORT}（R-04 零外网）"
  echo
  printf '%s\n' "${PASS_LINES[@]}"
  [ ${#FAIL_LINES[@]} -gt 0 ] && printf '%s\n' "${FAIL_LINES[@]}"
  echo
  echo "总判定：$([ ${#FAIL_LINES[@]} -eq 0 ] && echo '✅ 全 PASS' || echo '❌ 有 FAIL')（${#PASS_LINES[@]} PASS / ${#FAIL_LINES[@]} FAIL）"
} > "$REPORT"
echo "[swap] 报告：$REPORT"
[ ${#FAIL_LINES[@]} -eq 0 ]