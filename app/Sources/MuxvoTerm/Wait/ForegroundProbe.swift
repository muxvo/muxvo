// ForegroundProbe：前台进程探测（wait-detector.md §6 进程兜底 / terminal-session.md §5 路径②）。
//
// legacy 行为锚点（亲验 foreground-detector.ts:7-36）：`getForegroundChildPid` = `pgrep -P shellPid`
// 取最后一个子 pid（最近 fork 的前台进程）；`getForegroundProcessName` = `ps -p pid -o comm=`。
// 读行为不抄结构：新实现走同样的系统命令（无结构化替代——内核前台组信息只能这么取），仅供
// 静默门控（「前台是否 harness/非 shell 类进程」）与「前台消失回 shell」清红判定。
//
// 纯 pid 层，无会话依赖；execFile 短超时、失败即 nil（探测失败按「无前台非 shell 进程」保守处理，
// 不误报静默）。cwd 探测（lsof）由 §5 主路径 OSC7 覆盖，本探针不重复实现。
import Foundation

public enum ForegroundProbe {
    /// 视作「shell」的前台进程名集合（其子仍是 shell 时不算「前台跑了非 shell 程序」）。
    /// 覆盖常见交互 shell 及其 login 形态（argv[0] 前缀 `-`，comm 通常仍是 zsh 等无前缀）。
    static let shellNames: Set<String> = [
        "zsh", "-zsh", "bash", "-bash", "sh", "-sh", "fish", "-fish",
        "dash", "-dash", "tcsh", "-tcsh", "csh", "-csh", "ksh", "-ksh", "login",
    ]

    /// shell 的前台子进程 pid（`pgrep -P shellPid` 的最后一个）。无子进程（shell 空闲在提示符）→ nil。
    public static func foregroundChildPid(shellPid: Int32) -> Int32? {
        guard shellPid > 1 else { return nil }
        guard let out = runCommand("/usr/bin/pgrep", ["-P", String(shellPid)]) else { return nil }
        let pids = out.split(whereSeparator: { $0 == "\n" }).compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
        return pids.last
    }

    /// 进程名（`ps -p pid -o comm=` 的 basename）。失败 → nil。
    public static func processName(pid: Int32) -> String? {
        guard pid > 1 else { return nil }
        guard let out = runCommand("/bin/ps", ["-p", String(pid), "-o", "comm="]) else { return nil }
        let name = out.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        // comm 可能是全路径（如 /usr/bin/vim）→ 取 basename。
        return (name as NSString).lastPathComponent
    }

    /// 前台是否跑着「非 shell 进程」（静默门控输入，§6）：shell 有前台子进程且该子进程名不在 shell 集。
    /// 无前台子（空闲提示符）或子仍是 shell → false（不触发静默弱信号）。探测失败 → false（保守）。
    public static func isNonShellForeground(shellPid: Int32) -> Bool {
        guard let childPid = foregroundChildPid(shellPid: shellPid) else { return false }
        guard let name = processName(pid: childPid) else { return false }
        return !shellNames.contains(name)
    }

    // MARK: - 三态前台探测（terminal-session-restore.md §1.5：Codex 锚点采集清锚点判定用）

    /// 前台三态（§1.5）：清锚点判定必须区分「确认非 codex」与「探测失败」——旧 `foregroundChildPid`/
    /// `isNonShellForeground` 把「pgrep 无子进程（exit 1）」和「探测失败」都折成 nil/false，采集器无法据此
    /// 安全清锚点（探测抖动会误清活锚点）。三态在其上派生。
    public enum ForegroundState: Sendable, Equatable {
        case idle                                       // shell 空闲在提示符（pgrep 明确无前台子进程）
        case running(name: String, command: String)     // name=comm basename、command=完整 argv（供 codex 命令行判据）
        case unknown                                     // 探测失败（pgrep/ps 失败/超时）——不作清锚点依据
    }

