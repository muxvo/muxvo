// 终端会话恢复支撑件（terminal-session-restore.md §3/§4）：并发闸 / 本地取证 / 系统横幅 /
// 人键 abort 标志 / ownership 解析盒。恢复协调（join→闸→注入）在 TerminalService 装配层驱动。
import AppKit
import Foundation
import MuxvoTerm
import UserNotifications

// MARK: - MAJ-3 并发闸

/// 跨子系统重启恢复并发闸（MAJ-3）：在飞 resume ≤ limit（超出排队串行放行）——避免重启瞬间 N 个
/// `claude --resume` 同起把机器打满（CPU/内存/凭据握手风暴）。actor 语义保 inFlight 计数无竞争。
public actor InjectionThrottle {
    private let limit: Int
    private var inFlight = 0
    private var peak = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    public init(limit: Int) { self.limit = max(1, limit) }

    /// 在闸内跑一段异步注入。slot 满则挂起，前者释放时**转交** slot（inFlight 不瞬降，防 actor 重入超发）。
    public func run<T: Sendable>(_ op: @Sendable () async -> T) async -> T {
        await acquire()
        let result = await op()
        release()
        return result
    }

    public var peakConcurrency: Int { peak }

    private func acquire() async {
        if inFlight < limit {
            inFlight += 1
            peak = max(peak, inFlight)
            return
        }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in waiters.append(c) }
        // 被 release 转交 slot 唤醒（inFlight 未变，无需再加）。
    }

    private func release() {
        if !waiters.isEmpty {
            waiters.removeFirst().resume() // slot 转交（inFlight 保持）
        } else {
            inFlight -= 1
        }
    }
}

// MARK: - 本地日志追加（0600，追加式，线程安全）

/// 恢复面本地日志追加原语（m-1 回修：**0600**——取证/横幅日志含 sessionId/cwd 等 resume 定位物，与
/// SEC-M2 保护同源，仅属主可读写）。open(O_CREAT,0o600)+O_APPEND+fchmod 强制权限（含对既有文件），
/// best-effort（失败不阻塞注入/横幅）。
enum RestoreLogFile {
    private static let lock = NSLock()

    static func append(url: URL, line: String) {
        let text = line.hasSuffix("\n") ? line : line + "\n"
        guard let data = text.data(using: .utf8) else { return }
        lock.withLock {
            // 父目录兜底建（logs/ 通常 bootstrap 已预建；此保「取证不因缺目录静默丢」，对抗验收 m-1 关注点）。
            try? FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let fd = open(url.path, O_WRONLY | O_CREAT | O_APPEND, 0o600)
            guard fd >= 0 else { return }
            defer { close(fd) }
            _ = fchmod(fd, 0o600) // 强制 0600（含对既有 0644 旧文件收紧）
            _ = data.withUnsafeBytes { buf in write(fd, buf.baseAddress, data.count) }
        }
    }
}

// MARK: - SEC-m1 本地取证

/// 恢复注入取证（SEC-m1）：恢复自动执行 `claude --resume` 属「app 代人自动跑命令」，须留本地取证——
/// 记 {termId, sessionId, cwd, ts, resumeAttempts} 到本地恢复日志（非 audit_log 编排面；恢复是终端
/// 行为非任务事件），供「重启后自动跑了什么」可追溯。追加式、0600（m-1 回修）、best-effort。
public enum SessionRestoreAudit {
    public static func record(
        url: URL, termId: String, sessionId: String, cwd: String, tsMs: UInt64, resumeAttempts: Int,
        harness: String = "cc"
    ) {
        // 内容盲：sessionId/cwd 是定位物、非会话内容（核心原则二边界）。cwd JSON 转义防注入日志破坏。
        // harness（cc/codex）：取证可判「重启后自动跑了哪个 CLI」（§1.5）。
        let line = "{\"termId\":\(json(termId)),\"sessionId\":\(json(sessionId)),"
            + "\"cwd\":\(json(cwd)),\"ts\":\(tsMs),\"resumeAttempts\":\(resumeAttempts),"
            + "\"harness\":\(json(harness))}"
        RestoreLogFile.append(url: url, line: line) // 0600
    }

