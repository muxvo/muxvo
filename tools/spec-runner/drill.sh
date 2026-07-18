#!/bin/bash
# spec-runner 违规演练（红灯自检）：四类违规各自注入 → 断言精确 E_ 码红灯 → 还原 → 跑绿。
# 任何一步不符即整体失败。trap 保证脚本中途死掉也还原现场。
# 用法: bash tools/spec-runner/drill.sh    退出码: 0=全部演练通过 1=失败
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATUS="$ROOT/specs/legacy/status.json"
TEMP_SWIFT="$ROOT/app/Tests/SpecRunnerDrill_TEMP.swift"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/spec-runner-drill.XXXXXX")"
BACKUP="$WORK/status.json.bak"
LOG="$WORK/run.log"

restore() {
  cp -p "$BACKUP" "$STATUS" 2>/dev/null
  rm -f "$TEMP_SWIFT"
}
trap restore EXIT

fail() { echo "DRILL FAIL: $1"; echo "--- last run log ---"; cat "$LOG" 2>/dev/null; exit 1; }

# run_expect <期望退出码> <必须出现的字符串> <标签>
run_expect() {
  local want_exit="$1" want_str="$2" label="$3"
  node "$ROOT/tools/spec-runner/run.mjs" > "$LOG" 2>&1
  local got=$?
  [ "$got" -eq "$want_exit" ] || fail "$label: 期望 exit=$want_exit 实际 exit=$got"
  grep -qF "$want_str" "$LOG" || fail "$label: 输出未包含 '$want_str'"
  echo "  ok: $label (exit=$got, 含 '$want_str')"
}

# 用 node 改 overlay（每次演练独立修改，结束用备份整体还原）
patch_overlay() {
  node -e "
const fs = require('fs');
const p = process.argv[1];
const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
$1
fs.writeFileSync(p, JSON.stringify(doc, null, 1) + '\n');
" "$STATUS" || fail "patch_overlay 失败"
}

restore_overlay() {
  cp -p "$BACKUP" "$STATUS"
  cmp -s "$BACKUP" "$STATUS" || fail "status.json 还原后与备份字节不一致"
}

[ -e "$TEMP_SWIFT" ] && fail "前置: $TEMP_SWIFT 已存在，拒绝覆盖"
cp -p "$STATUS" "$BACKUP"

echo "== 基线 =="
run_expect 0 "GREEN" "基线绿灯"

echo "== 演练①a: overlay 增一个假 ID（破坏双向相等） =="
patch_overlay "doc.entries.push({ id: 'FAKE_L1_99', status: 'todo', milestone: 'M3' });"
run_expect 1 "E_SET_MISMATCH" "①a 红灯"
restore_overlay
run_expect 0 "GREEN" "①a 还原后绿灯"

echo "== 演练①b: overlay 删一个真 ID（破坏双向相等） =="
patch_overlay "doc.entries = doc.entries.filter(e => e.id !== 'AUTH_L1_01');"
run_expect 1 "E_SET_MISMATCH" "①b 红灯"
restore_overlay
run_expect 0 "GREEN" "①b 还原后绿灯"

echo "== 演练②: 伪造 spec-ID 形状的测试名（TERM_L1_99 不在 spec 全集） =="
cat > "$TEMP_SWIFT" <<'EOF'
import Testing
@Test("TERM_L1_99: forged for drill") func specRunnerDrillForged() {}
EOF
run_expect 1 "E_FORGED_ID" "② 红灯"
rm -f "$TEMP_SWIFT"
run_expect 0 "GREEN" "② 还原后绿灯"

echo "== 演练③: 同 ID 写两处（前置改 implemented 隔离出纯重复违规） =="
patch_overlay "
const e = doc.entries.find(e => e.id === 'TERM_L1_01');
delete e.milestone; e.status = 'implemented'; e.owner = 'swift';"
cat > "$TEMP_SWIFT" <<'EOF'
import Testing
@Test("TERM_L1_01: duplicate one") func specRunnerDrillDupA() {}
@Test("TERM_L1_01: duplicate two") func specRunnerDrillDupB() {}
EOF
run_expect 1 "E_DUPLICATE_TEST" "③ 红灯"
rm -f "$TEMP_SWIFT"
restore_overlay
run_expect 0 "GREEN" "③ 还原后绿灯"

echo "== 演练④: 标 implemented 但无测试 =="
patch_overlay "
const e = doc.entries.find(e => e.id === 'TERM_L1_02');
delete e.milestone; e.status = 'implemented'; e.owner = 'swift';"
run_expect 1 "E_IMPLEMENTED_NO_TEST" "④ 红灯"
restore_overlay
run_expect 0 "GREEN" "④ 还原后绿灯"

echo "== 收尾核验 =="
cmp -s "$BACKUP" "$STATUS" || fail "收尾: status.json 与演练前不一致"
[ -e "$TEMP_SWIFT" ] && fail "收尾: 临时 Swift 文件残留"
echo "DRILL ALL PASS（4 类违规 + 增/删两变体，各自红灯后还原绿灯）"
