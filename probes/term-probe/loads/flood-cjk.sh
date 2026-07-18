#!/usr/bin/env bash
# 对抗负载：CJK + emoji（含 ZWJ 序列、肤色修饰符）混排高速滚动。
# 打击面：宽字符 cell 占位、grapheme 簇、字体回退。
# 用法：flood-cjk.sh [秒数，默认 60]
DURATION=${1:-60}
END=$((SECONDS + DURATION))
SAMPLES=(
  "终端性能压测：多路并发会话渲染管线验证，混合中文字符宽度计算。"
  "日本語のテキストレンダリング検証、ターミナルエミュレータの性能試験。"
  "한국어 텍스트 렌더링 검증 터미널 에뮬레이터 성능"
  "👍🏽👨‍👩‍👧‍👦🇨🇳🏳️‍🌈🧑🏿‍💻🫱🏻‍🫲🏾 emoji ZWJ 序列与肤色修饰符 🎨🖥️⚡"
  "混排 mixed 寬窄 width 字符 chars 与 with エモジ 🚀 测试 test 行 line"
  "─━│┃┌┍┎┏ 制表符 ▁▂▃▄▅▆▇█ 方块 ◐◑◒◓ 几何"
)
i=0
while [ $SECONDS -lt $END ]; do
  printf "\033[3%dm%05d %s\033[0m\n" $((i % 8)) $i "${SAMPLES[$((i % ${#SAMPLES[@]}))]}"
  i=$((i + 1))
done