    /// 最小 JSON 字符串转义（引号/反斜杠/控制字节），防 cwd 破坏取证行结构。
    private static func json(_ s: String) -> String {
        var out = "\""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if ch.value < 0x20 { out += String(format: "\\u%04x", ch.value) } else { out.unicodeScalars.append(ch) }
            }
        }
        out += "\""
        return out
    }
}

// MARK: - §4 系统横幅（零 wire 路径）

/// 会话恢复横幅（§4：多设备/预检失败 =「无法在本机恢复」；熔断 =「反复崩溃已暂停自动恢复」）。
///
/// **M-4 回修（§4「不静默」硬承诺）**：横幅事件**无条件**先落 durable 本地日志（`emit`，授权状态无关）——
/// 即便系统通知授权被拒/无 entitlement，也**绝不静默丢**，留痕可追。系统通知（UNUserNotificationCenter）
/// 仅作**尽力而为叠加**（真 .app 守卫 + 主队列，同 OrchNotifier R2 硬约束；swift run/裸可执行等非 .app 进程 →
/// 跳过、不崩，谓词见 RealAppBundleGuard 头注）。**残余**：web **顶部**横幅形态须新增 wire 字段（协议 v13 消息数锁死）→ 归批末合并窗口裁；v1 以
/// 系统通知 + durable 日志等价交付「聚合计数 + 不静默」。
@MainActor
public final class SessionRestoreBanner {
    /// internal（非 private）：供装配锚测试断言「生产构造守卫值 = 共用谓词」（装配断点防线）。
    let hasBundle: Bool
    private let emit: @Sendable (String) -> Void
    private var authorizationRequested = false

    /// 生产构造：durable 日志落 `logURL`（缺省仅 NSLog）。守卫 = 真 .app 谓词（RealAppBundleGuard）。
    public convenience init(logURL: URL? = nil) {
        self.init(hasBundle: RealAppBundleGuard.isCurrentProcessRealApp, emit: Self.defaultEmit(logURL: logURL))
    }

    /// 测试构造（守卫值 + emit 汇直注）：验「授权不可用（hasBundle=false）仍 durable 留痕、不静默」（M-4）。
    init(hasBundle: Bool, emit: @escaping @Sendable (String) -> Void) {
        self.hasBundle = hasBundle
        self.emit = emit
    }

    /// 文案（纯串，可测；nonisolated 供非主线程/测试直调）。
    public nonisolated static func cannotRestoreBody(count: Int) -> String { "\(count) 个会话无法在本机恢复" }
    public nonisolated static func crashLoopBody(count: Int) -> String { "\(count) 个会话反复崩溃，已暂停自动恢复，可手动重开" }
    /// 指挥台重启降级文案（command-console.md §1 / M4b 台账「重启后 console 无工具残余」）：restore 把指挥台
    /// 终端当普通会话恢复（无 `--mcp-config`）→ 指挥四工具在恢复出的 claude 侧不存在（fail-closed 行为正确、
    /// 本批不改），仅告知用户其已降级为普通终端 + 出路（菜单「文件 → 新建指挥台」⌘⇧N 重开）。
    public nonisolated static func consoleDegradedBody(count: Int) -> String {
        "\(count) 个指挥台已恢复为普通终端（指挥工具不可用），请从「文件 → 新建指挥台」（⌘⇧N）重开"
    }

    public func cannotRestore(count: Int) {
        guard count > 0 else { return }
        let body = Self.cannotRestoreBody(count: count)
        emit("[restore-banner] cannotRestore count=\(count) \(body)") // 不静默：先 durable 留痕（授权状态无关）
        present(title: "会话恢复", body: body, identifier: "restore.cannot")
    }

    public func crashLoopPaused(count: Int) {
        guard count > 0 else { return }
        let body = Self.crashLoopBody(count: count)
        emit("[restore-banner] crashLoopPaused count=\(count) \(body)")
        present(title: "会话恢复", body: body, identifier: "restore.crashloop")
    }

