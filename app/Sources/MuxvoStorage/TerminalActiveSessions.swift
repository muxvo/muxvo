// 终端会话恢复：锚点持久化 + 恢复闸纯逻辑 + 注入串构建（terminal-session-restore.md §2/§3/§4）。
//
// 为什么在 MuxvoStorage（同 PtyChildren 先例）：落盘要走本模块唯一入口 AtomicFile；且恢复层
// （MuxvoAppCore）与采集层（MuxvoTerm.SessionTracker）的公共可 import 底座是 MuxvoStorage/MuxvoKit。
// SessionTracker（MuxvoTerm，不依赖本模块）经**注入闭包** record/remove 写本 store（依赖倒置，
// 同 SessionRegistry→PtyChildrenStore）——本文件不反向依赖会话层。
//
// 三段：① 锚点模型 + 持久化 store（去抖/0600/durability .full/crash-loop 计数）；② 恢复闸纯逻辑
// （UUID 正则/容器校验/crash-loop 判据，纯函数单测）；③ 注入串构建（shell 转义 + 断选项 + 尾 CR）。
import Darwin
import Foundation

// MARK: - ① 锚点模型

/// harness 种类（§1）：.cc 采集自 CC hook（SessionTracker）；.codex 采集自前台探针 + rollout 匹配
/// （CodexAnchorTracker，P-2 fast-follow 2026-07-13 激活）。旧版二进制整体严格解码，读到 .codex 条目
/// 会整文件报废退化 M3（§2 降级损耗上界）；本版起读盘宽容逐条解码，为后续枚举扩展兜底。
public enum TerminalHarness: String, Codable, Sendable, Equatable {
    case cc
    case codex
}

/// 单终端会话锚点（§2 形状）。resumeAttempts/lastResumeTs = crash-loop 熔断计数（MAJ-2），缺省 0/nil。
public struct TerminalSessionAnchor: Codable, Equatable, Sendable {
    public let sessionId: String
    public let harness: TerminalHarness
    public let cwd: String
    public let transcriptPath: String
    public let lastActiveTs: UInt64
    public var resumeAttempts: Int
    public var lastResumeTs: UInt64?

    public init(
        sessionId: String, harness: TerminalHarness, cwd: String, transcriptPath: String,
        lastActiveTs: UInt64, resumeAttempts: Int = 0, lastResumeTs: UInt64? = nil
    ) {
        self.sessionId = sessionId
        self.harness = harness
        self.cwd = cwd
        self.transcriptPath = transcriptPath
        self.lastActiveTs = lastActiveTs
        self.resumeAttempts = resumeAttempts
        self.lastResumeTs = lastResumeTs
    }

    /// 计数字段缺席 → 缺省（旧文件/半写向后兼容）。
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        harness = try c.decode(TerminalHarness.self, forKey: .harness)
        cwd = try c.decode(String.self, forKey: .cwd)
        transcriptPath = try c.decode(String.self, forKey: .transcriptPath)
        lastActiveTs = try c.decode(UInt64.self, forKey: .lastActiveTs)
        resumeAttempts = try c.decodeIfPresent(Int.self, forKey: .resumeAttempts) ?? 0
        lastResumeTs = try c.decodeIfPresent(UInt64.self, forKey: .lastResumeTs)
    }
}

// MARK: - ① 持久化 store

/// terminal-active-sessions.json 存取（§2）：内存权威 map + 去抖落盘（AtomicFile .full、0600）。
/// 线程安全（锚点更新来自 bus 后台队列；落盘去抖由 flushIfDue 驱动——生产由心跳泵每 tick 调）。
///
/// 去抖语义（trailing）：clean→dirty 记 dirtySinceMs；flushIfDue 在 `nowMs-dirtySinceMs ≥ debounceMs`
/// 时落盘一次（合并窗内高频更新）。去抖窗内崩溃至多丢最近 ~debounce 锚点更新（§2 诚实边界）。
public final class TerminalActiveSessionsStore: @unchecked Sendable {
    private let fileURL: URL
    private let runDirectory: URL
    private let debounceMs: UInt64
    private let nowMs: @Sendable () -> UInt64

