// ApprovalHookScript：交互式 worker 同步审批 hook 中继脚本（interactive-worker.md §2 + S-hook spike §E）。
//
// 与遥测 `HookScript`（fire-and-forget 单向、读帧即焚）**并存不复用**——S-hook §E 定案：同步审批须**另起
// 一套双向脚本**（PreToolUse 发请求 + 阻塞读决策 + 打 permissionDecision JSON + exit 0），与遥测「nc & exit 0」
// 形状根本不同。装 worker 隔离 configDir 的 settings.json，与遥测三 hook 事件不重叠（PreToolUse/PostToolUse
// 归审批脚本；Notification/Stop/UserPromptSubmit 归遥测脚本）。
//
// **三态防线（本脚本存在的唯一理由，S-hook Exp C 铁律）**：CC hook 超时默认 **fail-OPEN 自动放行**——
// 若赌 hook 阻塞过 timeout 等人，人没来会自动放行破坏 ☆B4。故本脚本对 **app-absent / socket 缺失 /
// 回包缺失或形状错 / 未拿到决策** 一律输出 `permissionDecision:"ask"`（升级人类原生对话框），**绝不 allow**。
// 对抗断言「杀审批监听 → 必 ask」由此成立（socket 被 unlink → `[ -S ]` 假 → emit_ask）。
//
// PostToolUse 反推锚（oracle-4，§2）：人于 CC 原生对话框裁后工具真跑 → PostToolUse 触发 → 本脚本 fire-and-forget
// 把 `{tool_use_id}` 发审批 socket，app 反推 `approval_granted(actor:.user, decidedBy:"terminal_native")`。
//
// 路径字面纪律（同 HookScript 文件头）：审批 socket 路径由调用方从 DataDirectory 派生**绝对路径**注入，
// **不在本文件硬编码数据根字面**（preflight 第 6 步机器固化）。`MUXVO_APPROVAL_SOCK` 可覆盖用于测试。
import Foundation

public enum ApprovalHookScript {
    /// 脚本指纹版本（内容变更即 +1，触发 drift 自检重装，同 HookScript §7）。
    public static let version = 1

    /// 审批中继脚本文件名（装 `<dataRoot>/hooks/` 下，与遥测脚本同目录）。
    public static let scriptFileName = "muxvo-approval-hook.sh"

    /// settings.json 识别子串（按 command 含此子串识别审批组，幂等/可逆；与遥测子串区分）。
    public static let identifierSubstring = "muxvo-approval-hook.sh"

    /// 装载的两 hook 事件（PreToolUse 双向审批；PostToolUse 反推 fire-and-forget）。顺序稳定。
    public static let installedEvents = ["PreToolUse", "PostToolUse"]

    /// 审批 socket 文件名（`<dataRoot>/run/approval.sock`；与遥测 `hook.sock` 区分，二监听各 bind 自己的）。
    public static let socketFileName = "approval.sock"

    /// hook 有界阻塞窗口秒数（nc -w）：app 侧 policy 裁决/落库为毫秒级，此窗口只需覆盖之；窗口内 app 未回
    /// → nc 空返 → emit_ask（升级人类），**绝不**赌满 CC 的 600s timeout（那会 fail-OPEN）。
    public static let requestTimeoutSeconds = 30

    /// 审批 socket 绝对路径 `<dataRoot>/run/approval.sock`（安装器生成脚本 + ApprovalSocketListener bind 共用
    /// 此唯一派生，保生产脚本写的路径与 native 监听 bind 的路径一致）。
    public static func socketURL(dataRoot: URL) -> URL {
        HookScript.runDirectory(dataRoot: dataRoot).appendingPathComponent(socketFileName)
    }

    /// 审批脚本文件 `<dataRoot>/hooks/muxvo-approval-hook.sh`。
    public static func scriptURL(dataRoot: URL) -> URL {
        HookScript.hooksDirectory(dataRoot: dataRoot).appendingPathComponent(scriptFileName)
    }

    /// settings.json 组内 command 串：`"<scriptPath>" <Event>`（引号裹路径含空格；同 HookScript.command 体例）。
    public static func command(scriptPath: String, event: String) -> String {
        "\"\(scriptPath)\" \(event)"
    }

    /// 双向审批中继脚本全文（受控增补：版本指纹 + socket 路径注入，同 HookScript）。
    /// - Parameter socketPath: `<dataRoot>/run/approval.sock` 绝对路径（`MUXVO_APPROVAL_SOCK` 可覆盖）。
    public static func scriptText(socketPath: String) -> String {
        """
        #!/bin/bash
        # Muxvo interactive approval relay — 三态防线：任何异常一律 ask，绝不 fail-OPEN allow
        # muxvo-approval-hook-version: \(version)
        EVENT="$1"
        SOCK="${MUXVO_APPROVAL_SOCK:-\(socketPath)}"
        payload=$(cat)

        emit_ask() {
          printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}' "$1"
          exit 0
        }

        # PostToolUse：人裁后工具真跑 → 反推 allow。fire-and-forget 一帧发审批 socket，不阻塞、无 stdout 决策。
        if [ "$EVENT" = "PostToolUse" ]; then
          [ -n "$MUXVO_TERM_ID" ] || exit 0
          [ -S "$SOCK" ] || exit 0
          printf '{"v":1,"termId":"%s","event":"PostToolUse","raw":%s}\\n' "$MUXVO_TERM_ID" "$payload" \\
            | nc -U -w 2 "$SOCK" >/dev/null 2>&1 &
          exit 0
        fi

        # PreToolUse：双向同步审批。三态防线——termId/socket/回包任一缺失 → ask。
        [ -n "$MUXVO_TERM_ID" ] || emit_ask "no term id"
        [ -S "$SOCK" ] || emit_ask "app absent"
        req=$(printf '{"v":1,"termId":"%s","event":"PreToolUse","raw":%s}' "$MUXVO_TERM_ID" "$payload")
        resp=$(printf '%s\\n' "$req" | nc -U -w \(requestTimeoutSeconds) "$SOCK" 2>/dev/null)
        decision=$(printf '%s' "$resp" | sed -n 's/.*"permissionDecision"[[:space:]]*:[[:space:]]*"\\([a-z]*\\)".*/\\1/p')
        case "$decision" in
          allow|deny|ask) ;;
          *) emit_ask "no decision" ;;
        esac
        reason=$(printf '%s' "$resp" | sed -n 's/.*"permissionDecisionReason"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}' "$decision" "$reason"
        exit 0

        """
    }
}
