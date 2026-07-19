#!/bin/bash
# Muxvo app 包构建入口（唯一入口纪律）：
# --scratch-path 把 .build 指到坚果云同步盘外（CLAUDE.md 工程纪律）。
# 偶发的 app/.build（IDE 索引产生）允许存在，已被 .gitignore 覆盖，体积可删。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="${MUXVO_SCRATCH:-$HOME/Library/Caches/muxvo-build/spm-scratch}"
# vendor 产物实体放缓存目录（坚果云外，libghostty-vt.a 等），app/vendor/artifacts
# 是指向它的符号链接（.gitignore 已忽略）。build-ghostty.sh 生产产物，此处只保证链接存在。
VENDOR_CACHE="$HOME/Library/Caches/muxvo-build/artifacts"
VENDOR_LINK="$ROOT/app/vendor/artifacts"

# --- dogfood 本地安装（bundle/install）常量 ---
# 组装在缓存目录（坚果云外）做，install 再拷进应用程序目录。
# 分身安装（2026-07-06）：三 env 可覆盖打出并行 app（如验收期 Muxvo3 不打扰在用 Muxvo2）——
#   MUXVO_APP_NAME=Muxvo3 MUXVO_BUNDLE_ID=com.muxvo.muxvo3.dev \
#   MUXVO_DATA_ROOT_NAME="Muxvo3 Dev" scripts/app.sh install
# MUXVO_DATA_ROOT_NAME 经 Info.plist MuxvoDataRootName 键进 DataDirectory.defaultDevRoot()，
# 数据/防双开锁随之分离。缺省全部 = 原 Muxvo2 行为零变。
APP_NAME="${MUXVO_APP_NAME:-Muxvo2}"      # .app 目录名 + CFBundleName（M7 定终名，避让老 Muxvo）
BUNDLE_ID="${MUXVO_BUNDLE_ID:-com.muxvo.muxvo2.dev}" # dev bundle id；install 删旧前据此核身，防误删同名
# CFBundleExecutable + Contents/MacOS/ 内可执行文件名（distribution.md §1.1 升级承接硬约束）：
# dev/dogfood 默认 MuxvoApp（SwiftPM 产物名，行为零变）；**发布路径**须置 Muxvo——老版升级经
# Squirrel useUpdateBundleName 按可执行名/bundle 名重命名安装件，不对齐会把老 Muxvo.app 装成 MuxvoApp.app。
EXE_NAME="${MUXVO_EXECUTABLE_NAME:-MuxvoApp}"
# 发布身份完整 env 配方（distribution.md §1.1；本步只改打包脚本、不实发布 = R-04）：
#   MUXVO_APP_NAME=Muxvo MUXVO_EXECUTABLE_NAME=Muxvo MUXVO_BUNDLE_ID=com.muxvo.app \
#   MUXVO_DATA_ROOT_NAME=Muxvo2 MUXVO_APP_VERSION=2.0.0 scripts/app.sh bundle
#   → CFBundleExecutable=Muxvo / CFBundleName=Muxvo / Muxvo.app / appId=com.muxvo.app /
#     发布数据根 Muxvo2（DataDirectory.Layout.releaseRootName，经 MuxvoDataRootName plist 键）/ 版本 2.0.0。
#   缺省全部 = 原 dev（Muxvo2.app / MuxvoApp / com.muxvo.muxvo2.dev / Muxvo2 Dev 数据根），零变。
DATA_ROOT_NAME="${MUXVO_DATA_ROOT_NAME:-}" # 空 = 不注 plist 键，app 用码内默认 Muxvo2 Dev
# dogfood-r5 W-A 共享归档池根名（Application Support 下目录名）：经 Info.plist MuxvoSharedRootName
# 键进 DataDirectory.defaultSharedRoot()。空 = 不注 plist 键，app 用码内默认 "Muxvo Shared"（所有分身共用）。
SHARED_ROOT_NAME="${MUXVO_SHARED_ROOT_NAME:-}"
BUNDLE_STAGE="$HOME/Library/Caches/muxvo-build/bundle"
BUNDLE_PATH="$BUNDLE_STAGE/$APP_NAME.app"
# 可分发件产出目录（批1，distribution.md §3）：zip（Sparkle/electron-updater enclosure）+ DMG
# （官网下载 / Path C）落此。默认 bundle 同级 dist/；MUXVO_DIST_OUT 可覆盖。
DIST_OUT="${MUXVO_DIST_OUT:-$BUNDLE_STAGE/dist}"
# 图标是人类打磨资产，可继承（老仓库 build/icon.icns）；缺失则无图标（generic）。
LEGACY_ICON="$ROOT/../muxvo-legacy/build/icon.icns"

