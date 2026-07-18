#!/bin/bash
# 跑一臂：run-probe.sh <label|content|icon> [bundle-id]（默认 com.muxvo.muxvo2.dev=已证被压 id）。
# 产物/截图落 ~/Library/Caches/muxvo-build/dock-badge-probe/（不进同步盘）；截图路径打到 stdout。
# ⚠️ 复用真 muxvo id 前须先 lsregister -u 注销该 id 真身（防 LS 混淆），跑完对称回滚——由调用方负责。
set -euo pipefail
ARM="${1:?arm required: label|content|icon}"
BUNDLE_ID="${2:-com.muxvo.muxvo2.dev}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/Library/Caches/muxvo-build/dock-badge-probe"
APP="$WORK/DockBadgeProbe.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
DOCK_H="${DOCK_H:-1200}"

swift build -c release --package-path "$HERE" --scratch-path "$WORK/scratch" >&2

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$WORK/shots"
cp "$WORK/scratch/release/dock-badge-probe" "$APP/Contents/MacOS/DockBadgeProbe"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleName</key><string>DockBadgeProbe</string>
  <key>CFBundleExecutable</key><string>DockBadgeProbe</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
codesign -s - --force "$APP" 2>/dev/null
"$LSREG" -f "$APP" || true

PROBE_ARM="$ARM" "$APP/Contents/MacOS/DockBadgeProbe" &
PID=$!
sleep 5
SHOT="$WORK/shots/probe-$ARM-$(date +%H%M%S).png"
screencapture -x -R0,0,140,"$DOCK_H" "$SHOT"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
echo "$SHOT"
