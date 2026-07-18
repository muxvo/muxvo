// InteractiveWorktreeService：终端分支按钮的 worktree 交互域（plan-native §5.4，承 legacy 行为说明书）。
//
// 与编排侧 WorktreeManager **不合并**（语义面几乎不相交：交互侧 = <repo>/.worktrees/wt-N + 自增号 +
// .gitignore 自维护 + merged 才可删；编排侧 = 外置目录 + task 分支 + 回退串行）。共享的只有 GitCLI 底座。
//
// 线程：@unchecked Sendable。**变更（create/remove）走专用串行 mutateQueue**——双击「+ New Worktree」
// 第二发排在第一发后拿到新 max+1，编号竞态从结构上消除；status 走 statusQueue（只读幂等）。sync 核内
// 用 GitCLI.gitSync 阻塞，借队列串行。.git 体积按 repo 缓存 5min（du 大仓不便宜、体积变化缓慢）。
import Foundation
import MuxvoBridge
import MuxvoKit
import MuxvoStorage

public final class InteractiveWorktreeService: @unchecked Sendable {
    private let git: GitCLI
    /// worktree 自定义名 store（worktree-popover.md §5；nil = 不 join，行为同引入前）。
    private let names: WorktreeNamesStore?
    private let nowMs: () -> Int64
    private let mutateQueue = DispatchQueue(label: "muxvo.worktree.mutate")
    private let statusQueue = DispatchQueue(label: "muxvo.worktree.status", qos: .utility)

    private let sizeCacheLock = NSLock()
    private var sizeCache: [String: (sizeMB: Int, atMs: Int64)] = [:]
    private static let sizeTTLms: Int64 = 5 * 60 * 1000
    /// .git 体积告警阈值（legacy 500MB）。
    static let warnThresholdMB = 500

    public init(
        git: GitCLI = GitCLI(),
        names: WorktreeNamesStore? = nil,
        nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.git = git
        self.names = names
        self.nowMs = nowMs
    }

    // MARK: - 对外 async（分派到队列跑 sync 核）

    public func status(cwd: String) async -> FsResponse {
        await withCheckedContinuation { (cont: CheckedContinuation<FsResponse, Never>) in
            statusQueue.async { cont.resume(returning: self.statusSync(cwd: cwd)) }
        }
    }

    public func create(repoPath: String) async -> FsResponse {
        await withCheckedContinuation { (cont: CheckedContinuation<FsResponse, Never>) in
            mutateQueue.async { cont.resume(returning: self.createSync(repoPath: repoPath)) }
        }
    }

    public func remove(worktreePath: String) async -> FsResponse {
        await withCheckedContinuation { (cont: CheckedContinuation<FsResponse, Never>) in
            mutateQueue.async { cont.resume(returning: self.removeSync(worktreePath: worktreePath)) }
        }
    }

    // MARK: - status

