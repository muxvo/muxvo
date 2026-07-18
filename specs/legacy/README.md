# specs/legacy — 老 app 行为 oracle（迁移自 muxvo-legacy）

## 来源

- 仓库：`../muxvo-legacy/tests/specs/`（功能冻结，只读）
- 来源 commit：`0468e68df413301d785f44c3918d6fb9dfc81c52`
- 迁移日期：2026-06-11（M1 任务 12）
- 迁移方式：`cp` 字节原样，两侧 `md5 -q` 逐一比对一致

## 计数（实测 176，老文档"225"为过时数字）

L1 × 8 = 138：term 19 / chat 27 / config 27 / file 32 / auth 6 / cross 12 / data 7 / editor 8
L2 × 4 = 38：boundaries 11 / grid-layout 13 / perf-thresholds 9 / state-ui-map 5

| 文件 | case | md5 |
|---|---|---|
| l1/auth.spec.json | 6 | 38dd75f64d9ef34cf4dd79224175f0d2 |
| l1/chat.spec.json | 27 | 9d9ed4c7f014ce365a3ac49eb5deb604 |
| l1/config.spec.json | 27 | 271f929ce48e5dc8ced4594e4460ed53 |
| l1/cross.spec.json | 12 | 89b6f2f756049bb7002e60f133094811 |
| l1/data.spec.json | 7 | 99c056d8d08e79b97ef3091b11be5373 |
| l1/editor.spec.json | 8 | 6c1af3999e5b46cbf433ed8e46b2bd4c |
| l1/file.spec.json | 32 | 5fc55912cd516e1b015cdfa20cb14309 |
| l1/term.spec.json | 19 | 7ccd81c7dea35067b956ab96d73101c9 |
| l2/boundaries.spec.json | 11 | 172a9f1e0db8c5ed4089e0a9b1e6321c |
| l2/grid-layout.spec.json | 13 | 290b912b6f740e56bc14efaed7662550 |
| l2/perf-thresholds.spec.json | 9 | 719c02a24fdf6ace911fa26069ef0e0c |
| l2/state-ui-map.spec.json | 5 | b3784a9fcdb1d21a54f733c7c8705073 |

## 永不改原则

12 个 `.spec.json` 是老 app 行为的 oracle，**永不修改**。md5 固化在 `CHECKSUMS`，
`tools/spec-runner/run.mjs` 每次运行都校验（不符 → E_SPEC_INTEGRITY 红灯）——
「永不改」由机器强制，不靠约定。新版行为与老 spec 出现分歧时，分歧写进 overlay
（todo→改 milestone、或转 not-applicable 并写明理由），原文件一个字节不动。

## overlay：status.json

每个 spec ID 必须且只能有一条归属（176/176 全归属由 runner 硬强制，双向集合相等）：

| status | 必填字段 | 语义 |
|---|---|---|
| `implemented` | `owner` ∈ {swift, web} | 该 ID 在 owner 宇宙有且仅有 1 个以 `ID: ` 开头命名的真实测试 |
| `todo` | `milestone` ∈ {M1..M7} | 计划在该里程碑实现；此时**不得**有 active 测试（允许至多 1 个占位：Swift `.disabled` / vitest `test.todo`） |
| `not-applicable` | `reason` 非空 | 仅 legacy/Electron 特有、新架构无对应物；不得有任何形式的测试 |

可选字段 `note`。其余未知字段 → E_SCHEMA。entries 为**数组**（非 map——JSON 重复 key
会被 JSON.parse 静默吞掉，数组才能让 runner 检出重复 ID）。

## runner 裁决规则摘要（详见 tools/spec-runner/run.mjs 头注）

1. CHECKSUMS / totalCases / ID 形状 / ID 全集唯一（E_SPEC_INTEGRITY）
2. overlay schema（E_SCHEMA）；spec 全集 ↔ overlay 全集双向相等（E_SET_MISMATCH）
3. 防伪：任何形式（active / disabled / test.todo / @Suite / test.each 注入）的
   spec-ID 形状测试名 ∉ spec 全集 → E_FORGED_ID
4. 同 ID 出现在 >1 个测试位置（含跨宇宙、含占位）→ E_DUPLICATE_TEST
5. 逐 ID 按 status 裁决：E_IMPLEMENTED_NO_TEST / E_WRONG_UNIVERSE / E_TODO_HAS_TEST / E_NA_HAS_TEST

**test.each 注入约束**：web 测试若用 `test.each(...)('$id: ...')` 从 spec JSON 批量生成
测试，则被注入 spec 文件的**全部** case 必须 overlay 标 `implemented+owner=web`，否则
E_INJECTION_PARTIAL（老 verify-coverage 对过滤子集会全量误注入，新 runner 把这个
不精确升级为硬约束）。

违规演练（红灯自检）：`bash tools/spec-runner/drill.sh`。
