#!/usr/bin/env bash
# 对抗负载：持续输出填满 scrollback 上限，验证 headless 会话内存封顶后不再增长。
# 用法：scrollback-fill.sh [秒数，默认 300]
DURATION=${1:-300}
END=$((SECONDS + DURATION))
i=0
while [ $SECONDS -lt $END ]; do
  printf "scrollback-fill %08d | %s | lorem ipsum dolor sit amet consectetur adipiscing elit sed do\n" $i "$(date +%H:%M:%S)"
  i=$((i + 1))
done