# 构建/运行/测试前保证 vendor 符号链接就位。
# MUXVO_NO_VENDOR=1（逃生舱）时跳过——Package.swift 已剔除依赖 vendor 的 target。
ensure_vendor() {
  [ "${MUXVO_NO_VENDOR:-}" = "1" ] && return 0
  if [ -e "$VENDOR_LINK" ]; then
    return 0
  fi
  if [ -d "$VENDOR_CACHE" ]; then
    mkdir -p "$ROOT/app/vendor"
    ln -s "$VENDOR_CACHE" "$VENDOR_LINK"
    echo "已创建 vendor 符号链接: $VENDOR_LINK -> $VENDOR_CACHE" >&2
    return 0
  fi
  echo "错误: 未找到 vendor 产物 $VENDOR_CACHE" >&2
  echo "  先构建 libghostty 产物：" >&2
  echo "    probes/term-probe/scripts/fetch-zig.sh" >&2
  echo "    probes/term-probe/scripts/build-ghostty.sh" >&2
  echo "  或临时降级（不含终端）：MUXVO_NO_VENDOR=1 scripts/app.sh $cmd" >&2
  exit 1
}

# 组装 $BUNDLE_PATH（双击即开的 .app）：web 静态构建 → swift release → 拷贝 → ad-hoc 签名。
# 产物落缓存目录（坚果云外）；结果路径存全局 $BUNDLE_PATH（不经命令替换，避免吞构建输出）。
do_bundle() {
  echo "[bundle] 1/5 web 静态构建（npm run build → dist/）..." >&2
  ( cd "$ROOT/web" && npm run build )

  echo "[bundle] 2/5 swift build -c release ..." >&2
  swift build --package-path "$ROOT/app" --scratch-path "$SCRATCH" -c release
  local binpath exe
  binpath="$(swift build --package-path "$ROOT/app" --scratch-path "$SCRATCH" -c release --show-bin-path)"
  exe="$binpath/MuxvoApp"
  [ -x "$exe" ] || { echo "错误：未找到 release 可执行文件 $exe" >&2; exit 1; }

  echo "[bundle] 3/5 组装 $BUNDLE_PATH ..." >&2
  rm -rf "$BUNDLE_PATH"
  mkdir -p "$BUNDLE_PATH/Contents/MacOS" "$BUNDLE_PATH/Contents/Resources/web"
  # 目标文件名 = CFBundleExecutable（$EXE_NAME）；源恒 SwiftPM 产物 MuxvoApp，发布路径重命名为 Muxvo。
  cp "$exe" "$BUNDLE_PATH/Contents/MacOS/$EXE_NAME"

  # Sparkle.framework（自动更新引擎，@rpath 动态链接）：嵌 Contents/Frameworks + 补 bundle 相对 rpath
  #（swift build 只写构建目录绝对 rpath，装机后不存在）。
  if [ -d "$binpath/Sparkle.framework" ]; then
    mkdir -p "$BUNDLE_PATH/Contents/Frameworks"
    cp -R "$binpath/Sparkle.framework" "$BUNDLE_PATH/Contents/Frameworks/"
    install_name_tool -add_rpath "@executable_path/../Frameworks" \
      "$BUNDLE_PATH/Contents/MacOS/$EXE_NAME" 2>/dev/null || true
  fi
  # web 前端：dist/ 内容进 Resources/web/（PanelViewController 解析序②按此 file:// 加载）
  cp -R "$ROOT/web/dist/." "$BUNDLE_PATH/Contents/Resources/web/"
  # 操作指南（B3 GuideProvisioner 解析序②）：启动时拷入数据根，帮助会话 claude 读之。
  cp "$ROOT/docs/muxvo-guide.md" "$BUNDLE_PATH/Contents/Resources/muxvo-guide.md"

  # What's New 数据源（auto-update.md §7）：随包 CHANGELOG 双语（WhatsNewService 读 Resources/）。
  cp "$ROOT/CHANGELOG.zh.md" "$ROOT/CHANGELOG.en.md" "$BUNDLE_PATH/Contents/Resources/"
  local data_root_entry=""
  if [ -n "$DATA_ROOT_NAME" ]; then
    data_root_entry="
	<key>MuxvoDataRootName</key>
	<string>$DATA_ROOT_NAME</string>"
  fi
  local shared_root_entry=""
  if [ -n "$SHARED_ROOT_NAME" ]; then
    shared_root_entry="
	<key>MuxvoSharedRootName</key>
	<string>$SHARED_ROOT_NAME</string>"
  fi
  # Sparkle EdDSA 公钥（批7 真机换装终验用；生产密钥流程归 M7 批1/批9）：注 SUPublicEDKey。
  local sparkle_key_entry=""
  if [ -n "${MUXVO_SPARKLE_ED_KEY:-}" ]; then
    sparkle_key_entry="
	<key>SUPublicEDKey</key>
	<string>$MUXVO_SPARKLE_ED_KEY</string>"
  fi
  # Sparkle 更新 feed（UpdateAssembly.feedURL 解析序②）：注 MuxvoUpdateFeedURL。缺省不注 =
  # dev 无 feed（updater 不装配）。发布路径必给（appcast 挂公开仓 release，distribution.md §4.1），
  # 否则发布包无更新链——2.0.0 装机后永远收不到后续版本。
  local feed_url_entry=""
  if [ -n "${MUXVO_UPDATE_FEED_URL:-}" ]; then
    feed_url_entry="
	<key>MuxvoUpdateFeedURL</key>
	<string>$MUXVO_UPDATE_FEED_URL</string>"
  fi
  # 埋点启用门（analytics.md §2）：bundle 默认注入（发布/dogfood 即生效；swift run/e2e/单测无此键恒关）。
  # 对抗 N-2：测试分身（MUXVO_DATA_ROOT_NAME 非默认）默认**不注**——开发期分身流量不污染生产指标；
  # MUXVO_ANALYTICS_BUNDLE=0/1 显式覆盖两个方向均可；运行期 env MUXVO_ANALYTICS=0/1 仍可强制（AnalyticsGate）。
  local analytics_default=1
  if [ -n "${MUXVO_DATA_ROOT_NAME:-}" ]; then analytics_default=0; fi
  local analytics_entry=""
  if [ "${MUXVO_ANALYTICS_BUNDLE:-$analytics_default}" = "1" ]; then
    analytics_entry='
	<key>MuxvoAnalyticsEnabled</key>
	<true/>'
  fi
  local icon_entry=""
  if [ -f "$LEGACY_ICON" ]; then
    cp "$LEGACY_ICON" "$BUNDLE_PATH/Contents/Resources/icon.icns"
    icon_entry='
	<key>CFBundleIconFile</key>
	<string>icon</string>'
  else
    echo "  · 未找到 $LEGACY_ICON，bundle 暂无图标（generic）" >&2
  fi
  # 独立完整 plist（bundle 场景下 Bundle.main 读此文件，非 -sectcreate 段）。
  # NSAllowsLocalNetworking 保留：兜底 localhost:5198 分支（无内置 web 时）不被 ATS 拦。
  cat > "$BUNDLE_PATH/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>$EXE_NAME</string>
	<key>CFBundleIdentifier</key>
	<string>$BUNDLE_ID</string>
	<key>CFBundleName</key>
	<string>$APP_NAME</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${MUXVO_APP_VERSION:-0.1.0}</string>
	<key>CFBundleVersion</key>
	<string>${MUXVO_APP_BUILD:-1}</string>
	<key>LSMinimumSystemVersion</key>
	<string>14.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>$data_root_entry$shared_root_entry$sparkle_key_entry$feed_url_entry$analytics_entry$icon_entry
</dict>
</plist>
PLIST

  # 签名身份（DOGFOOD_M3_14 + 批6 公证重构）：优先 Developer ID——ad-hoc 签名的 code requirement 按
  # CDHash 记账、每次构建都变，macOS TCC 授权不跨重装累积。Developer ID 分支改**由内而外嵌套签名 +
  # hardened runtime + 真时间戳**（notarytool 硬要求；弃 --deep——它不保证嵌套件签名序且吞 options）：
  # Sparkle 内部件（XPC → Autoupdate/Updater.app → framework 本体，官方非 Xcode 分发指引序；--force
  # 换我方身份满足库校验同 Team）→ 最外层 app。零 entitlements 起步
  # （PTY fork/exec、WKWebView、Metal 均不需；如真机验出缺项再逐项登记）。
  # 证书缺失（他机/CI）回落 ad-hoc --deep --timestamp=none（dogfood 旧行为，不可公证）。
  local sign_id
  sign_id=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')
  if [ -n "$sign_id" ]; then
    echo "[bundle] 4/5 codesign（由内而外 + hardened runtime + timestamp；${sign_id}）..." >&2
    local sparkle_fw="$BUNDLE_PATH/Contents/Frameworks/Sparkle.framework"
    if [ -d "$sparkle_fw" ]; then
      local nested
      for nested in "$sparkle_fw/Versions/B/XPCServices/"*.xpc \
                    "$sparkle_fw/Versions/B/Autoupdate" \
                    "$sparkle_fw/Versions/B/Updater.app"; do
        [ -e "$nested" ] || continue
        codesign --force --options runtime --timestamp --sign "$sign_id" "$nested"
      done
      codesign --force --options runtime --timestamp --sign "$sign_id" "$sparkle_fw"
    fi
    codesign --force --options runtime --timestamp --sign "$sign_id" "$BUNDLE_PATH"
  else
    echo "[bundle] 4/5 codesign（ad-hoc 回落：未找到 Developer ID 证书；TCC 授权将不跨重装累积、不可公证）..." >&2
    codesign --force --deep --sign - "$BUNDLE_PATH"
  fi

  echo "[bundle] 5/5 校验 ..." >&2
  plutil -lint "$BUNDLE_PATH/Contents/Info.plist" >&2
  codesign -dv "$BUNDLE_PATH" 2>&1 | head -4 >&2 || true
  echo "[bundle] 完成：$BUNDLE_PATH" >&2
}