    /// 指挥台重启降级提示（M4b 台账「重启后 console 无工具残余」清账）：N 个指挥台被 restore 当普通会话
    /// 恢复、指挥四工具不复存在——emit durable 无条件留痕（授权状态无关，同 cannotRestore/crashLoop 口径）+
    /// 系统通知尽力而为（真 .app 守卫）。count==0 短路（无指挥台恢复不打扰）。
    public func consoleDegraded(count: Int) {
        guard count > 0 else { return }
        let body = Self.consoleDegradedBody(count: count)
        emit("[restore-banner] consoleDegraded count=\(count) \(body)") // 不静默：先 durable 留痕
        present(title: "指挥台恢复", body: body, identifier: "restore.console")
    }

    /// 尽力而为系统通知（授权被拒/无 entitlement → 静默降级；但事件已由 emit durable 留痕，不违「不静默」）。
    private func present(title: String, body: String, identifier: String) {
        guard hasBundle else { return } // 非真 .app（swift run/裸可执行）不碰 UNUserNotificationCenter（R2 硬约束防线）
        let center = UNUserNotificationCenter.current()
        // ⚠️ UN 完成回调在系统私有队列执行——闭包必须显式 @Sendable 阻断 MainActor 隔离继承
        //（同 OrchNotifier.postSystemBanner 07-07 崩溃单，此处同款隐患一并修）。
        if !authorizationRequested {
            authorizationRequested = true
            center.requestAuthorization(options: [.alert, .sound]) { @Sendable _, _ in }
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil)) { @Sendable _ in }
    }

    nonisolated static func defaultEmit(logURL: URL?) -> @Sendable (String) -> Void {
        { msg in
            NSLog("%@", msg)
            if let logURL { RestoreLogFile.append(url: logURL, line: msg) }
        }
    }
}

// MARK: - 前台探针快照盒（§1.5 Codex 采集：WaitDetectorHub 静默门控与 codexTracker 共享一次 pgrep/ps）

/// 每 tick 前台探针快照（pollWaitDetector 建、WaitDetectorHub foregroundProbe 闭包按 shellPid 读）。
/// 线程安全：主 tick 写、hubQueue 读。WaitDetectorHub 现行为完全保持——`isNonShell` 对无该 pid/idle/
/// unknown 皆回 false（同旧 `isNonShellForeground` 语义），仅 running(非 shell) 回 true。
final class ForegroundSnapshotBox: @unchecked Sendable {
    private let lock = NSLock()
    private var snap: [Int32: ForegroundProbe.ForegroundState] = [:]
    func set(_ s: [Int32: ForegroundProbe.ForegroundState]) { lock.withLock { snap = s } }
    func isNonShell(_ shellPid: Int32) -> Bool {
        lock.withLock {
            if case let .running(name, _) = snap[shellPid] { return ForegroundProbe.isNonShellName(name) }
            return false
        }
    }
}

// MARK: - 人键 abort 标志 + ownership 解析盒（装配层用）

/// 恢复注入期真人键 abort 标志（§3 feas M-9）：onUserWrite 排除自应答后置位；注入器 humanInputArrived 读。
public final class RestoreHumanInputFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var typed = false
    public init() {}
    public func set() { lock.withLock { typed = true } }
    public var value: Bool { lock.withLock { typed } }
}

/// 注入落地观测（登记⑩尺寸就绪门取证）：resume/恢复注入写 payload 成功那一刻的会话网格与就绪态。
/// sizeReady=false = 超时兜底注入（终端洞不可见，仍按 spawn 80×24 烧——现状行为，判层用）。
public struct ResumeInjectionObservation: Sendable {
    public let termId: String
    public let cols: UInt16
    public let rows: UInt16
    public let sizeReady: Bool
    public init(termId: String, cols: UInt16, rows: UInt16, sizeReady: Bool) {
        self.termId = termId
        self.cols = cols
        self.rows = rows
        self.sizeReady = sizeReady
    }
}

