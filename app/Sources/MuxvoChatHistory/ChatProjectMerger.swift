// 项目发现与归并（specs/behavior/chat-data.md §1）——纯函数，复刻 legacy
// `chat-dual-source.ts` getProjects(474-531) / scanProjectsFromDir 投影(361-375) /
// getParentProjectHash(36-39)。目录扫描（readdir/stat）本身留批2，本文件只做**扫描事实 → 归并**。
//
// 两处红线（易错，实现者必读）：
//  · §1.4 项目级 archive 合并 = **Math.max(sessionCount)**（非累加、非会话去重），且仅 sessionCount
//    取 max，totalSize/lastActivity/displayPath/displayName 保持 CC 值。与 §2.4/§6.2 的会话级
//    (projectHash,fileName) CC 优先去重语义**不同**——ProjectInfo.sessionCount 必须走本节 Math.max。
//  · §1.2 worktree 归并倒序遍历 + splice：父存在 → 累加(sessionCount+/totalSize+/lastActivity max)后
//    删子；父缺失 → remap 子成父 hash（后续同父 worktree 会并入这条 remapped 记录，legacy 既有语义）。

import Foundation

public enum ChatProjectMerger {

    static let worktreeMarker = "--worktrees-"

    // MARK: - worktree hash 解析（§1.2）

    /// 父 projectHash（§1.2）：`hash.indexOf('--worktrees-')`，idx>0 时取前缀，否则 nil。
    public static func parentProjectHash(_ hash: String) -> String? {
        guard let range = hash.range(of: worktreeMarker) else { return nil }
        guard range.lowerBound != hash.startIndex else { return nil }  // legacy idx>0
        return String(hash[hash.startIndex..<range.lowerBound])
    }

    /// worktree 标签（§1.2）：最后一个 `--worktrees-` 之后的整段（如 `wt-1`/`worktree-10`）；无标记 nil。
    public static func worktreeLabel(fromHash hash: String) -> String? {
        guard let range = hash.range(of: worktreeMarker, options: .backwards) else { return nil }
        return String(hash[range.upperBound...])
    }

    // MARK: - displayName / displayPath（§1.1）

    /// projectHash 末段兜底名（§1.1）：按 `-` 切、去空段、取末段；无段则整个 hash。
    public static func fallbackName(projectHash: String) -> String {
        let segments = projectHash.split(separator: "-", omittingEmptySubsequences: true)
        return segments.last.map(String.init) ?? projectHash
    }

    /// 路径末段（去空段），无则 nil（对齐 JS `path.split('/').filter(Boolean).pop()`）。
    public static func lastPathSegment(_ path: String) -> String? {
        path.split(separator: "/", omittingEmptySubsequences: true).last.map(String.init)
    }

    /// displayName（§1.1）：有 displayPath → 取其末段（空则 fallbackName）；无 displayPath → fallbackName。
    public static func displayName(displayPath: String, projectHash: String) -> String {
        let fb = fallbackName(projectHash: projectHash)
        if displayPath.isEmpty { return fb }
        return lastPathSegment(displayPath) ?? fb
    }

    /// 去 worktree 目录尾缀（§1.2 remap）：`/\/.worktrees\/(wt|worktree)-\d+$/`（'.' 任意字符、
    /// `\d`=[0-9] 逐字对齐 legacy——不用 ICU `\d` 以免误吞 Unicode 数字）。
    public static func stripWorktreeSuffix(_ displayPath: String) -> String {
        let pattern = "/.worktrees/(wt|worktree)-[0-9]+$"
        guard let re = try? NSRegularExpression(pattern: pattern) else { return displayPath }
        let ns = displayPath as NSString
        return re.stringByReplacingMatches(
            in: displayPath, range: NSRange(location: 0, length: ns.length), withTemplate: "")
    }

    // MARK: - 单目录扫描投影（§1.1，纯函数——I/O 侧由批2 供事实）

