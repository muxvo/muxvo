# contract-recorder

契约录制器：录一次**真** `claude -p` 的 stream-json 输出 → SEC-15 脱敏 → secret-scan 门 →
自动转 fake-cli 剧本。产出的 fixtures 是 `JT_recorded_fixture_replay`（`jsonl-transcript.md` §5）
与 fake-cli 剧本防漂移的**数据源**。

权威规格：`specs/orchestration/fake-cli.md` §4（三道锚 + SEC-15）、§2（剧本 schema v1）。
本目录只产数据/工具，不改任何规格。

## 三道锚里的定位（fake-cli.md §4）

fake-cli 的风险 = 剧本与真 CC 行为漂移。三道锚：

1. **录制（本工具）** — 跑一次真 `claude -p`（最小 prompt），stream-json stdout 原样落
   `fixtures/recorded/<cc-version>/`，脱敏 + secret-scan 后 commit，并自动转可用剧本。
2. **回放断言** — `JT_recorded_fixture_replay`：本目录 fixtures 全量过解析库零 parseError
   （解析库对真实形状的假设被持续验证）。
3. **nightly 真 CC 冒烟** — 另设（非本工具），每日一次最小 E2E，CC 版本破坏 flag/形状时第一时间红。

本工具是**锚1**：把「一次真录 + F4 spike 素材」经同一流水线固化为可 commit 的防漂移基线。

## 目录

```
fixtures/recorded/<cc-version>/   # 如 2.1.201/
  minimal-p.jsonl                 # 真录一次（最小 prompt，临时 cwd）
  minimal-p.script.json           # 上者转 fake-cli §2 剧本
  f4-allow.jsonl / f4-deny.jsonl  # F4 spike 素材（补 rate_limit/thinking/tool_use 形态）
  f4-allow.script.json / f4-deny.script.json
```

## 四命令

```bash
# 1) 录制（全流水线：真录→脱敏→F4 入库→转剧本→scan 门；见收口判据）
tools/contract-recorder/record.sh
#    - 真 claude -p 仅一次（失败重试，总 ≤3），每次 120s 超时；临时 cwd 避免读项目上下文
#    - cc-version 从 `claude --version` 取；产物落 fixtures/recorded/<ver>/
#    - 日志：~/Library/Caches/muxvo-build/logs/m4a-batch0/0c-record.log

# 1b) codex 审查契约录制（批5 W0a；同工艺换 harness）
tools/contract-recorder/record.sh --harness codex
#    - 真 `codex exec --json --sandbox read-only --output-schema` 一次（临时 git 仓 + 已知 bug 小文件）
#    - 产物落 fixtures/recorded/codex-<ver>/exec-schema.jsonl；转剧本暂缓（to-script 收口判据 CC 专属）
#    - MUXVO_CODEX_RAW=<file> 跳过真跑，用已录 raw 走脱敏/扫描（省额度自测 / nightly 复用）

# 2) 脱敏（独立可复用；stdin→stdout 或 in→out；统计打 stderr）
node tools/contract-recorder/redact.mjs <in.jsonl> [out.jsonl]

# 3) 扫描（secret-scan 门；命中即非零退出并打印命中处；缺省扫 fixtures/）
node tools/contract-recorder/scan.mjs [dir_or_file ...]

# 4) 转剧本（.jsonl → fake-cli §2 剧本 schema v1；每行→emit step，末尾 exit）
node tools/contract-recorder/to-script.mjs <in.jsonl> [out.script.json]
```

零 npm 依赖（node ESM + bash），与 `tools/spec-runner`、`tools/hook-replay` 同风格。

## SEC-15 脱敏说明（清洗**输出**非仅输入）

无害 prompt 仍可能让真 CC 把敏感串 surface 进 stdout（`init.cwd`、`memory_paths`、assistant
自由文本等）。`redact.mjs` 逐行改写，**保持 JSON 合法性与事件形状**（只替换字符串值内的敏感
子串为 `REDACTED`，绝不引入引号/破坏转义），并逐行 `JSON.parse` 自检。覆盖类别：

- **home / 绝对路径**：`/Users/<name>`、`/home/<name>`、dashified `-Users-<name>-` → `REDACTED`
- **裸用户名残留**：`$USER` 的非路径处出现（用「安全定界符」lookaround，不误伤 base64 签名）
- **密钥模式**：`sk-ant-*`、`sk-*`、`AKIA*/ASIA*`、`ghp_/gho_/…`、`github_pat_*`、`AIza*`、
  `xox[baprs]-*`、`Bearer <token>`、PRIVATE KEY 块
- **JSON 键值敏感字段**：`authorization` / `password` / `secret` / `api_key` / `access_key` /
  `client_secret` / `refresh_token` / `private_key` 的**值** → `REDACTED`
- **env 值样式**：`*SECRET*/*TOKEN*/*KEY*/*PASSWORD*/*CREDENTIAL*=<value>`（文本边界，防 padding 误伤）
- **init 环境元数据**（结构级）：`system/init` 事件的本机清单数组
  （`tools`/`mcp_servers`/`slash_commands`/`agents`/`skills`/`plugins`，含第三方 mcp 名）内容
  **置空数组**——键保留、仍是数组，JSON 形状/合法性不变；解析契约字段
  （`session_id`/`model`/`cwd`(已脱敏)/`apiKeySource` 等）一律不动

`scan.mjs` 用**同一套模式**对整目录复扫作为**门**：上述密钥/路径/用户名模式 + `env_secret` 全部
镜像自 `redact.mjs`（`INIT_INVENTORY_FIELDS` 常量由 redact 导出、scan 复用，守「redact 有的
scan 必有」不变式），并对 `.jsonl` / `.script.json` 两形态结构级断言「init 清单字段必须为空」。
零命中才算录制完成（`record.sh` 末尾自动跑）。方向是「安全优先」——宁可多替换/多命中，不可漏
（漏 = secret 进 git）。

> 注：脱敏后 `REDACTED` 是白名单 sentinel，scan 不再命中它。裸用户名脱敏用安全定界符而非 `\b`，
> 因短用户名（如 2 字符）在 base64 签名里可能被 `+xx/` 边界误命中；home 路径规则已覆盖用户名的
> 绝大多数出现，裸用户名条仅兜底非路径处。
