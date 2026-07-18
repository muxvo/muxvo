#!/usr/bin/env bash
# 对抗负载：超长行输出（reflow 风暴的素材面）。
# 配合探针程序侧的程序化连续 resize（探针负责发 TIOCSWINSZ），本脚本只产出超长行。
# 用法：wrap-resize.sh [秒数，默认 60]
DURATION=${1:-60}
END=$((SECONDS + DURATION))
i=0
LONG=$(printf 'wrap%04d-%.0s' $(seq 1 200))   # ~1600 列超长行
CJKLONG=$(printf '换行重排压测中文超长行%.0s' $(seq 1 80))
while [ $SECONDS -lt $END ]; do
  printf "%06d %s\n" $i "$LONG"
  printf "%06d %s\n" $i "$CJKLONG"
  i=$((i + 1))
done