# 公证（批6，M7 批1 切片）：Developer ID 签名件 → zip → notarytool submit --wait → staple → 双验。
# 凭据两式：优先 MUXVO_NOTARY_PROFILE（notarytool keychain profile，凭据不进 env/日志，生产推荐；
# 建法 `xcrun notarytool store-credentials <名>`）；否则 env 三元组（MUXVO_NOTARY_APPLE_ID /
# MUXVO_NOTARY_TEAM_ID / MUXVO_NOTARY_PASSWORD=App 专用密码）。**绝不入 git/日志**。
# ⭐R-04：本命令只公证本地工件，不发任何 release、不触任何 feed。
do_notarize() {
  local authority
  authority="$(codesign -dvv "$BUNDLE_PATH" 2>&1 | grep -c 'Authority=Developer ID Application' || true)"
  if [ "$authority" = "0" ]; then
    echo "错误：bundle 非 Developer ID 签名（ad-hoc 不可公证）。" >&2
    exit 1
  fi
  if [ -z "${MUXVO_NOTARY_PROFILE:-}" ] && { [ -z "${MUXVO_NOTARY_APPLE_ID:-}" ] || [ -z "${MUXVO_NOTARY_TEAM_ID:-}" ] || [ -z "${MUXVO_NOTARY_PASSWORD:-}" ]; }; then
    echo "错误：缺公证凭据——给 MUXVO_NOTARY_PROFILE（keychain profile）或 env 三元组" >&2
    echo "     （MUXVO_NOTARY_APPLE_ID / MUXVO_NOTARY_TEAM_ID / MUXVO_NOTARY_PASSWORD）。" >&2
    exit 1
  fi
  local zip="${BUNDLE_PATH%.app}-notarize.zip"
  rm -f "$zip"
  echo "[dist] 1/3 打包提交公证（notarytool submit --wait，网络耗时数分钟）..." >&2
  ditto -c -k --keepParent "$BUNDLE_PATH" "$zip"
  if [ -n "${MUXVO_NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$zip" \
      --keychain-profile "$MUXVO_NOTARY_PROFILE" --wait >&2
  else
    xcrun notarytool submit "$zip" \
      --apple-id "$MUXVO_NOTARY_APPLE_ID" --team-id "$MUXVO_NOTARY_TEAM_ID" \
      --password "$MUXVO_NOTARY_PASSWORD" --wait >&2
  fi
  echo "[dist] 2/3 stapler staple ..." >&2
  xcrun stapler staple "$BUNDLE_PATH" >&2
  echo "[dist] 3/3 校验（spctl + stapler validate）..." >&2
  spctl -a -vv --type execute "$BUNDLE_PATH" >&2
  xcrun stapler validate "$BUNDLE_PATH" >&2
  rm -f "$zip"
  echo "[dist] 公证完成：$BUNDLE_PATH" >&2
}

# 打包可分发件（批1，distribution.md §3）：$BUNDLE_PATH（应为公证后的 .app）→
#   - zip：ditto -c -k --keepParent（Sparkle enclosure + electron-updater 均吃；spike 证老 Squirrel 能装 zip 内 .app）
#   - DMG：官网下载 / Path C，图标布局参照老 electron-builder.yml（app 130,220 + /Applications 链接 410,220）
# ⚠️不产 blockmap（§4.2 J7：异构工件无老基线可差分，只发 zip 强制全量下载）。
# 产物落 $DIST_OUT，命名 $APP_NAME-<version>-<arch>.{zip,dmg}（对齐老 artifactName ${productName}-${version}-${arch}）。
# ⭐R-04：本函数只产本地工件，不发任何 release、不触任何 feed。
do_package() {
  local app="$BUNDLE_PATH"
  [ -d "$app" ] || { echo "错误：未找到 bundle ${app}（先 bundle/dist）。" >&2; exit 1; }
  local version arch base
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null || echo '0.0.0')"
  # 发布架构（发布先 arm64，§3）：默认按当前机器；uname x86_64 归一化为 x64（对齐老命名）。
  arch="${MUXVO_DIST_ARCH:-$(uname -m)}"
  [ "$arch" = "x86_64" ] && arch="x64"
  mkdir -p "$DIST_OUT"
  base="$APP_NAME-$version-$arch"

  echo "[pack] 1/2 zip（Sparkle enclosure；ditto -c -k --keepParent）..." >&2
  local zip="$DIST_OUT/$base.zip"
  rm -f "$zip"
  ditto -c -k --keepParent "$app" "$zip"

  echo "[pack] 2/2 DMG（图标布局参照老 electron-builder.yml：app 130,220 + /Applications 410,220）..." >&2
  make_dmg "$app" "$DIST_OUT/$base.dmg" "$APP_NAME"

  echo "[pack] 完成，落 ${DIST_OUT}：" >&2
  ls -lh "$zip" "$DIST_OUT/$base.dmg" >&2
  # stdout 只回工件路径（供上层 workflow / 脚本消费；诊断全走 stderr）。
  echo "$zip"
  echo "$DIST_OUT/$base.dmg"
}

