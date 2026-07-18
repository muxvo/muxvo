#!/bin/bash
# 生产 EdDSA（Ed25519）密钥流程（distribution.md §5，R-09）。
#
# Sparkle 用一对 Ed25519 密钥给更新签名：私钥签、公钥（注 Info.plist SUPublicEDKey）验。
#   · 私钥入**登录钥匙串**（macOS Keychain），签名时自动取用。
#   · 公钥文本 → bundle 的 SUPublicEDKey（app.sh 经 env MUXVO_SPARKLE_ED_KEY 注入）。
#   · ⚠️私钥丢失 = 新客户端更新链**永久断**（换公钥的新版没法被在野旧版验签升级）。故必须离线冷备。
#
# ⚠️⚠️本脚本是**流程脚手架**。生产密钥的实际生成/备份 = D7' 用户动作（下方 [用户执行] 标注的步）。
#     CC 不擅自生成生产密钥（会污染钥匙串、且生成即定终身）。跑 generate/export-backup 由用户亲自执行。
#
# 子命令：
#   pubkey                     打印钥匙串里现有公钥 + Info.plist 用法（只读，随时可跑）
#   generate        [用户执行]  生成生产密钥对入登录钥匙串（已存在则不覆盖，打印现有公钥）
#   export-backup <file> [用户执行]  导出私钥到文件供离线冷备（明文！随后须加密+物理隔离）
#   help                       本帮助
#
# 依赖 Sparkle bin 工具（generate_keys）：先 scripts/app.sh build 拉 SwiftPM 依赖即就位。
set -euo pipefail

SCRATCH="${MUXVO_SCRATCH:-$HOME/Library/Caches/muxvo-build/spm-scratch}"
SPARKLE_BIN="${MUXVO_SPARKLE_BIN:-$SCRATCH/artifacts/sparkle/Sparkle/bin}"
GEN_KEYS="$SPARKLE_BIN/generate_keys"

require_tool() {
  [ -x "$GEN_KEYS" ] || {
    echo "错误：未找到 Sparkle generate_keys（$GEN_KEYS）。" >&2
    echo "  先 scripts/app.sh build 拉 SwiftPM 依赖（Sparkle 会解到 $SPARKLE_BIN）。" >&2
    echo "  或 MUXVO_SPARKLE_BIN=<bin目录> 覆盖。" >&2
    exit 2
  }
}

cmd_pubkey() {
  require_tool
  local pub
  pub="$("$GEN_KEYS" -p 2>/dev/null || true)"
  if [ -z "$pub" ]; then
    echo "钥匙串里暂无 EdDSA 私钥（未生成）。先跑：tools/release/eddsa-keys.sh generate（用户执行）。" >&2
    exit 1
  fi
  echo "现有 EdDSA 公钥（SUPublicEDKey）："
  echo "  $pub"
  echo
  echo "用法（发布 bundle 注入，app.sh 已支持）："
  echo "  MUXVO_SPARKLE_ED_KEY='$pub' scripts/app.sh dist   # → Info.plist SUPublicEDKey"
  echo "或写死进 Info.plist："
  echo "  <key>SUPublicEDKey</key><string>$pub</string>"
}

cmd_generate() {
  require_tool
  echo "⚠️ [用户执行 · D7'] 生成生产 EdDSA 密钥对入**登录钥匙串**。" >&2
  echo "   · 已存在私钥则不覆盖，仅打印现有公钥（generate_keys 幂等）。" >&2
  echo "   · 钥匙串可能弹权限框，须允许。" >&2
  echo "   · 生成后立刻做离线冷备：tools/release/eddsa-keys.sh export-backup <file>。" >&2
  echo >&2
  # generate_keys 无参：生成（或复用已有）并打印公钥 + Info.plist 指引。
  "$GEN_KEYS"
}

cmd_export_backup() {
  require_tool
  local out="${1:-}"
  [ -n "$out" ] || { echo "用法: eddsa-keys.sh export-backup <私钥导出文件路径>" >&2; exit 2; }
  [ -e "$out" ] && { echo "错误：$out 已存在，拒绝覆盖（防误删既有备份）。" >&2; exit 1; }
  echo "⚠️ [用户执行 · D7'] 从登录钥匙串导出私钥到明文文件 $out。" >&2
  "$GEN_KEYS" -x "$out"
  echo >&2
  echo "‼️ 冷备纪律（distribution.md §5）：" >&2
  echo "   1. $out 是**明文私钥**，绝不进 git / 坊间云 / 聊天。" >&2
  echo "   2. 立刻加密：如  gpg -c \"$out\"  或存入密码管理器的安全附件。" >&2
  echo "   3. 密文存**物理隔离介质**（离线 U 盘 / 硬件保险），原明文文件用后即抹：" >&2
  echo "      rm -P \"$out\"" >&2
  echo "   4. 私钥留在登录钥匙串里日常签名用；本备份仅为钥匙串损毁时的灾备恢复。" >&2
}

case "${1:-help}" in
  pubkey)         cmd_pubkey ;;
  generate)       cmd_generate ;;
  export-backup)  shift; cmd_export_backup "${1:-}" ;;
  help|--help|-h) sed -n '2,18p' "$0" ;;
  *) echo "未知子命令：$1（跑 help 看用法）" >&2; exit 2 ;;
esac
