// login shell 解析（terminal-session.md §1.1 + 偏差发现①）。
//
// env 合同已收敛到 MuxvoTermCore.EnvContract（vendor-free 纯函数，设计归属在 Core）；
// 本文件只留 MuxvoTerm 侧独有的 shell/argv 解析（Core 未覆盖）。
import Foundation

public enum TerminalLoginShell {
    /// shell 取值：SHELL 环境变量兜底 /bin/zsh（§1.1）。
    public static func resolve(source: [String: String] = ProcessInfo.processInfo.environment) -> String {
        let shell = source["SHELL"] ?? ""
        return shell.isEmpty ? "/bin/zsh" : shell
    }

    /// login shell 约定（偏差发现①）：argv[0] = "-" + basename（POSIX 通用 login，不绑 zsh 专有 --login）。
    /// 如 /bin/zsh → "-zsh"。
    public static func argv(forShell shell: String) -> [String] {
        let base = (shell as NSString).lastPathComponent
        return ["-\(base)"]
    }
}