    /// 由扫描事实构建一条 ProjectInfo（§1.1）；`jsonlCount==0` → nil（无 .jsonl 目录丢弃）。
    /// - displayPath: 首 session 前 10 行首个 obj.cwd（批2 读取后传入，空串表示读不到）。
    /// - totalSize: 所有 .jsonl 的 stat.size 之和（单个失败按 0 计，批2 已累加）。
    /// - lastActivityMs: **目录** mtime 毫秒（§1.1：不逐文件求最新）。
    public static func buildProjectInfo(
        projectHash: String,
        displayPath: String,
        jsonlCount: Int,
        totalSize: Int,
        lastActivityMs: Double,
        source: ChatSource = .claudeCode
    ) -> ChatProjectInfo? {
        guard jsonlCount > 0 else { return nil }
        return ChatProjectInfo(
            projectHash: projectHash,
            displayPath: displayPath,
            displayName: displayName(displayPath: displayPath, projectHash: projectHash),
            sessionCount: jsonlCount,
            totalSize: totalSize,
            lastActivity: lastActivityMs,
            source: source)
    }

    // MARK: - 归并（§1.4 + §1.2）

    public struct MergeResult: Sendable, Equatable {
        /// 归并后项目列表（lastActivity 降序）；无 `--worktrees-` 结尾的独立条目（§1.2 红线）。
        public var projects: [ChatProjectInfo]
        /// worktree 回查图：父 hash → [子 worktree hash...]（§1.3 供批2 目录回查）。
        public var worktreeMap: [String: [String]]

        public init(projects: [ChatProjectInfo], worktreeMap: [String: [String]]) {
            self.projects = projects
            self.worktreeMap = worktreeMap
        }
    }

    /// 归并 CC + archive 扫描事实（§1.4 先、§1.2 后），返回列表 + worktreeMap。
    /// `archive` 为空数组表示 reader 未挂镜像根（§1.4 触发前提）。
    public static func merge(cc: [ChatProjectInfo], archive: [ChatProjectInfo]) -> MergeResult {
        var projects = cc

        // §1.4 项目级 archive 合并（先于 worktree 归并）：ccHashSet 为快照，不随 push 更新（对齐 legacy）。
        let ccHashSet = Set(projects.map { $0.projectHash })
        for ap in archive {
            if ccHashSet.contains(ap.projectHash) {
                if let idx = projects.firstIndex(where: { $0.projectHash == ap.projectHash }) {
                    // 仅 sessionCount 取 max；其余字段保持 CC 值。
                    projects[idx].sessionCount = max(projects[idx].sessionCount, ap.sessionCount)
                }
            } else {
                projects.append(ap)
            }
        }

        // §1.2 worktree 归并（倒序 + splice，保索引不失效）。
        var worktreeChildren: [String: [String]] = [:]
        var i = projects.count - 1
        while i >= 0 {
            if let parentHash = parentProjectHash(projects[i].projectHash) {
                worktreeChildren[parentHash, default: []].append(projects[i].projectHash)
                if let parentIdx = projects.firstIndex(where: { $0.projectHash == parentHash }) {
                    projects[parentIdx].sessionCount += projects[i].sessionCount
                    projects[parentIdx].totalSize =
                        (projects[parentIdx].totalSize ?? 0) + (projects[i].totalSize ?? 0)
                    projects[parentIdx].lastActivity =
                        max(projects[parentIdx].lastActivity, projects[i].lastActivity)
                    projects.remove(at: i)
                } else {
                    // 父项目本身无 session → remap 该 worktree 条目为父 hash。
                    projects[i].projectHash = parentHash
                    projects[i].displayPath = stripWorktreeSuffix(projects[i].displayPath)
                    projects[i].displayName =
                        lastPathSegment(projects[i].displayPath) ?? projects[i].displayName
                }
            }
            i -= 1
        }

        // lastActivity 降序（对齐 legacy 524；dump 归一层另按 projectHash 排序，§8.2 规则1）。
        projects.sort { $0.lastActivity > $1.lastActivity }

        return MergeResult(projects: projects, worktreeMap: worktreeChildren)
    }
}
