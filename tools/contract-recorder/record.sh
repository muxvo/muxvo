#!/usr/bin/env bash
# 契约录制流水线（fake-cli.md §4 锚1）。一条命令跑完：
#   1) 真 claude -p 最小 prompt 录一次 stream-json（临时 cwd，避免读项目上下文）
#   2) 输出经 redact.mjs 脱敏（SEC-15）
#   3) F4 spike 素材（allow/deny）同流水线入库
#   4) 全 .jsonl 转 fake-cli §2 剧本
#   5) secret-scan 门整目录扫一遍，零命中才算完成
#
# 预算：真 claude -p 仅一次（失败重试，总次数 ≤3）；给命令 120s 超时。
# 日志落 ~/Library/Caches/muxvo-build/logs/m4a-batch0/0c-record.log（不吞退出码）。
#
# ── codex 分支（批5 W0a 实证，`--harness codex`）───────────────────────────
#   `record.sh --harness codex` 沿同一 CC 工艺录 codex 审查契约：
#     1) 真 `codex exec --json --sandbox read-only --output-schema <verdict schema>` 录一次
#        （临时 git 仓 + 带已知 bug 的小文件，最小审查 prompt；stdin=/dev/null 免 <stdin> 追加）
#     2) 输出经 redact.mjs 脱敏（SEC-15，同一脚本——路径/密钥模式与 harness 无关）
#     3) secret-scan 门（复用 scan.mjs）
#   录制物落 `fixtures/recorded/codex-<codex版本>/exec-schema.jsonl`。
#   **转剧本暂缓**：to-script.mjs 的收口判据是 CC 专属 `type:"result"`（codex 用
#   `turn.completed`，无 result 行）→ codex 分支不转剧本，登记为 TODO（W0a 报告已列，归波1C）。
#   预算：真 codex exec 仅一次（失败重试，总 ≤3）；`MUXVO_CODEX_RAW=<file>` 可跳过真跑、
#   用已录 raw 走脱敏/扫描/入库（省额度自测 + nightly 复用）。
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
LOGDIR="$HOME/Library/Caches/muxvo-build/logs/m4a-batch0"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/0c-record.log"
NODE="${NODE:-node}"
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
CODEX_BIN="$(command -v codex || echo codex)"

# ── 参数解析：--harness claude|codex（缺省 claude，保 CC 现行行为零改动）──
HARNESS="claude"
while [ $# -gt 0 ]; do
  case "$1" in
    --harness) HARNESS="${2:-}"; shift 2 ;;
    --harness=*) HARNESS="${1#*=}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

record_real() {
  local raw prompt attempt=0 max=3 ok=0
  raw="$(mktemp)"
  prompt="Reply with exactly one word: ok. Do not use any tools, do not explain."
  while [ $attempt -lt $max ]; do
    attempt=$((attempt + 1))
    local tmpcwd; tmpcwd="$(mktemp -d)"
    local errf="$LOGDIR/0c-claude-attempt$attempt.err"
    log "real record attempt $attempt/$max (cwd=$tmpcwd)"
    ( cd "$tmpcwd" && exec "$CLAUDE_BIN" -p "$prompt" \
        --output-format stream-json --verbose --max-turns 1 ) > "$raw" 2> "$errf" &
    local pid=$! waited=0 to=120 timedout=0
    while kill -0 "$pid" 2>/dev/null && [ $waited -lt $to ]; do sleep 1; waited=$((waited + 1)); done
    if kill -0 "$pid" 2>/dev/null; then timedout=1; kill -9 "$pid" 2>/dev/null; fi
    wait "$pid" 2>/dev/null; local ex=$?
    rm -rf "$tmpcwd"
    if [ $timedout -eq 1 ]; then log "  attempt $attempt 超时（${to}s）后被杀"; continue; fi
    if [ -s "$raw" ] && grep -q '"type":"result"' "$raw"; then ok=1; log "  attempt $attempt OK (exit=$ex)"; break; fi
    log "  attempt $attempt 无 result 行（exit=$ex），重试"
  done
  if [ $ok -eq 1 ]; then
    "$NODE" "$HERE/redact.mjs" "$raw" "$OUTDIR/minimal-p.jsonl" 2>>"$LOG"
    log "real record → $OUTDIR/minimal-p.jsonl"
    rm -f "$raw"; return 0
  fi
  log "real record FAILED（$max 次）——仅用 F4 素材继续（见返回注记）"
  rm -f "$raw"; return 1
}

ingest_f4() {
  local F4="$HOME/Library/Caches/muxvo-build/f4"
  local s
  for s in allow deny; do
    if [ -f "$F4/$s/stream.jsonl" ]; then
      "$NODE" "$HERE/redact.mjs" "$F4/$s/stream.jsonl" "$OUTDIR/f4-$s.jsonl" 2>>"$LOG"
      log "F4 $s → $OUTDIR/f4-$s.jsonl"
    else
      log "WARN: F4 $s 素材缺失 ($F4/$s/stream.jsonl)"
    fi
  done
}