# 造 DMG：读写盘装 app + /Applications 链接 → Finder 图标布局（无 GUI 会话时静默跳过，盘功能不受损）
# → 压成只读 UDZO。DMG 本体不签名（对齐老 electron-builder.yml dmg.sign=false；Gatekeeper 校验盘内已
# 公证 stapled 的 .app）。MUXVO_DMG_NO_LAYOUT=1 可跳过 Finder 布局（无头/CI 确定性）。
make_dmg() {
  local app="$1" out="$2" volname="$3"
  local appname staging rw mnt
  appname="$(basename "$app")"
  staging="$(mktemp -d)"
  cp -R "$app" "$staging/"
  ln -s /Applications "$staging/Applications"
  rm -f "$out"
  rw="${out%.dmg}-rw.dmg"
  rm -f "$rw"
  # 读写盘（先造，供后续 GUI 布局；HFS+ 支持 Finder .DS_Store 图标坐标）。
  hdiutil create -quiet -srcfolder "$staging" -volname "$volname" -fs HFS+ -format UDRW -ov "$rw"
  if [ "${MUXVO_DMG_NO_LAYOUT:-}" != "1" ]; then
    mnt="$(hdiutil attach -readwrite -noverify -noautoopen "$rw" 2>/dev/null | grep -oE '/Volumes/[^	]+' | tail -1 || true)"
    if [ -n "$mnt" ] && [ -d "$mnt" ]; then
      dmg_finder_layout "$volname" "$appname" || echo "  · Finder 图标布局跳过（无 GUI 会话），DMG 功能完整" >&2
      sync
      hdiutil detach "$mnt" -quiet 2>/dev/null || hdiutil detach "$mnt" -force -quiet 2>/dev/null || true
    else
      echo "  · 读写盘挂载失败，跳过图标布局，DMG 功能完整" >&2
    fi
  fi
  hdiutil convert "$rw" -quiet -format UDZO -imagekey zlib-level=9 -ov -o "$out"
  rm -f "$rw"
  rm -rf "$staging"
}

