#!/usr/bin/env bash
# bench-all.sh —— M7 判据3「性能 bench 不退步」一键全家族 runner。
#
# 跑全部 5 个常驻 bench 家族、逐家族对基线判「不退步/退步」、汇总红绿灯表。
#   1. bench_pty_fanout        probe-cli stress ccmix s20 60s -> bytes_fed_total（吞吐，越大越好）
#   2. bench_mem_per_terminal  同一 stress 跑的 marginal_per_session_mb（硬线 <20MB）
#   3. bench_scroll_throughput probe-cli stress fill s4 90s -> steady_mb（scrollback 封顶）+ bytes
#   4. bench_vt_ingest         probe-cli bench-vt-ingest all -> feed/update p99 + 吞吐
#   5. bench_input_to_pixel    app/muxvo-term-bench --mode cpu -> p99（cpu-segment；GPU 段须前台 GUI）
#
# 基线来源（单一权威，勿散落）：
#   - 三家族（fanout/mem/scroll）：probes/term-probe/reports/M0-report.md（2026-06-10）
#   - vt_ingest：probes/term-probe/reports/bench_vt_ingest-baseline.md（2026-06-11）
#   - input_to_pixel：app/reports/bench_input_to_pixel-baseline.md（2026-07-02）
#
# ⚠️ bench 测的是性能：跑前请挑相对低负载窗口（load<10）取正式数，否则吞吐类读数被并发污染失真。
#    脚本每段测量前记录 load average 供事后核信。
#
# 用法：
#   scripts/bench-all.sh                 # 全 4 probe 家族（正式时长）+ ip（若二进制已就绪则跑，否则跳过）
#   scripts/bench-all.sh --quick         # 短时长冒烟（ccmix 15s / fill 20s），只验管路不作正式判据
#   scripts/bench-all.sh --build-ip      # 顺带构建并跑 input_to_pixel cpu-segment（触发 app 包构建，较重）
#   scripts/bench-all.sh --no-build      # 跳过 probe-cli 构建（假定已 build）
#   scripts/bench-all.sh --out DIR       # 结果与报告输出目录（默认 ~/Library/Caches/muxvo-build/logs/bench-verify）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # probes/term-probe
REPO_ROOT="$(cd "$PROBE_DIR/../.." && pwd)"        # 仓库根
OUT_DIR="$HOME/Library/Caches/muxvo-build/logs/bench-verify"
QUICK=0; DO_BUILD=1; BUILD_IP=0
CCMIX_SECONDS=60; CCMIX_SESSIONS=20
FILL_SECONDS=90; FILL_SESSIONS=4
IP_KEYS=1000

while [ $# -gt 0 ]; do
  case "$1" in
    --quick)    QUICK=1; CCMIX_SECONDS=15; FILL_SECONDS=20; IP_KEYS=200 ;;
    --build-ip) BUILD_IP=1 ;;
    --no-build) DO_BUILD=0 ;;
    --out)      shift; OUT_DIR="$1" ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$OUT_DIR/raw"
PROBE_BIN="$PROBE_DIR/.build/release/probe-cli"
PY="$(command -v python3)"
[ -n "$PY" ] || { echo "需要 python3 解析 JSON" >&2; exit 1; }

# ---- 基线常量（改基线须同步改上列基线文档并留档，见报告「基线过旧处置」）----
BASE_FANOUT_BYTES=670199596          # M0 ccmix s20 60s bytes_fed_total
BASE_FANOUT_SECONDS=60               # 基线时长（吞吐按 bytes/秒 归一，与本次时长无关）
BASE_MEM_MARGINAL=2.40               # M0 ccmix marginal_per_session_mb（硬线 20）
BASE_SCROLL_STEADY=7.20              # M0 fill s4 steady_mb（scrollback 封顶）
BASE_SCROLL_MARGINAL=1.43            # M0 fill marginal_per_session_mb
BASE_SCROLL_BYTES=14398882           # M0 fill bytes_fed_total
BASE_SCROLL_SECONDS=90               # 基线时长
BASE_IP_CPU_P99=4.20                 # M3 cat cpu-segment p99（退步线 max(16,×1.25)=5.25）
# vt_ingest 退步线由 baseline 文档定死：任一 feed/update p99 > 0.1ms 或吞吐 < 10MB/s 即红。
VT_P99_REDLINE=0.1
VT_TPUT_REDLINE=10

