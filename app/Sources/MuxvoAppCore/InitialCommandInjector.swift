// 静默门注入底层原语（唯一）+ 恢复注入器（terminal-session-restore.md §3 注入路径，found MIN-6）。
//
// MIN-6：静默门是**唯一底层原语**——接管注入（TakeoverTextInjector）与恢复注入（InitialCommandInjector）
// 是它的**兄弟薄封装**（勿复制粘贴）。共用逻辑：轮询首输出 + 静默门 + 超时 + 可选人键 abort。差异：
//   · TakeoverTextInjector：normalize 剥控制字节 + **绝不发 CR**（活体 CC TUI，意外对话框零确认）；无 abort。
//   · InitialCommandInjector：build `cd -- '<esc>' && <harness resume 形> <id>` + **尾部单 CR**（P-1 自动回车，
//     目标是空 shell 提示符，风险面窄）；注入前/中检出真人键 → abort 退化普通 shell（feas M-9）。resume 形按
//     harness：CC `claude --resume <id>` / Codex `codex resume <id>`（**均不带 `--`**——`--resume --` 会被吞值
//     进交互选择器，M5-R1 修正的真机回归，见 ResumeCommand.Harness）。
import Foundation
import MuxvoStorage
import MuxvoTerm

// MARK: - 共用底层原语

/// 静默门注入循环（唯一原语）：轮询会话输出活动戳（内容盲——核心原则二边界），过门即 `write(payload)`。
/// payload 是调用方**已备好的最终串**（含或不含尾 CR 由封装决定），本原语不 normalize、不加/删 CR。
public enum SilenceGateInjector {
    public typealias Clock = @Sendable () -> UInt64

    /// 跑注入循环。返回 true=已写 payload / false=放弃（超时/取消/payload 空/abortIf 命中）。
    /// - Parameters:
    ///   - baselineMs: spawn 时刻活动戳基线（须以「晚于基线」判首输出，防空 shell 未回显盲注）。
    ///   - lastOutput: 会话输出活动戳读口（TerminalSession.lastOutputMs）。
    ///   - write: 注入写口（尾 CR 与否由 payload 决定，本原语原样写）。
    ///   - abortIf: 每轮 + 写前检；命中即放弃（恢复场景 = 真人键介入 → abort；接管场景恒 false）。
    public static func run(
        payload: String,
        baselineMs: UInt64,
        lastOutput: @escaping Clock,
        write: @escaping @Sendable (String) -> Void,
        abortIf: @escaping @Sendable () -> Bool = { false },
        nowMs: @escaping Clock = { WaitClock.nowMs() },
        sleepMs: @escaping @Sendable (UInt64) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: ms * 1_000_000)
        }
    ) async -> Bool {
        guard !payload.isEmpty else { return false }
        let deadline = nowMs() + TakeoverInjectGate.timeoutMs
        while !Task.isCancelled {
            if abortIf() { return false } // 人键介入（注入前/中）→ abort
            switch TakeoverInjectGate.evaluate(
                baselineMs: baselineMs, lastOutputMs: lastOutput(),
                nowMs: nowMs(), deadlineMs: deadline)
            {
            case .inject:
                if abortIf() { return false } // 写前最后一道
                write(payload)
                return true
            case .abort:
                return false
            case .wait:
                await sleepMs(50)
            }
        }
        return false
    }

    /// 只等静默门过、不写（M4b B3-2 兄弟原语，MIN-6）：`TerminalSendHost` 多段落 PTY 前的就绪门
    /// （§2「就绪门是 per-harness 属性，SendPlan 在门过后才逐段落 PTY」）。返回 true=门已过可写 /
    /// false=超时/取消/abortIf 命中。**门半逻辑与 `run` 同源**（同 `TakeoverInjectGate.evaluate` + 50ms
    /// 轮询 + abort 检）——`run` 本体不动、注入行为零改，本方法加性抽出门半供多段执行复用。
    public static func awaitGate(
        baselineMs: UInt64,
        lastOutput: @escaping Clock,
        abortIf: @escaping @Sendable () -> Bool = { false },
        nowMs: @escaping Clock = { WaitClock.nowMs() },
        sleepMs: @escaping @Sendable (UInt64) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: ms * 1_000_000)
        }
    ) async -> Bool {
        let deadline = nowMs() + TakeoverInjectGate.timeoutMs
        while !Task.isCancelled {
            if abortIf() { return false }
            switch TakeoverInjectGate.evaluate(
                baselineMs: baselineMs, lastOutputMs: lastOutput(),
                nowMs: nowMs(), deadlineMs: deadline)
            {
            case .inject: return true
            case .abort: return false
            case .wait: await sleepMs(50)
            }
        }
        return false
    }
}