# Finder 图标布局（窗口 540×380 对齐老 electron-builder 默认；坐标严格照抄 electron-builder.yml dmg.contents）。
# 结尾 close 自闭窗口不残留。无 Finder（SSH/无窗口服务器）时 osascript 报错 → 调用方 || 兜底跳过。
dmg_finder_layout() {
  local volname="$1" appname="$2"
  osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$volname"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 740, 500}
    set theViewOptions to the icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to 80
    set position of item "$appname" of container window to {130, 220}
    set position of item "Applications" of container window to {410, 220}
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
}

# 把已组装的 $BUNDLE_PATH 拷进应用程序目录（/Applications 不可写则 ~/Applications）。
# 删旧前据 CFBundleIdentifier 核身，只删我们自己的 bundle，防误删同名 app。
do_install() {
  local dest_dir="/Applications"
  if [ ! -w "$dest_dir" ]; then
    dest_dir="$HOME/Applications"
    mkdir -p "$dest_dir"
  fi
  local dest="$dest_dir/$APP_NAME.app"
  if [ -d "$dest" ]; then
    local existing_id
    existing_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$dest/Contents/Info.plist" 2>/dev/null || echo '')"
    if [ "$existing_id" != "$BUNDLE_ID" ]; then
      echo "错误：$dest 已存在且 bundle id=\"$existing_id\"（≠ ${BUNDLE_ID}），拒绝覆盖以防误删。" >&2
      exit 1
    fi
    rm -rf "$dest"
  fi
  cp -R "$BUNDLE_PATH" "$dest"
  echo "[install] 已安装：$dest" >&2
  echo "[install] 双击 Finder 里的 $APP_NAME 即可启动（无需 npm dev / swift run）。" >&2
}

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
  build)
    ensure_vendor
    exec swift build --package-path "$ROOT/app" --scratch-path "$SCRATCH" "$@"
    ;;
  run)
    ensure_vendor
    # guide.md dev 源（B3 GuideProvisioner 解析序①）：dev 无 bundle 资源，经 env 指仓库文档。
    export MUXVO_GUIDE_SOURCE="$ROOT/docs/muxvo-guide.md"
    exec swift run --package-path "$ROOT/app" --scratch-path "$SCRATCH" MuxvoApp "$@"
    ;;
  test)
    ensure_vendor
    exec swift test --package-path "$ROOT/app" --scratch-path "$SCRATCH" "$@"
    ;;
  bundle)
    ensure_vendor
    do_bundle
    echo "$BUNDLE_PATH"
    ;;
  dist)
    # 公证分发件全链（批6 + 批1 §3）：bundle（Developer ID+hardened runtime）→ notarytool → staple
    # → 打包 zip+DMG（可分发件）。发布身份经 env 覆盖（§1.1 配方见文件头）。
    ensure_vendor
    do_bundle
    do_notarize
    do_package
    echo "$BUNDLE_PATH"
    ;;
  pack)
    # 只打包（批1 §3）：对已存在的 $BUNDLE_PATH 产 zip+DMG，不重建/不公证。
    # 干跑验证 / 已有公证件二次打包用。BUNDLE_PATH 由 MUXVO_APP_NAME 决定（默认 Muxvo2.app）。
    do_package
    ;;
  install)
    ensure_vendor
    do_bundle
    do_install
    ;;
  *)
    echo "用法: scripts/app.sh {build|run|test|bundle|dist|pack|install} [swift 附加参数]" >&2
    echo "      bundle  = 组装双击即开的 Muxvo2.app（落 ~/Library/Caches/muxvo-build/bundle/）" >&2
    echo "      dist    = bundle → 公证(staple) → 打包 zip+DMG（发布全链；需 Developer ID + 公证凭据 env）" >&2
    echo "      pack    = 对已存在 bundle 只打包 zip+DMG（落 \$MUXVO_DIST_OUT，默认 bundle/dist/）" >&2
    echo "      install = bundle 后拷进应用程序目录（/Applications 或 ~/Applications）" >&2
    echo "      MUXVO_NO_VENDOR=1 前缀 = 逃生舱降级（剔除依赖 libghostty-vt 的终端 target）" >&2
    exit 2
    ;;
esac