note() { printf '\n\033[1m%s\033[0m\n' "$*"; }
loadnow() { uptime | sed -E 's/.*load averages?: //'; }

STAMP="$(date +%Y%m%d-%H%M%S)"
SUMMARY_TSV="$OUT_DIR/summary-$STAMP.tsv"
: > "$SUMMARY_TSV"
echo "开始：$STAMP  quick=$QUICK  输出=$OUT_DIR"
echo "起始 load average：$(loadnow)"

# ---------- 构建 ----------
if [ "$DO_BUILD" = 1 ]; then
  note "[build] probe-cli release"
  ( cd "$PROBE_DIR" && swift build -c release --product probe-cli >/dev/null )
fi
[ -x "$PROBE_BIN" ] || { echo "缺 probe-cli 二进制：$PROBE_BIN（去掉 --no-build 或先构建）" >&2; exit 1; }

# ---------- 1+2 fanout + mem（同一 ccmix 跑）----------
note "[run] stress ccmix s$CCMIX_SESSIONS ${CCMIX_SECONDS}s  —— fanout + mem_per_terminal"
echo "  load(前)：$(loadnow)"
CCMIX_JSON="$OUT_DIR/raw/ccmix-$STAMP.json"
( cd "$PROBE_DIR" && "$PROBE_BIN" stress --sessions "$CCMIX_SESSIONS" --seconds "$CCMIX_SECONDS" --load ccmix ) > "$CCMIX_JSON" 2>>"$OUT_DIR/raw/stderr-$STAMP.log"
echo "  load(后)：$(loadnow)"

# ---------- 3 scroll（fill 跑）----------
note "[run] stress fill s$FILL_SESSIONS ${FILL_SECONDS}s  —— scroll_throughput"
echo "  load(前)：$(loadnow)"
FILL_JSON="$OUT_DIR/raw/fill-$STAMP.json"
( cd "$PROBE_DIR" && "$PROBE_BIN" stress --sessions "$FILL_SESSIONS" --seconds "$FILL_SECONDS" --load fill ) > "$FILL_JSON" 2>>"$OUT_DIR/raw/stderr-$STAMP.log"
echo "  load(后)：$(loadnow)"

# ---------- 4 vt_ingest ----------
note "[run] bench-vt-ingest all x3  —— vt_ingest"
echo "  load(前)：$(loadnow)"
VT_JSON="$OUT_DIR/raw/vtingest-$STAMP.json"
( cd "$PROBE_DIR" && "$PROBE_BIN" bench-vt-ingest ) > "$VT_JSON" 2>>"$OUT_DIR/raw/stderr-$STAMP.log"
echo "  load(后)：$(loadnow)"

# ---------- 5 input_to_pixel（cpu-segment；可选）----------
IP_BIN="$HOME/Library/Caches/muxvo-build/spm-scratch/arm64-apple-macosx/release/muxvo-term-bench"
IP_JSON="$OUT_DIR/raw/ip-cpu-$STAMP.json"
IP_RAN=0
if [ "$BUILD_IP" = 1 ]; then
  note "[build] muxvo-term-bench (app 包，较重)"
  ( cd "$REPO_ROOT" && swift build --package-path app --scratch-path "$HOME/Library/Caches/muxvo-build/spm-scratch" -c release --product muxvo-term-bench >/dev/null )
fi
if [ -x "$IP_BIN" ]; then
  note "[run] muxvo-term-bench --mode cpu --scene cat --keys $IP_KEYS  —— input_to_pixel (cpu-segment)"
  echo "  load(前)：$(loadnow)"
  ( cd "$REPO_ROOT" && "$IP_BIN" --scene cat --keys "$IP_KEYS" --mode cpu ) > "$IP_JSON" 2>>"$OUT_DIR/raw/stderr-$STAMP.log" || true
  echo "  load(后)：$(loadnow)"
  IP_RAN=1
