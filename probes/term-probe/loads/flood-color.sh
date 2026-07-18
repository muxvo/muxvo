#!/usr/bin/env bash
# 对抗负载：24-bit SGR 随机色全屏刷屏。打击面：VT 解析吞吐 + atlas/draw call。
# 用法：flood-color.sh [秒数，默认 60]
DURATION=${1:-60}
END=$((SECONDS + DURATION))
COLS=$(tput cols 2>/dev/null || echo 120)
ROWS=$(tput lines 2>/dev/null || echo 40)
while [ $SECONDS -lt $END ]; do
  out=""
  for ((r = 0; r < ROWS; r++)); do
    fg=$((RANDOM % 256))
    bg=$((RANDOM % 256))
    line=$(printf "\033[38;2;%d;%d;%dm\033[48;2;%d;%d;%dm" $fg $((255-fg)) $((RANDOM%256)) $bg $((255-bg)) $((RANDOM%256)))
    line+=$(printf "%${COLS}s" | tr ' ' '█')
    out+="$line\033[0m\n"
  done
  printf "%b" "$out"
done
printf "\033[0m"