    private let lock = NSLock()
    private var anchors: [String: TerminalSessionAnchor] = [:]
    private var dirty = false
    private var dirtySinceMs: UInt64 = 0
    /// 实际落盘次数（测试观测去抖用）。
    public private(set) var diskWrites = 0

    public init(
        root: URL, debounceMs: UInt64 = 1000,
        nowMs: @escaping @Sendable () -> UInt64 = { UInt64((Date().timeIntervalSince1970 * 1000).rounded()) }
    ) {
        runDirectory = DataDirectory.runDirectoryURL(under: root)
        fileURL = DataDirectory.terminalActiveSessionsURL(under: root)
        self.debounceMs = debounceMs
        self.nowMs = nowMs
        anchors = Self.readFromDisk(fileURL)
    }

    // MARK: 采集面（SessionTracker 经注入闭包调）

    /// 锚点更新（§1「最近活跃会话」覆盖语义）：覆盖锚点字段，**保留** crash-loop 计数
    /// （resumeAttempts/lastResumeTs 仅恢复层动，见 seedRestored）。harness 按采集源传（CC hook=.cc、
    /// Codex 采集器=.codex）；同 termId 跨 harness 切换 = 最近活跃覆盖同一键（§1）。
    public func updateAnchor(
        termId: String, sessionId: String, cwd: String, transcriptPath: String, lastActiveTs: UInt64,
        harness: TerminalHarness = .cc
    ) {
        lock.withLock {
            let prev = anchors[termId]
            anchors[termId] = TerminalSessionAnchor(
                sessionId: sessionId, harness: harness, cwd: cwd, transcriptPath: transcriptPath,
                lastActiveTs: lastActiveTs,
                resumeAttempts: prev?.resumeAttempts ?? 0, lastResumeTs: prev?.lastResumeTs)
            markDirtyLocked()
        }
    }

    /// 清条目（§1：processExit / 用户关终端 / 终端移除）。无该键 no-op。
    public func clear(termId: String) {
        lock.withLock {
            guard anchors.removeValue(forKey: termId) != nil else { return }
            markDirtyLocked()
        }
    }

    /// 条件清除（§1 Codex 采集器「前台退出确认」清锚点专用，防跨 harness 竞态）：仅当该 termId 现有锚点
    /// 的 harness 与 sessionId 均匹配才移除——用户退 codex 秒起 claude 时 CC hook 可能已写入新 .cc 锚点，
    /// 无条件 clear 会误删。原子判定+移除（同锁）。
    public func clearIfMatches(termId: String, harness: TerminalHarness, sessionId: String) {
        lock.withLock {
            guard let a = anchors[termId], a.harness == harness, a.sessionId == sessionId else { return }
            anchors.removeValue(forKey: termId)
            markDirtyLocked()
        }
    }

    // MARK: 恢复面（SessionRestoreCoordinator 调）

    /// 恢复层整锚点写入（含 crash-loop 计数）：把旧键锚点连计数**结转**到新 termId（跨重启累加）。
    public func seedRestored(termId: String, anchor: TerminalSessionAnchor) {
        lock.withLock { anchors[termId] = anchor; markDirtyLocked() }
    }

    /// 只保留给定活体键（恢复后剪除已消失的旧 termId 锚点，防 join 后残留）。
    public func pruneKeepingOnly(_ termIds: Set<String>) {
        lock.withLock {
            let before = anchors.count
            anchors = anchors.filter { termIds.contains($0.key) }
            if anchors.count != before { markDirtyLocked() }
        }
    }

    /// 内存权威快照（恢复层读、观测用）。
    public func readAll() -> [String: TerminalSessionAnchor] {
        lock.withLock { anchors }
    }

    // MARK: 落盘

    /// 去抖落盘（生产由心跳泵每 tick 调）：dirty 且距 dirtySince ≥ debounce → 写。
    public func flushIfDue(nowMs: UInt64) {
        lock.withLock {
            guard dirty, nowMs &- dirtySinceMs >= debounceMs else { return }
            writeLocked()
        }
    }