/// 登记⑩观测锁盒：注入 Task.detached 内写、测试主线程读（e2e/单测装配级断言面——防「单测注入 fake
/// 全绿但生产组合根未接线」的装配断点模式）；生产路径零读。
public final class ResumeInjectionObservationBox: @unchecked Sendable {
    private let lock = NSLock()
    private var last: ResumeInjectionObservation?
    public init() {}
    public func write(_ v: ResumeInjectionObservation) { lock.withLock { last = v } }
    public var value: ResumeInjectionObservation? { lock.withLock { last } }
}

/// ownership 解析盒（§1 found B-2 + B2-0）：SessionTracker 采集前查——takeover / 交互式 worker 终端排除（只采 human）。
/// 迟绑定（takeoverManager / InteractiveWorkerHost 均在 orch 装配后才存在），故用可设闭包盒。brain 排除位留接缝（B4 接线）。
public final class TakeoverOwnershipBox: @unchecked Sendable {
    private let lock = NSLock()
    private var isTakeover: (@Sendable (String) -> Bool)?
    private var isWorker: (@Sendable (String) -> Bool)?
    public init() {}
    public func setTakeoverCheck(_ f: @escaping @Sendable (String) -> Bool) {
        lock.withLock { isTakeover = f }
    }

    /// B2-0：交互式 PTY worker 归属判据（InteractiveWorkerHost 绑定表接实数据源）。设后 worker termId
    /// 被 SessionTracker 排除出会话恢复采集——防交互式 worker 会话与调度器 §6 崩溃续跑双恢复。
    public func setWorkerCheck(_ f: @escaping @Sendable (String) -> Bool) {
        lock.withLock { isWorker = f }
    }

    /// 查 ownership（解析序 takeover→worker→human，found B-2 + B2-0）：先判 takeover（接管终端，§4.7 自恢复），
    /// 再判 worker（交互式 worker，调度器 §6 自恢复），皆不中 → human（默认，向后兼容纯人终端；brain B4 接线）。
    /// 未设对应判据的分类恒回退 human（向后兼容：worker 判据未接前 worker termId 仍 .human）。
    public func ownership(of termId: String) -> TerminalOwnership {
        let (tk, wk) = lock.withLock { (isTakeover, isWorker) }
        if tk?(termId) ?? false { return .takeover }
        if wk?(termId) ?? false { return .worker }
        return .human
    }
}

// MARK: - chatResume 归档回填闸（M5-R1 批2）

/// chatResume 归档回填闸裁决（`enqueueChatResumeInjection` 仅 `.claude` harness 注入前问）：
///  - `.proceed` → 照常注入 `claude --resume <sid>`（归档已回填/无需回填）。
///  - `.block(code)` → 跳过注入（终端保持纯 shell）+ 经 `onChatResumeFeedback` 回调 `code`（native NSAlert 提示）。
/// 闸本体（判定 sessionId 是否可 resume——归档回填状态）由 agent B 实现、装配注入归 agent D；
/// `.codex` harness 无归档回填、不过此闸（恒注入）。
public enum ChatResumeGateVerdict: Sendable, Equatable {
    case proceed
    case block(code: String)
}

// MARK: - R2.5 首绑补写钩子盒（late-binding）

/// 首绑补写钩子盒（R2.5，late-binding 同 `TakeoverOwnershipBox` 手法）：`SessionTracker.record` 闭包在
/// tracker 后台队列检出「终端首次绑定 / 更换 sessionId」后调 `fire`；真实现（hop main 读 projection.customName
/// + 补写 titlesStore）在 `TerminalService` init 末（self 全初始化后）经 `setHandler` 注入。
/// 盒使 record 闭包无需捕 @MainActor self（装配 record 时 self 尚未就绪）。缺省 no-op。
public final class ChatTitleBackfillHook: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (@Sendable (_ termId: String, _ sessionId: String) -> Void)?
    public init() {}
    public func setHandler(_ f: @escaping @Sendable (_ termId: String, _ sessionId: String) -> Void) {
        lock.withLock { handler = f }
    }
    public func fire(termId: String, sessionId: String) {
        let f = lock.withLock { handler }
        f?(termId, sessionId)
    }
}
