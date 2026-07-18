#!/usr/bin/env bash
# 对抗负载：循环进出 alt-screen + 全屏重绘。打击面：模式切换、全屏重绘路径。
# 不依赖 vim/htop 是否安装，直接用控制序列模拟 TUI 行为。
# 用法：altscreen-churn.sh [秒数，默认 60]
DURATION=${1:-60}
END=$((SECONDS + DURATION))
COLS=$(tput cols 2>/dev/null || echo 120)
ROWS=$(tput lines 2>/dev/null || echo 40)
n=0
while [ $SECONDS -lt $END ]; do
  printf "\033[?1049h\033[2J\033[H"            # 进 alt-screen 清屏
  for ((r = 1; r <= ROWS; r++)); do
    printf "\033[%d;1H\033[7m TUI 帧 %d 行 %d \033[0m %s" $r $n $r "$(printf '%.0s═' $(seq 1 $((COLS - 30))))"
  done
  sleep 0.05
  printf "\033[?1049l"                          # 回主屏
  printf "主屏输出 batch %d：alt-screen 往返完成\n" $n
  n=$((n + 1))
done
printf "\033[?1049l\033[0m"
