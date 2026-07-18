// GitCLI：通用 git（及旁路子进程如 du）运行器，带**超时杀**（watchdog SIGKILL）与**可注入 env**。
//
// 批A（M6）新增：worktree 交互域 / GitStatusCache 探针 / .git 体积测量共用底座。刻意与编排侧
// WorktreeManager.runGit 并存不合并——后者已过对抗验收，本批不动它（plan-native §5.3；后续机械 PR
// 再等价迁移）。
//
// 设计：
//   · 主接口是**同步阻塞核** `runSync`（与 WorktreeManager 同范式，副作用集中、纯值出参易断言）；
//     调用方（InteractiveWorktreeService / GitStatusCache）在**各自的串行 DispatchQueue** 内用它，
//     借队列天然串行化（create/remove 双击竞态结构性消除、同 repo 探针不并发）。
//   · 另提供 async 便捷包装 `git(_:timeout:)`（把 runSync 抛到全局队列 + continuation），供无需
//     自持队列的调用方。
//   · 超时：Process.run 后挂一个 watchdog（timeout 到 → SIGKILL pid）；进程被杀 → 管道写端关闭 →
//     readDataToEndOfFile 解阻塞 → waitUntilExit 立即返回。timedOut 标志经锁回传（区分「git 非零退出」
//     与「被超时杀」——后者 create 走 TIMEOUT 特化文案）。
//   · env 注入：非空时以 ProcessInfo.environment 为基底覆盖（测试注入
//     GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 隔离用户全局/系统 git 配置）。
import Foundation

public struct GitCLI: Sendable {
    /// 覆盖进程环境的键值（空 = 直接继承调用进程 env，走 PATH 找 git）。
    public var environment: [String: String]

    public init(environment: [String: String] = [:]) {
        self.environment = environment
    }

    /// 子进程结果。`timedOut` = watchdog SIGKILL 触发（区别于 git 自身非零退出）。
    public struct Output: Sendable, Equatable {
        public let code: Int32
        public let stdout: String
        public let stderr: String
        public let timedOut: Bool

        public init(code: Int32, stdout: String, stderr: String, timedOut: Bool) {
            self.code = code
            self.stdout = stdout
            self.stderr = stderr
            self.timedOut = timedOut
        }
    }

    /// 同步跑 git（args 不含 "git" 前缀）；调用方须自行放在合适队列（阻塞）。
    public func gitSync(_ args: [String], timeout: TimeInterval) -> Output {
        Self.runSync(executable: "git", args: args, environment: environment, timeout: timeout)
    }

    /// async 便捷：抛到全局 utility 队列跑 gitSync（无需调用方自持队列时用）。
    public func git(_ args: [String], timeout: TimeInterval) async -> Output {
        let env = environment
        return await withCheckedContinuation { (cont: CheckedContinuation<Output, Never>) in
            DispatchQueue.global(qos: .utility).async {
                cont.resume(returning: Self.runSync(
                    executable: "git", args: args, environment: env, timeout: timeout))
            }
        }
    }

    /// 通用同步子进程核（git / du 等，executable 经 /usr/bin/env 走 PATH 解析）。带 watchdog SIGKILL。
    public static func runSync(
        executable: String, args: [String],
        environment: [String: String] = [:], timeout: TimeInterval
    ) -> Output {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = [executable] + args
        if !environment.isEmpty {
            var env = ProcessInfo.processInfo.environment
            for (k, v) in environment { env[k] = v }
            p.environment = env
        }
        let outPipe = Pipe()
        let errPipe = Pipe()
        p.standardOutput = outPipe
        p.standardError = errPipe
        do {
            try p.run()
        } catch {
            return Output(code: -1, stdout: "", stderr: "spawn 失败：\(error)", timedOut: false)
        }

        // watchdog：只捕获 pid（Int32）+ 标志（避免捕 Process 非 Sendable）。timeout 到 → SIGKILL。
        // 进程正常结束后 waitUntilExit 返回，随即 cancel——超时窗（timeout 秒后）内进程几乎必已结束，
        // 误杀重用 pid 的窗口是微秒级 × 恰好卡在 timeout 边界，可忽略（生产同类实现共识）。
        let flag = TimeoutFlag()
        let pid = p.processIdentifier
        let watchdog = DispatchWorkItem {
            flag.set()
            kill(pid, SIGKILL)
        }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: watchdog)

        // 读两管道：本 runner 服务的命令（worktree list / rev-parse / du / branch）输出量小，
        // 先排干 stdout（可能较大）再读 stderr（恒小）不会撑爆 64KB 管道缓冲致死锁。
        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        watchdog.cancel()

        return Output(
            code: p.terminationStatus,
            stdout: String(decoding: outData, as: UTF8.self),
            stderr: String(decoding: errData, as: UTF8.self),
            timedOut: flag.get)
    }
}

/// 线程安全布尔盒（watchdog 线程 set / runner 线程 get）。
private final class TimeoutFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func set() { lock.lock(); value = true; lock.unlock() }
    var get: Bool { lock.lock(); defer { lock.unlock() }; return value }
}