    /// detect+list+preCheck 合并为一发（web 状态机只剩 loading→数据|rejected 两态、同刻取值）。
    /// 非 git = 数据不是错误（isRepo:false）。
    func statusSync(cwd: String) -> FsResponse {
        let rp = git.gitSync(
            ["-C", cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
            timeout: 10)
        guard rp.code == 0 else {
            return .worktreeStatus(isRepo: false, repoPath: nil, warning: nil, worktrees: [])
        }
        let lines = rp.stdout.split(separator: "\n").map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        guard lines.count >= 2 else {
            return .worktreeStatus(isRepo: false, repoPath: nil, warning: nil, worktrees: [])
        }
        let repoPath = Self.mainRepoPath(fromCommonDir: lines[1])

        let listOut = git.gitSync(["-C", repoPath, "worktree", "list", "--porcelain", "-z"], timeout: 10)
        let parsed = Self.parseWorktreePorcelain(listOut.stdout, repoPath: repoPath)
        let mainBranch = parsed.first(where: { $0.isMain })?.branch ?? "main"
        let mergedOut = git.gitSync(["-C", repoPath, "branch", "--merged", mainBranch], timeout: 10)
        let mergedSet = Self.parseBranchList(mergedOut.stdout)

        let warning = gitSizeWarning(repoPath: repoPath)
        let entries = parsed.map { wt in
            WorktreeEntry(
                path: wt.path, branch: wt.branch, isMain: wt.isMain,
                isMerged: mergedSet.contains(wt.branch),
                // stale 标记（F-D2）：worktree 目录已被外部删除但 `git worktree list` 仍列出 → 灰化行提示。
                missing: !FileManager.default.fileExists(atPath: wt.path),
                // 自定义名 join（§5）：store 内部 canonicalKey 归一，主仓路径永不入表 → 主行天然 nil。
                customName: names?.get(wt.path))
        }
        return .worktreeStatus(isRepo: true, repoPath: repoPath, warning: warning, worktrees: entries)
    }

    // MARK: - create

    /// 拒嵌套 → .gitignore 幂等含 .worktrees/ → prune → 三源去重 max+1 → worktree add（30s 超时）。
    /// 成功回 worktreePath+branch+warning。后续开终端/命名全由 web 既有消息完成（不迁移/不关主终端，裁决①）。
    func createSync(repoPath: String) -> FsResponse {
        if repoPath.contains("/.worktrees/") {
            return .rejected(code: "NESTED_WORKTREE", message: "不能在 worktree 内再创建 worktree")
        }
        ensureGitignore(repoPath: repoPath)
        _ = git.gitSync(["-C", repoPath, "worktree", "prune"], timeout: 10)

        let n = nextWorktreeNumber(repoPath: repoPath)
        let branch = "wt-\(n)"
        let wtPath = URL(fileURLWithPath: repoPath, isDirectory: true)
            .appendingPathComponent(".worktrees", isDirectory: true)
            .appendingPathComponent(branch, isDirectory: true).path

        let add = git.gitSync(["-C", repoPath, "worktree", "add", "-b", branch, wtPath], timeout: 30)
        guard add.code == 0 else {
            if add.timedOut {
                // legacy 超时特化中文（结合手头 .git 体积告警拼句）。
                let msg: String
                if let warn = gitSizeWarning(repoPath: repoPath) {
                    msg = "创建超时 — .git 目录过大（\(warn.sizeMB) MB），请用 git filter-repo 清理历史中的大文件后重试"
                } else {
                    msg = "创建超时 — 仓库可能过大，请检查 .git 目录大小"
                }
                return .rejected(code: "TIMEOUT", message: msg)
            }
            return .rejected(
                code: "GIT_ERROR",
                message: add.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        // 编号复用防陈名（§5）：nextWorktreeNumber 是 max+1，删 wt-3 后可能重发同号同路径——新建即清旧映射。
        names?.remove(wtPath)
        return .worktreeCreated(
            worktreePath: wtPath, branch: branch, warning: gitSizeWarning(repoPath: repoPath))
    }

    /// .gitignore 幂等含 `.worktrees/`（无则建/追加，注意尾换行）。
    private func ensureGitignore(repoPath: String) {
        let url = URL(fileURLWithPath: repoPath, isDirectory: true)
            .appendingPathComponent(".gitignore")
        let entry = ".worktrees/"
        let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let hasEntry = existing
            .split(separator: "\n", omittingEmptySubsequences: false)
            .contains { $0.trimmingCharacters(in: .whitespaces) == entry }
        guard !hasEntry else { return }
        var content = existing
        if !content.isEmpty && !content.hasSuffix("\n") { content += "\n" }
        content += entry + "\n"
        try? content.write(to: url, atomically: true, encoding: .utf8)
    }

    /// 编号 = 三源去重 max+1：worktree list 分支名 + `branch --list wt-*` + 扫 `.worktrees/` 目录（含孤儿）。
    private func nextWorktreeNumber(repoPath: String) -> Int {
        var maxN = 0
        let listOut = git.gitSync(["-C", repoPath, "worktree", "list", "--porcelain", "-z"], timeout: 10)
        for wt in Self.parseWorktreePorcelain(listOut.stdout, repoPath: repoPath) {
            if let n = Self.wtNumber(wt.branch) { maxN = max(maxN, n) }
        }
        let brOut = git.gitSync(["-C", repoPath, "branch", "--list", "wt-*"], timeout: 10)
        for name in Self.parseBranchList(brOut.stdout) {
            if let n = Self.wtNumber(name) { maxN = max(maxN, n) }
        }
        let wtDir = URL(fileURLWithPath: repoPath, isDirectory: true)
            .appendingPathComponent(".worktrees").path
        if let subs = try? FileManager.default.contentsOfDirectory(atPath: wtDir) {
            for sub in subs { if let n = Self.wtNumber(sub) { maxN = max(maxN, n) } }
        }
        return maxN + 1
    }

    // MARK: - remove

    /// git-common-dir 定主仓 → worktree remove --force → 分支名匹配 ^(wt|worktree)-\d+$ 才 branch -D
    /// （手工分支保留；分支删失败仅日志）。入口仅 merged 非主行（PRD），语义恒 force。
    func removeSync(worktreePath: String) -> FsResponse {
        let rp = git.gitSync(
            ["-C", worktreePath, "rev-parse", "--path-format=absolute", "--git-common-dir"],
            timeout: 10)
        guard rp.code == 0 else {
            return .rejected(code: "NOT_GIT_REPO", message: "无法定位主仓")
        }
        let commonDir = rp.stdout.split(separator: "\n").first.map {
            $0.trimmingCharacters(in: .whitespaces)
        } ?? ""
        let repoPath = Self.mainRepoPath(fromCommonDir: commonDir)
        // 分支名须在 remove 前取（remove 后 worktree 目录消失）。
        let branch = git.gitSync(["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"], timeout: 10)
            .stdout.trimmingCharacters(in: .whitespacesAndNewlines)

        let rm = git.gitSync(
            ["-C", repoPath, "worktree", "remove", worktreePath, "--force"], timeout: 10)
        guard rm.code == 0 else {
            return .rejected(
                code: "GIT_ERROR",
                message: rm.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        if Self.isAutoBranch(branch) {
            let del = git.gitSync(["-C", repoPath, "branch", "-D", branch], timeout: 10)
            if del.code != 0 {
                NSLog("[muxvo] worktree remove：分支 \(branch) 删除失败（仅日志）：\(del.stderr)")
            }
        }
        names?.remove(worktreePath) // 自定义名随 worktree 实体消亡（§5）
        return .worktreeRemoved
    }

    // MARK: - .git 体积（缓存 5min）

    private func gitSizeWarning(repoPath: String) -> WorktreeWarning? {
        let now = nowMs()
        sizeCacheLock.lock()
        if let cached = sizeCache[repoPath], now - cached.atMs < Self.sizeTTLms {
            sizeCacheLock.unlock()
            return cached.sizeMB > Self.warnThresholdMB ? WorktreeWarning(sizeMB: cached.sizeMB) : nil
        }
        sizeCacheLock.unlock()

        let gitDir = URL(fileURLWithPath: repoPath, isDirectory: true)
            .appendingPathComponent(".git").path
        let du = GitCLI.runSync(
            executable: "du", args: ["-sk", gitDir], environment: git.environment, timeout: 10)
        // du -sk 输出 "<KB>\t<path>"；失败/超时 → 静默无 warning（软提示，可接受）。
        guard du.code == 0, !du.timedOut,
              let firstField = du.stdout.split(whereSeparator: { $0 == "\t" || $0 == " " }).first,
              let kb = Int(firstField) else {
            return nil
        }
        let mb = kb / 1024
        sizeCacheLock.lock(); sizeCache[repoPath] = (mb, now); sizeCacheLock.unlock()
        return mb > Self.warnThresholdMB ? WorktreeWarning(sizeMB: mb) : nil
    }

    // MARK: - 纯解析（static，直测）

    /// git-common-dir（<mainrepo>/.git）→ 主仓工作树（去尾 /.git）。
    static func mainRepoPath(fromCommonDir commonDir: String) -> String {
        let url = URL(fileURLWithPath: commonDir)
        return url.lastPathComponent == ".git" ? url.deletingLastPathComponent().path : commonDir
    }

    /// `worktree list --porcelain -z` 解析：`key SPACE value\0` 行、`\0\0` 分记录。
    /// branch = 去 `refs/heads/` 前缀；detached → "(detached)"。isMain = 路径归一后 == repoPath。
    static func parseWorktreePorcelain(
        _ output: String, repoPath: String
    ) -> [(path: String, branch: String, isMain: Bool)] {
        let canonRepo = canonical(repoPath)
        var result: [(path: String, branch: String, isMain: Bool)] = []
        var curPath: String?
        var curBranch: String?
        func flush() {
            if let p = curPath {
                let branch = curBranch ?? "(detached)"
                result.append((path: p, branch: branch, isMain: canonical(p) == canonRepo))
            }
            curPath = nil
            curBranch = nil
        }
        for token in output.split(separator: "\0", omittingEmptySubsequences: false) {
            let s = String(token)
            if s.isEmpty { flush(); continue }
            if s.hasPrefix("worktree ") {
                curPath = String(s.dropFirst("worktree ".count))
            } else if s == "detached" {
                curBranch = "(detached)"
            } else if s.hasPrefix("branch ") {
                let ref = String(s.dropFirst("branch ".count))
                curBranch = ref.hasPrefix("refs/heads/")
                    ? String(ref.dropFirst("refs/heads/".count)) : ref
            }
        }
        flush()
        return result
    }

    /// `git branch [--merged|--list]` 输出解析：逐行去 2 字前缀标记（`* `/`+ `/`  `）取分支名集。
    static func parseBranchList(_ output: String) -> Set<String> {
        var set = Set<String>()
        for raw in output.split(separator: "\n") {
            let stripped = String(raw).drop { $0 == "*" || $0 == "+" || $0 == " " }
            let name = String(stripped).trimmingCharacters(in: .whitespaces)
            // 忽略 detached 占位行 "(HEAD detached at ...)"。
            if !name.isEmpty, !name.hasPrefix("(") { set.insert(name) }
        }
        return set
    }

    /// `wt-N` → N（仅自增编号源用；`worktree-N` 不计入编号，只在删除时按 isAutoBranch 匹配）。
    static func wtNumber(_ name: String) -> Int? {
        guard name.hasPrefix("wt-") else { return nil }
        let num = name.dropFirst("wt-".count)
        guard !num.isEmpty, num.allSatisfy({ $0.isNumber }) else { return nil }
        return Int(num)
    }

    /// 分支名匹配 `^(wt|worktree)-\d+$`（自动创建的才删；手工分支保留，legacy 同）。
    static func isAutoBranch(_ name: String) -> Bool {
        for prefix in ["wt-", "worktree-"] where name.hasPrefix(prefix) {
            let num = name.dropFirst(prefix.count)
            if !num.isEmpty, num.allSatisfy({ $0.isNumber }) { return true }
        }
        return false
    }

    /// 路径归一（解符号链接 + 标准化）：/var↔/private/var 等在 worktree list vs cwd 比对时归一。
    static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
    }
}