    /// 取前台三态（一次 pgrep + 一次 `ps -o comm=,args=`，与 M3 现状同 exec 数）。
    public static func foregroundState(shellPid: Int32) -> ForegroundState {
        guard shellPid > 1 else { return .idle }
        guard let (pgrepOut, pgrepCode) = runCommandWithCode("/usr/bin/pgrep", ["-P", String(shellPid)]) else {
            return .unknown // 起不来/超时
        }
        if pgrepCode == 1 { return .idle } // pgrep 明确「无匹配子进程」= shell 空闲
        guard pgrepCode == 0 else { return .unknown } // 2/3 = pgrep 自身错误 → 不确定
        let pids = pgrepOut.split(whereSeparator: { $0 == "\n" })
            .compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
        guard let childPid = pids.last else { return .idle } // 退 0 但空（罕见）按空闲
        guard let (psOut, psCode) = runCommandWithCode(
            "/bin/ps", ["-p", String(childPid), "-o", "comm=", "-o", "args="]), psCode == 0
        else { return .unknown }
        guard let (name, command) = parseCommAndArgs(psOut) else { return .unknown } // 子进程恰在此刻退出→不确定
        return .running(name: name, command: command)
    }

    /// 解析 `ps -o comm= -o args=` 输出（纯函数，可单测）：`<comm> <args…>` → (comm basename, 完整 argv)。
    /// comm 段 = 首个空白前（ps 的 comm 是可执行路径/名，实测无空格；node 包装 argv[0]=node、原生
    /// argv[0]=/path/codex，两者 comm 均无空格成立）；args 段 = 余部（内部空格保留）。空输出 → nil。
    static func parseCommAndArgs(_ psOutput: String) -> (name: String, command: String)? {
        let trimmed = psOutput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let comm: String
        let command: String
        if let sp = trimmed.firstIndex(where: { $0 == " " }) {
            comm = String(trimmed[trimmed.startIndex..<sp])
            command = String(trimmed[trimmed.index(after: sp)...]).trimmingCharacters(in: .whitespaces)
        } else {
            comm = trimmed
            command = trimmed
        }
        return ((comm as NSString).lastPathComponent, command)
    }

    /// 前台是否跑着「非 shell 进程」（从三态派生，供 WaitDetectorHub 静默门控复用同一次探针快照）。
    public static func isNonShellName(_ name: String) -> Bool { !shellNames.contains(name) }

    /// 命令行是否在跑 Codex（§1.5 关键判据）：argv **任一空格分隔 token 的 basename == "codex"**。
    /// 覆盖两种安装形态——原生二进制（`codex`/`/path/codex`）；**npm node 包装**（`node /path/bin/codex exec`，
    /// 用户实测形态：shell 前台直接子进程 comm=node、原生 codex 是其孙进程，故只看 comm 会漏）。按 token
    /// basename 精确匹配（非子串包含）避免 `vim codex.md` 类误判；残余（`cat /x/codex`）由后续 rollout cwd
    /// 唯一候选匹配兜底（匹配不到不绑）。
    public static func commandIsCodex(_ command: String) -> Bool {
        command.split(whereSeparator: { $0 == " " || $0 == "\t" }).contains { token in
            (String(token) as NSString).lastPathComponent == "codex"
        }
    }

    // MARK: 私有

    /// 同步执行短命令收 stdout（超时 2s，比照 legacy execFileSync timeout:2000）。失败/超时 → nil。
    private static func runCommand(_ path: String, _ args: [String]) -> String? {
        runCommandWithCode(path, args).map(\.out)
    }

    /// 执行短命令收 (stdout, 退出码)（三态探测用：需区分 pgrep exit 1〔无子进程〕vs 探测失败）。
    /// 起不来/异常 → nil（= unknown）；正常退出返回 (输出, 码)。
    private static func runCommandWithCode(_ path: String, _ args: [String]) -> (out: String, code: Int32)? {
        guard FileManager.default.isExecutableFile(atPath: path) else { return nil }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: path)
        proc.arguments = args
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
        } catch {
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        proc.waitUntilExit()
        return (String(decoding: data, as: UTF8.self), proc.terminationStatus)
    }
}
