# chat-dual-run — M5 双跑对照 harness

M5 聊天数据面**核心验收器**（`specs/behavior/chat-data.md §8`）：新版 `muxvo-chat-dump`
（驱动 `MuxvoChatHistory` 纯函数）与 legacy reader（`muxvo-legacy` 的 `createChatProjectReader` /
`createCodexChatReader`）对同一语料**逐字段 diff**，两侧对称归一化后必须一致。

## 构成

| 文件 | 作用 |
|---|---|
| `../../app/Sources/muxvo-chat-dump/` | 新版 dump 可执行（Swift）。CC fs 壳 `CCFileSource` 批2 为临时实现（驱动同一批纯函数），批末换正式 ChatStore。Codex 侧直用 `CodexSessionSource`。|
| `../../app/Sources/MuxvoChatDumpKit/` | dump 编码内核（四类型→legacy 字段名 JSON + §5.4 聚合），字段映射由 `MuxvoChatDumpKitTests` 钉住。|
| `legacy-dump.mts` | legacy 侧 dump（tsx 直跑 legacy reader），命令面与 `muxvo-chat-dump` 一一对应。|
| `diff.mjs` | 零依赖归一化 diff（§8.2）。也可 `import { diffRecords }`。|
| `fixtures/build-fixtures.mjs` | 合成语料生成器（§7 案例池端到端面）。|
| `run-fixture.sh` / `run-fixture.mjs` | 合成语料全命令对照，**必须全绿 diff=0**（决定性验收，可重复）。|
| `run-real.sh` / `run-real.mjs` | 真数据 per-source 对照（只读采样），报告落 logs。|

## 目录约定（两侧一致，关键）

- `--cc-base` = CC 项目目录（**直接含 `<hash>/` 子目录**，如 `~/.claude/projects`）。basename 须为
  `projects`——legacy `createChatProjectReader` 内部 `join(ccBasePath,'projects')`，故 legacy-dump 取
  `dirname` 还原；新版 dump 直接扫此目录。
- `--codex-base` = Codex sessions 目录（含 `YYYY/MM/DD/`，如 `~/.codex/sessions`）。basename 须为
  `sessions`；两侧取 `dirname` 作 codex 根（全局标题读 `<root>/.codex-global-state.json`）。
- `--mirror` = 镜像/归档扁平根（含 `<hash>/` 子目录）→ legacy `archivePath`（可选）。
- **源推断**：仅 `--cc-base` → CC-only；仅 `--codex-base` → Codex-only；两者都给 → aggregate（§5.4）。

## 命令面（两侧对应）

```
<cmd> = index | projects | sessions (--project <hash>|--all) [--limit N]
      | session --project <hash> --session <id> [--limit N] | search --query <q>
```

`index` 非 diff 面（性能记录，输出 `{command,...}` 单对象）；其余输出四类型 legacy 字段名 JSON 数组。

## 跑合成语料档（决定性，须全绿）

```bash
tools/chat-dual-run/run-fixture.sh          # 构建 dump → 生成 fixtures → 全命令 diff
```

覆盖：四大陷阱（空 title 丢弃 / 纯 tool_result user 丢弃 / sidechain 不过滤 / summary 忽略）+
teammate 拆分（含协议块丢弃）+ image + queue-operation(system/user) + isMeta/isCompact/cd/bindkey +
坏行跳过 + 中文/大小写/emoji + worktree(父存在归并 / 父缺失 remap) + mirror(archiveOnly + 补集 +
Math.max) + Codex(目录/工具/output 保真/thread-title/跨源同 projectHash)。三源模式（cc/codex/aggregate）。

## 跑真数据档（只读，per-source 主口径）

```bash
tools/chat-dual-run/run-real.sh             # 报告落 ~/Library/Caches/muxvo-build/logs/chat-dual-run-<stamp>/
```

⚠️ **只读**：绝不传 `--mirror`、绝不写 `~/.claude` 或 `~/.codex`。
⚠️ **runbook**：跑前请**暂停活跃 CC 会话**——活跃会话在 legacy/new 两次读之间追加文件 → 伪差异
（归「legacy 侧不确定性」残差）。

## 归一化口径（§8.2，diff.mjs 两侧对称施加）

1. 排序：projects 按 `projectHash`；sessions/search 按 `(projectHash, sessionId)`；messages（session）
   **保文件序不排序**（投影顺序即红线）。
2. mtime floor 到整数毫秒（`lastActivity` / `lastModified`）。
3. 孤代理 UTF-16 码元 → `U+FFFD`（§4.2 按码元截断可能切断代理对）。
4. 值为 null/undefined 的可选键省略（对齐 `JSON.stringify` 丢 undefined）。
5. `source` 必填（两侧恒有，不省略）。

## legacy-dump 依赖

- `MUXVO_LEGACY_ROOT`（默认本机 `muxvo-legacy` 路径）——tsx 直跑 legacy reader。
- 运行 cwd 须为 `muxvo-legacy`（使 tsconfig `@/` alias 生效）；`run-*.sh` 已处理。
- **每次新进程 = 无 legacy 5 分钟缓存**（§2.4，保 fileSize/mtime 当次一致）。