// MARK: - 恢复注入器

/// 恢复注入器（案 A，S2 背书）：终端首进程 = 普通 login shell；构建 resume 命令 + 尾 CR，走共用静默门。
public enum InitialCommandInjector {
    /// 尺寸就绪超时（登记⑩）：冷启动最坏链 = web 加载 + layoutReport + IPC + 80ms settle + F7 门
    /// ~2-3s，取 5s 留余量。超时 = 终端洞不可见（用户停在别的面板，无 layoutReport 永不就绪）→
    /// 照常注入（不劣于修复前；注入落地 cols 落 .notice 可判层）。与静默门 8s 串联（前置等待不占
    /// 其预算），最坏总时长 13s——仅「洞不可见 + CLI 持续喷字节」双重极端下达到。
    public static let sizeReadyTimeoutMs: UInt64 = 5_000

    /// 跑恢复注入。返回 true=已注入 / false=放弃（sessionId 非法 / 超时 / 静默门不达 / 人键 abort）。
    /// - Parameters:
    ///   - cwd: 锚点 cwd（不可信，单引号转义进 `cd --`）。
    ///   - sessionId: 已校验 sessionId（协调层先 gate；本器再验一道纵深防线）。Codex session id 亦为 UUID，
    ///     同过 `isValidSessionId` 严格白名单；非 UUID → 照旧降级（返回 false，调用方退化纯 shell）。
    ///   - harness: resume 命令形（.claude=`claude --resume`/.codex=`codex resume`）；auto-restore 恒 .claude，
    ///     用户主动「继续聊天」按 source 传 .codex（§7.7）。
    ///   - humanInputArrived: 真人键（provenance 复用 wait-detector §3，排除自动回显/程序注入）到达即 true → abort。
    ///   - sizeReady: 尺寸就绪门（登记⑩）：PTY 仍是 spawn 默认 80×24 时注入 resume，回放整段按 80 列
    ///     硬换行烧进 scrollback（变宽 reflow 救不回硬换行）。调用方传 `session.hasReceivedResize`；
    ///     默认恒 true = 兄弟封装/既有调用零变化。
    public static func run(
        cwd: String,
        sessionId: String,
        harness: ResumeCommand.Harness = .claude,
        baselineMs: UInt64,
        lastOutput: @escaping @Sendable () -> UInt64,
        write: @escaping @Sendable (String) -> Void,
        humanInputArrived: @escaping @Sendable () -> Bool = { false },
        sizeReady: @escaping @Sendable () -> Bool = { true },
        sizeReadyTimeoutMs: UInt64 = InitialCommandInjector.sizeReadyTimeoutMs,
        nowMs: @escaping @Sendable () -> UInt64 = { WaitClock.nowMs() },
        sleepMs: @escaping @Sendable (UInt64) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: ms * 1_000_000)
        }
    ) async -> Bool {
        guard TerminalRestoreGate.isValidSessionId(sessionId) else { return false }
        // M-1 纵深防线：cwd 含控制字节（CR/LF/ESC/C0/DEL）→ 拒注入（协调层 planner 已前置过滤，此为二道闸）。
        guard let payload = ResumeCommand.buildInjectionIfSafe(cwd: cwd, sessionId: sessionId, harness: harness)
        else { return false }
        // 尺寸就绪门（登记⑩）：静默门之外的前置等待——等首个 bounds 驱动 resize 已达会话再注入；
        // 超时兜底防洞不可见永等。人键介入语义与静默门一致：abort 退化普通 shell。
        let sizeDeadline = nowMs() + sizeReadyTimeoutMs
        while !sizeReady(), nowMs() < sizeDeadline, !Task.isCancelled {
            if humanInputArrived() { return false }
            await sleepMs(50)
        }
        return await SilenceGateInjector.run(
            payload: payload, baselineMs: baselineMs, lastOutput: lastOutput, write: write,
            abortIf: humanInputArrived, nowMs: nowMs, sleepMs: sleepMs)
    }
}

// MARK: - 帮助会话注入器

