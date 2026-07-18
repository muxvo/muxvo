// GitStatusCache：终端 tile 门控字段 isGitRepo / worktreeRegistered 的填充（plan-native §4）。
//
// 结构：@MainActor 缓存 + 后台串行探针队列。
//   · mapSnapshot 恒同步零阻塞：lookup 是 O(1) 字典读——条目存在 → 填既有两字段（过期则同时登记探针
//     后台刷新）；真 miss → 填 nil 并**登记探针**（in-flight 去重）。
//   · 探针在后台队列跑（isGitRepo = 纯 fs 上溯找 .git，无子进程；worktreeRegistered = 仅 linked
//     worktree 跑 `git worktree list` realpath 比对）→ hop main 写缓存 → **值变才**触发 onChange 重推
//     （无变不推，防 push 风暴）。探针失败不清既有 registered 值（网络卷抖动不闪按钮）。
//   · TTL 30s stale-while-revalidate（dogfood-r3 问题6）：过期回**旧值**+后台重探——旧「过期回 nil」
//     语义下任一无关推送落在过期窗即闪灭按钮，且探针回填值没变不重推、无人纠正（时隐时现根因）。
//     TTL 仍覆盖 cwd 没变但 git init / worktree remove 了（值真变 → onChange 重推）。
//
// 纯逻辑（上溯解析 / gitdir 文件解析 / porcelain 路径提取 / 值变判定）做 static 纯函数，直测。
import Foundation
import MuxvoKit

@MainActor
public final class GitStatusCache {
    /// 单 cwd 的 git 状态缓存条目。
    struct Status: Equatable {
        var isRepo: Bool
        var repoRoot: String?
        var isLinkedWorktree: Bool
        var worktreeRegistered: Bool?
        var checkedAtMs: Int64
    }

    /// 探针结果（后台 → main，Sendable）。registered 用三态区分「不适用/已知/探测失败」。
    struct ProbeResult: Sendable, Equatable {
        var isRepo: Bool
        var repoRoot: String?
        var isLinkedWorktree: Bool
        var registered: RegisteredProbe
    }

    enum RegisteredProbe: Sendable, Equatable {
        case notApplicable   // 主仓 / 非 git → nil
        case determined(Bool) // 已注册 / 孤儿
        case probeFailed      // git 调用失败/超时 → 保留既有值
    }

    private var cache: [String: Status] = [:]
    private var inFlight: Set<String> = []
    private let ttlMs: Int64
    private let nowMs: () -> Int64
    private let git: GitCLI
    /// 后台串行探针队列（探针天然低频；串行防同 repo 并发 git）。
    private let probeQueue = DispatchQueue(label: "muxvo.gitstatus.probe", qos: .utility)

    /// 值变回调（TerminalService 接 deliver 重推）。仅语义字段（isRepo/worktreeRegistered）变化才触发。
    public var onChange: (() -> Void)?

    public init(
        git: GitCLI = GitCLI(),
        ttlMs: Int64 = 30_000,
        nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.git = git
        self.ttlMs = ttlMs
        self.nowMs = nowMs
    }

    // MARK: - 同步查（mapSnapshot 每 push 调）

    /// stale-while-revalidate（dogfood-r3 问题6）：条目存在 → 恒返回既有值（过期则同时登记后台探针，
    /// 值真变经 applyProbeResult 的 onChange 重推）——**绝不因过期回 (nil,nil)** 闪灭按钮/徽标。
    /// 真 miss（新 cwd / invalidate 后）→ (nil, nil) 并登记探针（冷启动探针点亮 ≤5s 口径不变）。
    public func lookup(cwd: String) -> (isGitRepo: Bool?, worktreeRegistered: Bool?) {
        if let s = cache[cwd] {
            if nowMs() - s.checkedAtMs >= ttlMs { enqueueProbe(cwd: cwd) }
            return (s.isRepo, s.worktreeRegistered)
        }
        enqueueProbe(cwd: cwd)
        return (nil, nil)
    }

