// PTY spawn 的 env 合同（纯函数构造 env 字典，vendor-free）。
//
// 权威：terminal-session.md §1.2 env 合同表（逐条继承 legacy pty-adapter.ts 行为 + 一处新增）。
// 供批 2 集成时 MuxvoTerm 消费（Swift 侧组好 envp 传入 CMuxvoPTY forkpty）；本批只做纯函数 + 测试。
//
// 规则（§1.2）：
//   - 删 CLAUDECODE（让 spawned 终端里能再跑 CC；pty-adapter.ts:24-26）
//   - TERM_PROGRAM：darwin 且未设时兜底注入 Apple_Terminal（触发 /etc/zshrc_Apple_Terminal 发
//     OSC 7，cwd 追踪走结构化通道；pty-adapter.ts:32-34）——**仅当未设**才注入，已设则保留
//   - LANG：darwin 且 缺失/C/POSIX 时兜底注入 en_US.UTF-8（CJK 路径显示；pty-adapter.ts:39-41）
//   - COLORTERM=truecolor（**新增非继承**，声明 vt 真彩能力；偏差发现③）——恒设
//   - TERM=xterm-256color（已裁决⑨；terminfo 随系统在。xterm-ghostty 需随包分发 terminfo，推迟
//     M7）——恒设
//   - MUXVO_TERM_ID：注入会话 UUID（**新增**，供 hook 脚本回传等待事件；wait-detector.md §4.2）——恒注入

public enum EnvContract {
    /// hook socket 路由 env key（title-sync 批；HookScript.socketEnvKey 转发此常量保单一权威）。
    /// 恒删继承值（deletedKeys）：嵌套 muxvo（A 分身终端里启动 B 分身）时 B 的进程 environ 带着 A 注入的
    /// 路由值，若透传则 B 的 worker/takeover hook 事件投给 A 的 socket（A 按活体 termId 丢弃=信号静默丢失）。
    /// 删除后：grid 终端由 TerminalService configTemplate 显式重注本 app 路径；worker/takeover 不注 →
    /// 脚本 `${MUXVO_HOOK_SOCK:-…}` 回落各自 app 烘焙默认（本就正确）。
    public static let hookSocketKey = "MUXVO_HOOK_SOCK"

    /// 从子进程 env 删除的键。
    public static let deletedKeys: Set<String> = ["CLAUDECODE", hookSocketKey]

    /// TERM_PROGRAM 兜底值（darwin 且未设时注入）。
    public static let defaultTermProgram = "Apple_Terminal"

    /// LANG 兜底值（darwin 且 缺失/C/POSIX 时注入）。
    public static let fallbackLang = "en_US.UTF-8"

    /// 恒设的 TERM（已裁决⑨）。
    public static let term = "xterm-256color"

    /// 恒设的 COLORTERM（新增非继承）。
    public static let colorterm = "truecolor"

    /// 会话 UUID 的 env key。
    public static let terminalIDKey = "MUXVO_TERM_ID"

    /// 需兜底注入 LANG 的既有值集合（缺失亦触发）。
    private static let langNeedsFallback: Set<String> = ["", "C", "POSIX"]

    /// 纯函数：由 base env（通常取自当前进程 env）构造子进程 env 字典。
    /// - isDarwin：TERM_PROGRAM / LANG 两条兜底仅在 darwin 生效（§1.2 逐条标注 darwin）；参数化供
    ///   非 macOS 分支的确定性单测。运行时用无参重载按编译平台取值。
    public static func build(
        base: [String: String], terminalID: String, isDarwin: Bool
    ) -> [String: String] {
        var env = base

        // 删 CLAUDECODE
        for key in deletedKeys { env.removeValue(forKey: key) }

        // TERM_PROGRAM：darwin 且未设时兜底（已设保留）
        if isDarwin, env["TERM_PROGRAM"] == nil {
            env["TERM_PROGRAM"] = defaultTermProgram
        }

        // LANG：darwin 且 缺失/C/POSIX 时兜底
        if isDarwin {
            let current = env["LANG"] ?? ""
            if langNeedsFallback.contains(current) {
                env["LANG"] = fallbackLang
            }
        }

        // 恒设：COLORTERM / TERM / MUXVO_TERM_ID
        env["COLORTERM"] = colorterm
        env["TERM"] = term
        env[terminalIDKey] = terminalID

        return env
    }

    /// 运行时重载：按编译平台取 isDarwin（app 为 macOS-only，此处恒 darwin=true；逃生舱/CI
    /// 非 macOS 走 false 分支不影响正式路径）。
    public static func build(base: [String: String], terminalID: String) -> [String: String] {
        #if os(macOS)
        build(base: base, terminalID: terminalID, isDarwin: true)
        #else
        build(base: base, terminalID: terminalID, isDarwin: false)
        #endif
    }
}