else
  echo "  [skip] input_to_pixel：muxvo-term-bench 未构建（加 --build-ip 触发构建）。GPU 全链路段须前台 GUI 会话，后台 agent 只能取 cpu-segment。"
fi

# ---------- 汇总判定 ----------
note "========== 判据3 汇总（当前 vs 基线，不退步判定）=========="
"$PY" - "$CCMIX_JSON" "$FILL_JSON" "$VT_JSON" "$IP_JSON" "$IP_RAN" "$SUMMARY_TSV" <<PYEOF
import json, sys
ccmix_p, fill_p, vt_p, ip_p, ip_ran, tsv_p = sys.argv[1:7]
ip_ran = ip_ran == "1"

BASE_FANOUT=$BASE_FANOUT_BYTES
BASE_FANOUT_S=$BASE_FANOUT_SECONDS
BASE_MEM=$BASE_MEM_MARGINAL
BASE_SCROLL_STEADY=$BASE_SCROLL_STEADY
BASE_SCROLL_MARGINAL=$BASE_SCROLL_MARGINAL
BASE_SCROLL_BYTES=$BASE_SCROLL_BYTES
BASE_SCROLL_S=$BASE_SCROLL_SECONDS
BASE_IP=$BASE_IP_CPU_P99
VT_P99_RED=$VT_P99_REDLINE
VT_TPUT_RED=$VT_TPUT_REDLINE

def load(p):
    try:
        return json.load(open(p))
    except Exception as e:
        return None

def load_multi(p):
    # bench-vt-ingest 每素材打一个 JSON 对象，文件里是多个拼接对象（非数组），用 raw_decode 逐个读
    try:
        s = open(p).read()
    except Exception:
        return []
    dec = json.JSONDecoder(); out=[]; i=0; n=len(s)
    while i < n:
        while i < n and s[i] in ' \t\r\n': i += 1
        if i >= n: break
        obj, j = dec.raw_decode(s, i); out.append(obj); i = j
    return out

rows=[]  # (family, metric, baseline, current, verdict, note)
def add(fam, metric, base, cur, verdict, extra=""):
    rows.append((fam, metric, base, cur, verdict, extra))

cc = load(ccmix_p); fl = load(fill_p); vt = load_multi(vt_p)

# 1 pty_fanout：吞吐按 bytes/秒 归一（与时长无关）；越大越好；load-sensitive，绿=>=0.8x 基线
if cc:
    rate = cc["bytes_fed_total"]/cc["seconds"]; base_rate = BASE_FANOUT/BASE_FANOUT_S
    ratio = rate/base_rate
    v = "GREEN" if ratio>=0.80 else ("YELLOW" if ratio>=0.5 else "RED")
    add("bench_pty_fanout","throughput MB/s", f"{base_rate/1048576:.2f}", f"{rate/1048576:.2f}", v, f"{ratio*100:.0f}% of baseline（吞吐越大越好，load 敏感）")

# 2 mem_per_terminal：marginal 硬线<20；退步观察线 1.5x 基线
if cc:
    cur = cc["marginal_per_session_mb"]
    if cur>=20: v="RED"
    elif cur<=BASE_MEM*1.5: v="GREEN"
    else: v="YELLOW"
    add("bench_mem_per_terminal","marginal_mb/session", f"{BASE_MEM:.2f}（硬线<20）", f"{cur:.2f}", v, f"steady={cc['steady_mb']}MB peak={cc['peak_mb']}MB")

