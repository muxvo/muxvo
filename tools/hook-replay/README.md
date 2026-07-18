# hook-replay

按剧本向 Muxvo WaitDetector 的 `hook.sock` 回放等待事件，端到端彩排「Layer 0 hook → 红点/浮卡」
全链路，无需真 Claude Code 会话。权威规格：`specs/behavior/wait-detector.md` §4（socket 传输）、§9
（端到端彩排）、§10（案例表）。

走与生产 hook 中继脚本**完全相同**的传输（`nc -U` 发 `{"v":1,"termId","event","raw"}` 帧），
故 native 侧收包/校验/限速/活体 termId 表全链路都被真实驱动。M4a fake-cli 可 shell 出本工具继承。

## 前置

- app 正在运行（socket 已 bind）。dev socket 路径：
  `~/Library/Application Support/Muxvo2 Dev/run/hook.sock`
- 事件里的 `termId` 必须是**活体终端**的 id（native 查无即丢弃）。可从 app 日志/ui.state 取。
- 依赖 `nc`（macOS 自带 BSD netcat）。

## 用法

单条事件：

```bash
tools/hook-replay/hook-replay.sh \
  --sock "$HOME/Library/Application Support/Muxvo2 Dev/run/hook.sock" \
  --term <活体termId> --event Notification --raw '{"message":"需要确认"}'
```

按剧本回放：

```bash
tools/hook-replay/hook-replay.sh \
  --sock "$HOME/Library/Application Support/Muxvo2 Dev/run/hook.sock" \
  --term <活体termId> --scenario tools/hook-replay/scenarios/basic.txt
```

事件白名单（§5 三装一不装）：`Notification` / `Stop` → 亮红；`UserPromptSubmit` → 清红。

## 剧本文件格式

每行 `<event> [delayMsAfterSend] [raw-json...]`；`#` 开头为注释，空行跳过。见 `scenarios/basic.txt`。

## 说明

- 数据目录隔离纪律：`--sock` 须显式传入，本工具不硬编码任何数据目录字面，绝不触老版目录。
- 非法/超限/未知 termId 帧由 native 按「丢弃计数」兜住（§4 注入面）——回放非法帧可验证兜底路径。