convert_all() {
  local f base
  for f in "$OUTDIR"/*.jsonl; do
    [ -e "$f" ] || continue
    base="$(basename "$f" .jsonl)"
    "$NODE" "$HERE/to-script.mjs" "$f" "$OUTDIR/$base.script.json" 2>>"$LOG"
    log "convert $base.jsonl → $base.script.json"
  done
}

# codex 审查契约录制（`--harness codex`）：同一 CC 工艺（真录→脱敏→扫描），
# 只是 harness 换成 `codex exec --json --sandbox read-only --output-schema`。
# 转剧本暂缓（to-script 收口判据 CC 专属，见头注）。
record_codex() {
  local raw schema prompt attempt=0 max=3 ok=0
  schema="$HERE/codex-verdict-schema.json"
  prompt="Review the file sum.js in this repository for correctness bugs. Respond only with the verdict object. Do not modify anything."
  raw="$(mktemp)"
  # MUXVO_CODEX_RAW：跳过真跑，用已录 raw 走脱敏/扫描（省额度自测 + nightly 复用）。
  if [ -n "${MUXVO_CODEX_RAW:-}" ] && [ -s "${MUXVO_CODEX_RAW}" ]; then
    log "codex record: 用 MUXVO_CODEX_RAW=${MUXVO_CODEX_RAW}（跳过真跑）"
    cp "$MUXVO_CODEX_RAW" "$raw"; ok=1
  else
    while [ $attempt -lt $max ]; do
      attempt=$((attempt + 1))
      local tmpcwd; tmpcwd="$(mktemp -d)"
      local errf="$LOGDIR/0c-codex-attempt$attempt.err"
      log "codex real record attempt $attempt/$max (cwd=$tmpcwd)"
      ( cd "$tmpcwd" \
          && git init -q && git config user.email r@e && git config user.name r \
          && printf '%s\n' \
             '// average of a list of numbers' \
             'function average(nums) {' \
             '  let total = 0;' \
             '  for (let i = 0; i <= nums.length; i++) {' \
             '    total += nums[i];' \
             '  }' \
             '  return total / nums.length;' \
             '}' \
             'module.exports = average;' > sum.js \
          && git add -A && git commit -qm seed \
          && exec "$CODEX_BIN" exec --json --sandbox read-only \
               --output-schema "$schema" -o "$LOGDIR/0c-codex-last.txt" \
               "$prompt" < /dev/null ) > "$raw" 2> "$errf" &
      local pid=$! waited=0 to=180 timedout=0
      while kill -0 "$pid" 2>/dev/null && [ $waited -lt $to ]; do sleep 1; waited=$((waited + 1)); done
      if kill -0 "$pid" 2>/dev/null; then timedout=1; kill -9 "$pid" 2>/dev/null; fi
      wait "$pid" 2>/dev/null; local ex=$?
      rm -rf "$tmpcwd"
      if [ $timedout -eq 1 ]; then log "  attempt $attempt 超时（${to}s）后被杀"; continue; fi
      if [ -s "$raw" ] && grep -q '"type":"turn.completed"' "$raw"; then ok=1; log "  attempt $attempt OK (exit=$ex)"; break; fi
      log "  attempt $attempt 无 turn.completed 行（exit=$ex），重试"
    done
  fi
  if [ $ok -eq 1 ]; then
    "$NODE" "$HERE/redact.mjs" "$raw" "$OUTDIR/exec-schema.jsonl" 2>>"$LOG"
    log "codex record → $OUTDIR/exec-schema.jsonl"
    log "TODO(波1C): codex 转剧本暂缓——to-script.mjs 收口判据 type:result 为 CC 专属；"
    log "           codex 用 turn.completed（无 result 行）→ 需 codex 方言转换器或 fake-cli --as codex emit 直载"
    rm -f "$raw"; return 0
  fi
  log "codex real record FAILED（$max 次）"
  rm -f "$raw"; return 1
}

if [ "$HARNESS" = "codex" ]; then
  VER="$("$CODEX_BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  [ -n "$VER" ] || VER="unknown"
  OUTDIR="$HERE/fixtures/recorded/codex-$VER"
  mkdir -p "$OUTDIR"
  log "=== contract-recorder run (codex=$VER, out=$OUTDIR) ==="
  record_codex || true
else
  VER="$("$CLAUDE_BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  [ -n "$VER" ] || VER="unknown"
  OUTDIR="$HERE/fixtures/recorded/$VER"
  mkdir -p "$OUTDIR"
  log "=== contract-recorder run (cc=$VER, out=$OUTDIR) ==="
  record_real || true
  ingest_f4
  convert_all
fi

log "secret-scan 门：扫 $HERE/fixtures ..."
"$NODE" "$HERE/scan.mjs" "$HERE/fixtures" 2>&1 | tee -a "$LOG"
scan_rc=${PIPESTATUS[0]}
if [ "$scan_rc" -ne 0 ]; then
  log "SCAN FOUND HITS — 录制未完成（非零退出）"
  exit 1
fi
log "SCAN CLEAN"
log "=== done ==="
ls -la "$OUTDIR" | tee -a "$LOG"