# 3 scroll_throughput：steady 封顶（<=1.25x 基线）+ marginal + bytes
if fl:
    steady=fl["steady_mb"]; marg=fl["marginal_per_session_mb"]
    rate=fl["bytes_fed_total"]/fl["seconds"]; base_rate=BASE_SCROLL_BYTES/BASE_SCROLL_S
    cap_ok = steady <= BASE_SCROLL_STEADY*1.25
    bytes_ok = rate >= base_rate*0.80
    add("bench_scroll_throughput","steady_mb（封顶）", f"{BASE_SCROLL_STEADY:.2f}", f"{steady:.2f}", "GREEN" if cap_ok else "RED", "scrollback 10k 行封顶")
    add("bench_scroll_throughput","marginal_mb/session", f"{BASE_SCROLL_MARGINAL:.2f}", f"{marg:.2f}", "GREEN" if marg<=BASE_SCROLL_MARGINAL*1.5 else "YELLOW", "")
    add("bench_scroll_throughput","throughput KB/s", f"{base_rate/1024:.1f}", f"{rate/1024:.1f}", "GREEN" if bytes_ok else "YELLOW", f"{rate/base_rate*100:.0f}% of baseline")

# 4 vt_ingest：每素材 feed/update p99 <0.1ms 且吞吐>10MB/s
if vt:
    worst_feed=0.0; worst_upd=0.0; min_tput=1e9; casts=[]
    for it in vt:
        casts.append(it["cast_file"])
        worst_feed=max(worst_feed, it["feed_ms"]["p99"])
        worst_upd=max(worst_upd, it["update_ms"]["p99"])
        min_tput=min(min_tput, min(it["throughput_mb_s_per_run"]))
    vfeed = "GREEN" if worst_feed<VT_P99_RED else "RED"
    vupd  = "GREEN" if worst_upd<VT_P99_RED else "RED"
    vtp   = "GREEN" if min_tput>VT_TPUT_RED else "RED"
    add("bench_vt_ingest","worst feed p99 ms", "<0.1（红线）", f"{worst_feed:.4f}", vfeed, "基线~0.0100")
    add("bench_vt_ingest","worst update p99 ms", "<0.1（红线）", f"{worst_upd:.4f}", vupd, "基线~0.0063")
    add("bench_vt_ingest","min throughput MB/s", ">10（红线）", f"{min_tput:.1f}", vtp, "基线 52-81")

# 5 input_to_pixel（cpu-segment）：p99 <= max(16, 4.20x1.25=5.25)
if ip_ran:
    ip = load(ip_p)
    if ip:
        p99 = ip["primary"]["p99_ms"]; red = max(16.0, BASE_IP*1.25)
        v = "GREEN" if p99<=red else "RED"
        add("bench_input_to_pixel","cpu-seg p99 ms", f"{BASE_IP:.2f}（退步线{red:.2f}）", f"{p99:.4f}", v, f"mode={ip['mode']}；GPU 段须前台 GUI")
else:
    add("bench_input_to_pixel","cpu-seg p99 ms", f"{BASE_IP:.2f}", "SKIP", "SKIP", "未跑（--build-ip 触发）；GPU 段须前台 GUI 会话")

# 输出表
lampmap={"GREEN":"🟢","YELLOW":"🟡","RED":"🔴","SKIP":"⚪"}
w1=max(len(r[0]) for r in rows); w2=max(len(r[1]) for r in rows)
w3=max(len(str(r[2])) for r in rows); w4=max(len(str(r[3])) for r in rows)
print(f"{'家族'.ljust(w1)}  {'指标'.ljust(w2)}  {'基线'.ljust(w3)}  {'当前'.ljust(w4)}  灯   备注")
worst="GREEN"
order={"GREEN":0,"SKIP":0,"YELLOW":1,"RED":2}
with open(tsv_p,"w") as tf:
    for fam,metric,base,cur,verd,extra in rows:
        print(f"{fam.ljust(w1)}  {metric.ljust(w2)}  {str(base).ljust(w3)}  {str(cur).ljust(w4)}  {lampmap.get(verd,'?')}  {extra}")
        tf.write(f"{fam}\t{metric}\t{base}\t{cur}\t{verd}\t{extra}\n")
        if order.get(verd,0)>order.get(worst,0): worst=verd
print()
print(f"总判定：{lampmap.get(worst)} { {'GREEN':'全家族不退步（含 SKIP 项）','YELLOW':'有需人核的偏差（黄）','RED':'有退步（红）——须归因'}[worst] }")
PYEOF

echo
echo "raw JSON: $OUT_DIR/raw/  |  summary TSV: $SUMMARY_TSV"
echo "结束 load average：$(loadnow)"
