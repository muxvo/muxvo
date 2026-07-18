// Chat 源 FSEvents 监视器（M5 批3，§7.2 session-append + §6.1 增量镜像触发）。监 CC 源 `~/.claude/projects`
// + Codex 源 `~/.codex`（流订根目录、分类层过滤——`isCodex` 只认 `sessions/**` + `.codex-global-state.json`
// 读者可观察面，家务写不触发；见 isCodex 注），per-key 500ms trailing 去抖后回调：CC 变化 →
// [ChatSourceChange]{projectHash, sessionId}（定向 chatSessionUpdate + 增量镜像），Codex 变化 →
// codexChanged 布尔（触发 memo reprime）。
//
// 去抖粒度（§6.1，仿 legacy chat-watcher.ts）：**per-key**——每 (projectHash, sessionId) / Codex 各持独立
// 定时器，key 再变则重置该 key 定时器，静默 500ms 后仅 flush 该 key（一次 onChange 携单 key）。活跃会话连续
// 追加时该 key trailing 到写停才 flush（与 legacy 一致），彼此互不牵连。
//
// 可测性：路径分类（ccChange/isCodex）为纯静态函数，去抖核心（ingest/flushCC/flushCodex）与真 FSEvent 解耦
// （仿 ResourceWatcher）——测试直驱 ingest + flushCC/flushCodex 确定性验（幂等，绕真 timer），不起真 FS。
import Foundation

/// CC 源单会话变化信号（§7.2 裸信号，不携内容——UI 据此重取 messages 尾部）。
public struct ChatSourceChange: Sendable, Hashable {
    public let projectHash: String
    public let sessionId: String
    public init(projectHash: String, sessionId: String) {
        self.projectHash = projectHash
        self.sessionId = sessionId
    }
}

/// @unchecked Sendable：去抖态收敛到单串行 queue 访问，仿 ResourceWatcher。
public final class ChatSourceWatcher: @unchecked Sendable {
    /// 去抖合并后回调：(CC 会话变化集, Codex 是否变化)。@Sendable：后台 queue 触发；装配层闭包 hop main。
    public typealias OnChange = @Sendable ([ChatSourceChange], Bool) -> Void

    private let ccProjectsRoot: URL
    private let codexRoot: URL?
    private let debounce: DispatchTimeInterval
    private let onChange: OnChange
    private let queue = DispatchQueue(label: "com.muxvo.chat.watcher")

    // per-key trailing 去抖态（queue 串行访问）。pending* = 待 flush 的 key；*Timer = 该 key 当前 trailing 定时器。
    private var pendingCC: Set<ChatSourceChange> = []
    private var ccTimers: [ChatSourceChange: DispatchWorkItem] = [:]
    private var pendingCodex = false
    private var codexTimer: DispatchWorkItem?

    private var stream: FSEventStreamRef?

    public init(
        ccProjectsRoot: URL, codexRoot: URL?,
        debounceMs: Int = 500,  // §6.1 增量触发链 500ms 去抖
        onChange: @escaping OnChange
    ) {
        self.ccProjectsRoot = ccProjectsRoot
        self.codexRoot = codexRoot
        self.debounce = .milliseconds(debounceMs)
        self.onChange = onChange
    }

    // MARK: - 生产：FSEventStream 生命周期（best-effort；起流失败静默降级）