/// 帮助会话注入器（右上角批 B3；menu-bar.md §6，legacy MenuBar.tsx:113-130 行为对齐）：问号按钮
/// 新建的空 shell 里注入 `claude "请读取 <guide> …"` + 尾部单 CR，进入可问答的帮助会话。第四个
/// 兄弟薄封装（MIN-6）：过尺寸就绪门（登记⑩ 同源——命令行长于 80 列，spawn 默认宽下注入会硬换行
/// 烧 scrollback）+ 共用静默门。**偏差登记**：legacy 固定 500ms 盲延时 → 本实现静默门（机制上位替代，
/// 效果=等 shell 提示符就绪才注入）。humanInputArrived 是预留接缝（legacy 无 abort 语义，B3 调用方不接）。
public enum HelpGuideInjector {
    /// 注入串（含尾 CR）。guide 路径进双引号串（legacy 同形）：含控制字节或双引号内元字符
    /// （`"` `$` `` ` `` `\`）→ nil 拒注入（数据根路径本受控，纯纵深防线）。
    public static func buildInjectionIfSafe(guidePath: String) -> String? {
        guard !TerminalRestoreGate.cwdHasControlBytes(guidePath),
              !guidePath.contains("\""), !guidePath.contains("$"),
              !guidePath.contains("`"), !guidePath.contains("\\")
        else { return nil }
        return "claude \"请读取 \(guidePath) 这份 Muxvo 操作指南，然后等待我的问题。"
            + "我会问你关于 Muxvo 的使用方法，请基于文档内容回答。\"\r"
    }

    /// 跑帮助注入。返回 true=已注入 / false=放弃（路径元字符 / 超时 / 静默门不达 / 人键 abort）。
    public static func run(
        guidePath: String,
        baselineMs: UInt64,
        lastOutput: @escaping @Sendable () -> UInt64,
        write: @escaping @Sendable (String) -> Void,
        humanInputArrived: @escaping @Sendable () -> Bool = { false },
        sizeReady: @escaping @Sendable () -> Bool = { true },
        sizeReadyTimeoutMs: UInt64 = InitialCommandInjector.sizeReadyTimeoutMs,
        nowMs: @escaping @Sendable () -> UInt64 = { WaitClock.nowMs() },
        sleepMs: @escaping @Sendable (UInt64) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: ms * 1_000_000)
        }
    ) async -> Bool {
        guard let payload = buildInjectionIfSafe(guidePath: guidePath) else { return false }
        // 尺寸就绪门（登记⑩ 同源）：等首个 bounds resize 达会话再注入；超时兜底照常注入。
        let sizeDeadline = nowMs() + sizeReadyTimeoutMs
        while !sizeReady(), nowMs() < sizeDeadline, !Task.isCancelled {
            if humanInputArrived() { return false }
            await sleepMs(50)
        }
        return await SilenceGateInjector.run(
            payload: payload, baselineMs: baselineMs, lastOutput: lastOutput, write: write,
            abortIf: humanInputArrived, nowMs: nowMs, sleepMs: sleepMs)
    }
}

// MARK: - cwd 钉住注入器

/// cwd 钉住注入器（dogfood-r2#4 根因 B；worktree-popover.md §4 契约改写）：`term.command create{cwd}`
/// 的显式目录意图抗 login-shell 漂移——`.zshrc` 无条件 `cd` 会把 PTY spawn cwd 漂走（F-B 同源真机
/// 证据），legacy 以 800ms 盲延时补写 `cd '<path>' && clear`，此处以共用静默门替代盲延时。第三个
/// 兄弟薄封装（MIN-6）：payload = `cd -- '<esc>' && clear` + **尾部单 CR**（目标是空 shell 提示符，
/// 与恢复注入同风险面）；真人键先到 → abort 退化（不抢用户键盘，终端留在漂移目录）。
public enum CwdPinInjector {
    /// 注入串（含尾 CR）：单引号转义杀全部元字符注入面（SEC-B1 同式）；`clear` 抹启动噪声（legacy
    /// 同款界面语义，cd 失败则短路不 clear、错误可见）。cwd 含控制字节 → nil（M-1 同闸，拒变形串进 PTY）。
    public static func buildInjectionIfSafe(cwd: String) -> String? {
        guard !TerminalRestoreGate.cwdHasControlBytes(cwd) else { return nil }
        return "cd -- \(ResumeCommand.singleQuoteEscape(cwd)) && clear\r"
    }

    /// 跑 cwd 钉住注入。返回 true=已写 payload / false=放弃（控制字节 / 超时 / 静默门不达 / 人键 abort）。
    public static func run(
        cwd: String,
        baselineMs: UInt64,
        lastOutput: @escaping @Sendable () -> UInt64,
        write: @escaping @Sendable (String) -> Void,
        humanInputArrived: @escaping @Sendable () -> Bool = { false },
        nowMs: @escaping @Sendable () -> UInt64 = { WaitClock.nowMs() },
        sleepMs: @escaping @Sendable (UInt64) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: ms * 1_000_000)
        }
    ) async -> Bool {
        guard let payload = buildInjectionIfSafe(cwd: cwd) else { return false }
        return await SilenceGateInjector.run(
            payload: payload, baselineMs: baselineMs, lastOutput: lastOutput, write: write,
            abortIf: humanInputArrived, nowMs: nowMs, sleepMs: sleepMs)
    }
}