    /// 强制落盘（退出/测试）：dirty 才写。
    public func flush() {
        lock.withLock { if dirty { writeLocked() } }
    }

    // MARK: 私有（须持 lock）

    private func markDirtyLocked() {
        if !dirty { dirty = true; dirtySinceMs = nowMs() }
    }

    private func writeLocked() {
        do {
            try FileManager.default.createDirectory(at: runDirectory, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(anchors)
            // durability .full：崩溃后须可读作恢复依据（同 pty-children）。AtomicFile tmp 建以 0o600
            // → rename 后终文件 0600（SEC-M2，仅属主可读写）。
            try AtomicFile.write(data, to: fileURL, durability: .full)
            diskWrites += 1
            dirty = false
        } catch {
            // 落盘失败不抛（恢复是尽力而为，锚点丢失至多退化 M3）；下 tick 再试（dirty 仍真）。
            FileHandle.standardError.write(Data("[muxvo] active-sessions 落盘失败：\(error)\n".utf8))
        }
    }

    /// 宽容逐条解码包装（§2 前向加固）：单条锚点坏（未知 harness/字段损坏）只丢该条，不整文件报废——
    /// 未来第三 harness 落盘后，本版仍能恢复其余锚点（旧版整体严格解码的对偶）。
    private struct FailableAnchor: Decodable {
        let value: TerminalSessionAnchor?
        init(from decoder: Decoder) throws { value = try? TerminalSessionAnchor(from: decoder) }
    }

    private static func readFromDisk(_ url: URL) -> [String: TerminalSessionAnchor] {
        guard let data = try? Data(contentsOf: url) else { return [:] }
        guard let raw = try? JSONDecoder().decode([String: FailableAnchor].self, from: data) else { return [:] }
        return raw.compactMapValues(\.value)
    }
}

// MARK: - ② 恢复闸纯逻辑

/// 恢复闸（§3 步4 + §4 安全）：各闸纯函数（可单测），任一不过 → 退化 M3（不注入）。
/// 常量集中此处（K/T/M；silenceMs 在注入器层 TakeoverInjectGate，二注入器共用底层原语）。
public enum TerminalRestoreGate {
    /// crash-loop 隔离阈值 K（MAJ-2）：注入后窗内累计崩溃达此次数 → 隔离该锚点。
    public static let crashLoopThresholdK = 3
    /// crash-loop 判据窗 T（毫秒，MAJ-2）：注入后此窗内崩溃计一次失败（存活过窗 → 清零）。
    public static let crashLoopWindowMs: UInt64 = 30_000
    /// 并发闸 M（MAJ-3）：重启瞬间在飞 resume 上限（超出串行放行，防 N 个 claude --resume 同起打满）。
    public static let resumeConcurrencyM = 2

    /// sessionId 严格 UUID 正则（SEC-M3）：`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
    /// （替代过宽 `^[0-9a-f-]+$`——旧式放行纯 `-`/前导 `-` 可被解析成选项）。CC sessionId 恒小写 hex。
    public static func isValidSessionId(_ s: String) -> Bool {
        let parts = s.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 5 else { return false }
        let lens = [8, 4, 4, 4, 12]
        for (part, len) in zip(parts, lens) {
            guard part.count == len else { return false }
            guard part.allSatisfy({ ($0 >= "0" && $0 <= "9") || ($0 >= "a" && $0 <= "f") }) else { return false }
        }
        return true
    }

    /// 三字段齐备合法（SEC-M2 复检，防落盘损坏/半写）：sessionId/transcriptPath/cwd 非空 + sessionId 合法。
    public static func anchorComplete(_ a: TerminalSessionAnchor) -> Bool {
        !a.sessionId.isEmpty && !a.cwd.isEmpty && !a.transcriptPath.isEmpty && isValidSessionId(a.sessionId)
    }