    public func start() {
        guard stream == nil else { return }
        var paths = [ccProjectsRoot.path]
        if let codexRoot { paths.append(codexRoot.path) }
        let info = Unmanaged.passRetained(self).toOpaque()
        var context = FSEventStreamContext(
            version: 0, info: info, retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, clientInfo, count, eventPaths, _, _ in
            guard let clientInfo else { return }
            let watcher = Unmanaged<ChatSourceWatcher>.fromOpaque(clientInfo).takeUnretainedValue()
            // eventPaths 只有带 UseCFTypes flag 才是 CFArray<CFString>（toll-free 桥 NSArray）；
            // 不带时是裸 char**，此 cast 首个真实事件即野指针 SIGSEGV（harness 2026-07-07-063347.ips）。
            guard let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] else { return }
            _ = count
            watcher.queue.async { watcher.ingest(paths: paths) }
        }
        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault, callback, &context,
            paths as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3,
            FSEventStreamCreateFlags(
                kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer
                    | kFSEventStreamCreateFlagUseCFTypes))
        else {
            Unmanaged<ChatSourceWatcher>.fromOpaque(info).release()
            return
        }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
    }

    public func stop() {
        // 取消所有 pending trailing 定时器（防面板关闭后仍 flush 推事件）。
        for t in ccTimers.values { t.cancel() }
        ccTimers.removeAll(); pendingCC.removeAll()
        codexTimer?.cancel(); codexTimer = nil; pendingCodex = false
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    deinit { stop() }

    // MARK: - per-key 去抖核心（测试直驱）

    /// 喂入一批变化路径：分类 + 逐 key 重置各自 trailing 定时器（§6.1 per-key 500ms）。
    func ingest(paths: [String]) {
        for path in paths {
            if let change = Self.ccChange(path: path, ccProjectsRoot: ccProjectsRoot) {
                pendingCC.insert(change)
                resetCCTimer(change)
            } else if let codexRoot, Self.isCodex(path: path, codexRoot: codexRoot) {
                pendingCodex = true
                resetCodexTimer()
            }
        }
    }

    /// 重置单 CC key 的 trailing 定时器：取消旧的、schedule 新的（500ms 静默后 flush 该 key）。
    private func resetCCTimer(_ change: ChatSourceChange) {
        ccTimers[change]?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.flushCC(change) }
        ccTimers[change] = item
        queue.asyncAfter(deadline: .now() + debounce, execute: item)
    }

    private func resetCodexTimer() {
        codexTimer?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.flushCodex() }
        codexTimer = item
        queue.asyncAfter(deadline: .now() + debounce, execute: item)
    }

    /// flush 单 CC key（trailing 到期）：清该 key 态后回调 `([change], false)`。幂等（已 flush → 无操作）——
    /// internal 供测试直调（绕真 timer）。
    func flushCC(_ change: ChatSourceChange) {
        guard pendingCC.remove(change) != nil else { return }
        ccTimers[change]?.cancel()
        ccTimers[change] = nil
        onChange([change], false)
    }

    /// flush Codex（trailing 到期）：回调 `([], true)` 触发 memo reprime。幂等。internal 供测试直调。
    func flushCodex() {
        guard pendingCodex else { return }
        pendingCodex = false
        codexTimer?.cancel(); codexTimer = nil
        onChange([], true)
    }

    // MARK: - 分类（纯静态，测试直验）

    /// CC 变化路径 → ChatSourceChange：`<ccProjectsRoot>/<projectHash>/<sessionId>.jsonl`（恰两层 + .jsonl）。
    /// 项目目录级变化/更深路径/非 jsonl → nil。
    static func ccChange(path: String, ccProjectsRoot: URL) -> ChatSourceChange? {
        let root = ccProjectsRoot.standardizedFileURL.path
        let full = URL(fileURLWithPath: path).standardizedFileURL.path
        guard full.hasPrefix(root + "/") else { return nil }
        let rel = String(full.dropFirst(root.count + 1))
        let parts = rel.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[1].hasSuffix(".jsonl") else { return nil }
        let sessionId = String(parts[1].dropLast(".jsonl".count))
        guard !sessionId.isEmpty else { return nil }
        return ChatSourceChange(projectHash: String(parts[0]), sessionId: sessionId)
    }

    /// Codex 变化 = 读者可观察面精确覆盖：`sessions/` 子树（含目录本身）+ `.codex-global-state.json`
    /// （标题表）恰好是 CodexSessionSource 消费的全部路径。**不可放宽回整棵 codexRoot 子树**：Codex 桌面版
    /// 持续往根目录写家务文件（sqlite WAL / models_cache / global-state.bak…），整树判 true 会令每次
    /// 家务写都触发全量 reprime——P0 CPU 风暴（264%）根因之一（2026-07-08 真机采样档取证）。
    /// 例外：**根路径本身判 true**——FileEvents 常态派发具体文件路径，根级路径只在 FSEvents 溢出/合并
    /// （kFSEventStreamEventFlagMustScanSubDirs 类）时出现 = 真 rescan 信号，丢弃会漏 reprime；
    /// reprime 经单飞+增量缓存后毫秒级，宁可多一次（对抗验收 MINOR-1）。
    static func isCodex(path: String, codexRoot: URL) -> Bool {
        let root = codexRoot.standardizedFileURL.path
        let full = URL(fileURLWithPath: path).standardizedFileURL.path
        if full == root { return true }
        let sessions = root + "/sessions"
        if full == sessions || full.hasPrefix(sessions + "/") { return true }
        return full == root + "/.codex-global-state.json"
    }
}