    /// 测试用：当前在飞探针集合（断言「过期 lookup 已登记后台刷新」）。
    var inFlightForTesting: Set<String> { inFlight }

    /// worktree 变更后主动失效 repo 前缀的全部缓存项并即刻重探（自家操作立即反映徽标/按钮，§4.2③）。
    public func invalidate(prefix: String) {
        let affected = cache.keys.filter { $0 == prefix || $0.hasPrefix(prefix + "/") }
        for k in affected { cache.removeValue(forKey: k) }
        for k in affected { enqueueProbe(cwd: k) }
    }

    // MARK: - 探针登记 / 回填

    private func enqueueProbe(cwd: String) {
        guard !inFlight.contains(cwd) else { return } // in-flight 去重
        inFlight.insert(cwd)
        let git = self.git
        probeQueue.async { [weak self] in
            let result = Self.probe(cwd: cwd, git: git)
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.applyProbeResult(cwd: cwd, result: result) }
            }
        }
    }

    /// 探针回填（main）：写缓存 + 值变才 onChange。probeFailed → 保留既有 registered。
    private func applyProbeResult(cwd: String, result: ProbeResult) {
        inFlight.remove(cwd)
        let old = cache[cwd]
        let registered: Bool?
        switch result.registered {
        case .notApplicable: registered = nil
        case .determined(let b): registered = b
        case .probeFailed: registered = old?.worktreeRegistered // 保留既有值
        }
        let new = Status(
            isRepo: result.isRepo, repoRoot: result.repoRoot,
            isLinkedWorktree: result.isLinkedWorktree,
            worktreeRegistered: registered, checkedAtMs: nowMs())
        cache[cwd] = new
        if Self.statusChanged(old: old, new: new) { onChange?() }
    }

    /// 测试用：同步驱动一次探针（跳过后台队列，确定性验完整 probe→apply→onChange 链）。
    func probeNowForTesting(cwd: String) {
        applyProbeResult(cwd: cwd, result: Self.probe(cwd: cwd, git: git))
    }

    /// 测试用：直接以给定 ProbeResult 驱动回填（确定性验 probeFailed 保留既有值 / 值不变不推的守卫，
    /// 免造真 git 失败态）。
    func applyProbeForTesting(cwd: String, result: ProbeResult) {
        applyProbeResult(cwd: cwd, result: result)
    }

    /// 测试用：直填缓存（验 mapSnapshot 取值 / TTL 判定，跳过异步探针）。
    func primeForTesting(cwd: String, isRepo: Bool, worktreeRegistered: Bool?, at ms: Int64? = nil) {
        cache[cwd] = Status(
            isRepo: isRepo, repoRoot: nil,
            isLinkedWorktree: worktreeRegistered != nil,
            worktreeRegistered: worktreeRegistered, checkedAtMs: ms ?? nowMs())
    }

    // MARK: - 纯逻辑（static，直测）

    /// 值变判定：语义字段（isRepo / worktreeRegistered）不同才 true（checkedAtMs 不参与，防 TTL 刷新误推）。
    nonisolated static func statusChanged(old: Status?, new: Status) -> Bool {
        old?.isRepo != new.isRepo || old?.worktreeRegistered != new.worktreeRegistered
    }

    /// 探针核（后台，nonisolated：从后台探针队列调用，不在 MainActor 上下文）：
    /// fs 上溯定 repo/linked，linked 才跑 git 判 registered。
    nonisolated static func probe(cwd: String, git: GitCLI) -> ProbeResult {
        guard let walk = walkUpForGit(cwd: cwd) else {
            return ProbeResult(isRepo: false, repoRoot: nil, isLinkedWorktree: false, registered: .notApplicable)
        }
        guard walk.isLinkedWorktree else {
            return ProbeResult(isRepo: true, repoRoot: walk.repoRoot, isLinkedWorktree: false, registered: .notApplicable)
        }
        let out = git.gitSync(["-C", walk.repoRoot, "worktree", "list", "--porcelain", "-z"], timeout: 5)
        guard out.code == 0, !out.timedOut else {
            return ProbeResult(isRepo: true, repoRoot: walk.repoRoot, isLinkedWorktree: true, registered: .probeFailed)
        }
        // 比对用 worktree 根（walkUpForGit 找到 .git 文件那层），非原始 cwd——cwd 在 worktree 子目录
        // （如 wt-1/src）时精确比对必失配、误判孤儿（对抗验收 MAJOR-1；徽标/popover current 均含子目录口径）。
        let registered = isRegistered(cwd: walk.worktreeRoot ?? cwd, worktreePaths: parseWorktreePaths(out.stdout))
        return ProbeResult(isRepo: true, repoRoot: walk.repoRoot, isLinkedWorktree: true, registered: .determined(registered))
    }

    struct WalkResult: Equatable {
        let repoRoot: String
        let isLinkedWorktree: Bool
        /// linked worktree 的根目录（找到 `.git` 文件那层）；主仓 nil。registered 比对必须用它
        /// 而非原始 cwd（子目录口径，MAJOR-1）。
        var worktreeRoot: String? = nil
    }

    /// 纯 fs 上溯找 `.git`：目录=主仓 / 文件=linked worktree（读 gitdir: 行解析主仓）。无则 nil（非 git）。
    nonisolated static func walkUpForGit(cwd: String) -> WalkResult? {
        let fm = FileManager.default
        var dir = URL(fileURLWithPath: cwd, isDirectory: true).standardizedFileURL
        while true {
            let gitPath = dir.appendingPathComponent(".git")
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: gitPath.path, isDirectory: &isDir) {
                if isDir.boolValue {
                    return WalkResult(repoRoot: dir.path, isLinkedWorktree: false)
                }
                let contents = (try? String(contentsOf: gitPath, encoding: .utf8)) ?? ""
                if let mainRepo = parseGitdirFile(contents) {
                    return WalkResult(repoRoot: mainRepo, isLinkedWorktree: true, worktreeRoot: dir.path)
                }
                // .git 文件但解析不出主仓 → 退化当主仓自身，registered 不适用（按钮短暂多显示，可接受）。
                return WalkResult(repoRoot: dir.path, isLinkedWorktree: false)
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { return nil } // 到文件系统根
            dir = parent
        }
    }

    /// linked worktree 的 `.git` 文件内容 → 主仓工作树路径。
    /// 内容形如 `gitdir: <mainrepo>/.git/worktrees/<name>` → 取 `/.git/worktrees/` 前一段。
    nonisolated static func parseGitdirFile(_ contents: String) -> String? {
        guard let line = contents.split(separator: "\n").map(String.init)
            .first(where: { $0.hasPrefix("gitdir:") }) else { return nil }
        let gitdir = line.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
        guard let range = gitdir.range(of: "/.git/worktrees/") else { return nil }
        return String(gitdir[gitdir.startIndex..<range.lowerBound])
    }

    /// `worktree list --porcelain -z` → 全部 `worktree <path>` 值。
    nonisolated static func parseWorktreePaths(_ output: String) -> [String] {
        var paths: [String] = []
        for token in output.split(separator: "\0", omittingEmptySubsequences: true) {
            let s = String(token)
            if s.hasPrefix("worktree ") { paths.append(String(s.dropFirst("worktree ".count))) }
        }
        return paths
    }

    /// cwd 是否在 worktree 注册列表内（realpath 归一比对）；不在 = 孤儿 → false。
    nonisolated static func isRegistered(cwd: String, worktreePaths: [String]) -> Bool {
        let canonCwd = InteractiveWorktreeService.canonical(cwd)
        return worktreePaths.contains { InteractiveWorktreeService.canonical($0) == canonCwd }
    }
}