    /// cwd 含控制字节（M-1 回修）：单引号转义只杀 shell **语法元字符**，不覆盖 CR/LF/ESC/C0/DEL 等 **PTY 行编辑
    /// 控制字节**（cwd 源自 hook raw 不可信，§1）。兄弟注入器 TakeoverTextInjector 因写活体 TTY 危险而 normalize
    /// 剥控制字节；本恢复注入器改为**检出即退化 M3**（不注入变形串）——对齐「不把不可信控制字节写进 PTY」口径。
    /// 判据 = 任一 unicode scalar 落 C0（<0x20）或 DEL（0x7F）。
    public static func cwdHasControlBytes(_ cwd: String) -> Bool {
        cwd.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7f }
    }

    /// 路径分量边界内含（纯谓词）：path == container 或 path 以 container + "/" 前缀（不误配 -x 兄弟）。
    /// 两侧去尾斜杠归一。
    public static func isWithinContainer(path: String, container: String) -> Bool {
        let p = stripTrailingSlash(path)
        let c = stripTrailingSlash(container)
        guard !c.isEmpty else { return false }
        return p == c || p.hasPrefix(c + "/")
    }

    /// realpath(3) 规范化（解析 `..`/symlink）；文件不存在/损坏 → nil（realpath 失败）。
    /// 规范化后路径**仅供「文件存在」预检，绝不拼进注入命令**（§3）。
    public static func resolvedRealpath(_ path: String) -> String? {
        path.withCString { cpath -> String? in
            guard let resolved = realpath(cpath, nil) else { return nil }
            defer { free(resolved) }
            return String(cString: resolved)
        }
    }

    /// transcript 预检（§3 唯一「文件存在」硬闸 + SEC-M1）：realpath 规范化后必须**在本机存在**（realpath
    /// 成功即隐含存在）且**落在容器（~/.claude 或隔离 configDir）内**——防 `../`/symlink 逃逸把预检变成
    /// 任意路径存在性探测。缺文件 / 逃逸容器 → false（退化 M3）。
    public static func transcriptPrecheckPasses(rawPath: String, container: String) -> Bool {
        guard let resolved = resolvedRealpath(rawPath) else { return false } // 缺失/损坏
        guard let resolvedContainer = resolvedRealpath(container) else { return false } // 无容器 → 全跳
        return isWithinContainer(path: resolved, container: resolvedContainer)
    }

    /// crash-loop 判据（MAJ-2）：
    ///  - 无 lastResumeTs（从未 resume）或 存活过窗（now-lastResumeTs ≥ T）→ 视作成功续跑 → 清零、不隔离。
    ///  - 上次 resume 后窗内又崩（now-lastResumeTs < T）→ attempts++；达 K → 隔离。
    public struct CrashLoopVerdict: Equatable, Sendable {
        public let isolate: Bool
        public let newAttempts: Int
    }

    public static func crashLoopVerdict(
        resumeAttempts: Int, lastResumeTs: UInt64?, nowMs: UInt64, thresholdK: Int, windowMs: UInt64
    ) -> CrashLoopVerdict {
        guard let last = lastResumeTs, nowMs &- last < windowMs else {
            return CrashLoopVerdict(isolate: false, newAttempts: 0) // 首次或存活过窗 → 清零
        }
        let n = resumeAttempts + 1
        return CrashLoopVerdict(isolate: n >= thresholdK, newAttempts: n)
    }

    private static func stripTrailingSlash(_ s: String) -> String {
        var out = s
        while out.count > 1, out.hasSuffix("/") { out.removeLast() }
        return out
    }
}

// MARK: - ③ 注入串构建

