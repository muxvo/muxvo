#!/bin/bash
# hook-replay：按剧本向 Muxvo WaitDetector 的 hook.sock 回放等待事件（wait-detector.md §9）。
#
# 走与生产 hook 脚本**完全相同**的传输（nc -U 发 `{"v":1,"termId","event","raw"}` 帧），故可
# 端到端彩排「Notification→红点」全链路，无需真 CC 会话。M4a fake-cli 可 shell 出本工具驱动。
#
# 用法：
#   单条：  hook-replay.sh --sock <hook.sock 路径> --term <termId> --event <Notification|Stop|UserPromptSubmit> [--raw '<json>']
#   剧本：  hook-replay.sh --sock <path> --term <termId> --scenario <文件>
#
# 剧本文件：每行 `<event> [delayMsAfterSend] [raw-json...]`；# 开头为注释；空行跳过。
#   Notification 0 {"msg":"需要你确认"}
#   Stop 500
#   UserPromptSubmit 0 {"prompt":"go"}
#
# 数据目录隔离纪律：sock 路径须显式传入（dev = ~/Library/Application Support/Muxvo2 Dev/run/hook.sock）；
# 本工具不硬编码任何数据目录字面，不触老版目录。
set -euo pipefail

SOCK="" ; TERM_ID="" ; EVENT="" ; RAW="{}" ; SCENARIO=""

usage() { grep '^#' "$0" | sed 's/^# \{0,1\}//' | grep -v '^!/bin/bash' >&2; exit "${1:-2}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --sock) SOCK="$2"; shift 2 ;;
    --term) TERM_ID="$2"; shift 2 ;;
    --event) EVENT="$2"; shift 2 ;;
    --raw) RAW="$2"; shift 2 ;;
    --scenario) SCENARIO="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "未知参数：$1" >&2; usage ;;
  esac
done

[ -n "$SOCK" ] || { echo "错误：缺 --sock" >&2; usage; }
[ -n "$TERM_ID" ] || { echo "错误：缺 --term" >&2; usage; }
if [ ! -S "$SOCK" ]; then
  echo "警告：$SOCK 不是活 socket（app 未运行或路径错）——发送将静默失败" >&2
fi
command -v nc >/dev/null 2>&1 || { echo "错误：需要 nc（BSD netcat）" >&2; exit 1; }

# 发一帧（与生产 hook 脚本 §4 同格式；raw 裸插，非法由 native 丢弃兜底）。
send_frame() {
  local term="$1" event="$2" raw="$3"
  printf '{"v":1,"termId":"%s","event":"%s","raw":%s}' "$term" "$event" "$raw" \
    | nc -U -w 1 "$SOCK"
  echo "→ 发送 $event (term=$term)" >&2
}

if [ -n "$SCENARIO" ]; then
  [ -f "$SCENARIO" ] || { echo "错误：剧本文件不存在：$SCENARIO" >&2; exit 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    ev=$(echo "$line" | awk '{print $1}')
    delay=$(echo "$line" | awk '{print $2}')
    raw=$(echo "$line" | cut -d' ' -f3- )
    [ -n "$raw" ] || raw="{}"
    [ -n "$delay" ] || delay=0
    send_frame "$TERM_ID" "$ev" "$raw"
    if [ "$delay" -gt 0 ] 2>/dev/null; then
      sleep "$(awk "BEGIN{print $delay/1000}")"
    fi
  done < "$SCENARIO"
else
  [ -n "$EVENT" ] || { echo "错误：缺 --event 或 --scenario" >&2; usage; }
  send_frame "$TERM_ID" "$EVENT" "$RAW"
fi