/// 恢复注入命令构建（§3 注入路径，SEC-B1）。全 app 生成固定形 + 单引号转义 + 断选项，非用户自由文本。
public enum ResumeCommand {
    /// 单引号转义（SEC-B1）：整串裹单引号，内部 `'` → `'\''`（闭引号+转义单引号+开引号）。单引号内
    /// shell 不做任何展开 → 杀死 `$()`/`;`/`&&`/空格 等全部元字符注入面。
    public static func singleQuoteEscape(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// 恢复/续聊注入的 harness 种类（ResumeCommand 专用，**独立于** §1 auto-restore 的 `TerminalHarness`——
    /// 两枚举分立维持〔§7.7〕；auto-restore 经下方单向映射取注入形（P-2 fast-follow 后 CC/Codex 皆可），
    /// 用户主动「继续聊天」路径按 source 直传）。
    public enum Harness: Sendable, Equatable {
        case claude
        case codex

        /// TerminalHarness（§1 auto-restore 锚点枚举）→ 注入形单向映射（一处收拢，消散落 switch；不合并两枚举）。
        public init(_ h: TerminalHarness) {
            switch h {
            case .cc: self = .claude
            case .codex: self = .codex
            }
        }

        /// resume 子命令形（各 harness 实测形状，**均不带 `--`**）：
        ///  · claude → `claude --resume <sid>`：`--resume` 是 commander **可选值参数**，其后**绝不能加 `--`**
        ///    （`--` 是选项终止符，紧跟 `--resume` 会吞掉取值 → CC 打开交互「选择会话」列表、sid 掉成位置
        ///    参数 prompt；真机 + 老版实证。旧形 `--resume -- <sid>` 即此回归，2026-07-07 M5-R1 修正）。
        ///  · codex → `codex resume <sid>`：sid 是位置参数、无 `--`（`CodexAdapter.makeTakeoverArgv` 同形）。
        var resumeInvocation: String {
            switch self {
            case .claude: return "claude --resume"
            case .codex: return "codex resume"
            }
        }
    }

    /// 注入命令体（不含 CR），harness 化：`cd -- '<escaped cwd>' && <harness resume 形> <sessionId>`。
    /// `cd --` 的 `--` **保留**（cwd 可能前导 `-`，断选项无害）；resume 形本身**不带 `--`**——`claude --resume`
    /// 后加 `--` 会被 commander 选项终止符吞掉可选值 → 交互选择器 + sid 掉 prompt（M5-R1 修正的真机回归，
    /// 见 `Harness.resumeInvocation` 注）。调用方须先 `isValidSessionId` 校验 sessionId（本函数不再校验，注入面收窄）。
    public static func resumeCommandBody(cwd: String, sessionId: String, harness: Harness) -> String {
        "cd -- \(singleQuoteEscape(cwd)) && \(harness.resumeInvocation) \(sessionId)"
    }

    /// 无 harness 旧签名（既有调用零改）：转发 `.claude`。
    public static func resumeCommandBody(cwd: String, sessionId: String) -> String {
        resumeCommandBody(cwd: cwd, sessionId: sessionId, harness: .claude)
    }

    /// 完整注入串 = 命令体 + **尾部恰一个 CR**（P-1 已裁自动回车；案 A）。harness 化。
    public static func buildResumeInjection(cwd: String, sessionId: String, harness: Harness) -> String {
        resumeCommandBody(cwd: cwd, sessionId: sessionId, harness: harness) + "\r"
    }

    /// 无 harness 旧签名（既有调用零改）：转发 `.claude`。
    public static func buildResumeInjection(cwd: String, sessionId: String) -> String {
        buildResumeInjection(cwd: cwd, sessionId: sessionId, harness: .claude)
    }

    /// 安全构建（M-1 回修）：cwd 含控制字节 → 返回 nil（拒构建、退化 M3，绝不把变形串写进 PTY）；否则同
    /// `buildResumeInjection`。注入器与协调层均经此闸（协调层另在 planner 前置过滤，双闸纵深）。harness 化。
    public static func buildInjectionIfSafe(cwd: String, sessionId: String, harness: Harness) -> String? {
        guard !TerminalRestoreGate.cwdHasControlBytes(cwd) else { return nil }
        return buildResumeInjection(cwd: cwd, sessionId: sessionId, harness: harness)
    }

    /// 无 harness 旧签名（既有调用零改）：转发 `.claude`。
    public static func buildInjectionIfSafe(cwd: String, sessionId: String) -> String? {
        buildInjectionIfSafe(cwd: cwd, sessionId: sessionId, harness: .claude)
    }
}
