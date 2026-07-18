// 会话回填（M5-R1 缺陷「超 30 天回填续聊」，chat-data.md 冻结面修订登记①）——把镜像归档的
// `<sid>.jsonl` 反向拷回 `~/.claude/projects/` 使已被 CC 清理的会话重新可 `--resume`。
//
// 背景：CC 默认按 mtime 清 30 天前的 `~/.claude/projects/**/*.jsonl`，清后 resume 失效；但 ChatMirror
// 已把每条会话单向镜像进 `<dataRoot>/chat-history/<projectHash>/<sid>.jsonl`（仅增不删）。jsonl 自包含
// （首行带 sessionId/cwd），回填单文件即可 resume。
//
// **写向不变式（与 ChatMirror 并立，不改 mirror 的写向）**：本类型是仓内**唯一被允许写
// `~/.claude/projects`** 的反向通道。ChatMirror 恒 `CC → 共享归档池`（sourceRoot 绝不写回，ChatMirror:12/:19）；
// ChatRestore 恒 `共享池/legacy 镜像 → CC`（dogfood-r5 PR-4 起按序多根：共享池优先、per-分身 legacy 兜底）。
// 两者各自单向、互不违背——mirror 只读 CC 写池，restore 只读镜像根写 CC。
//
// mtime=now 语义（关键）：镜像文件 mtime 被 ChatMirror「copy 后写回源 mtime」(§6.1) 刷成源的旧 mtime
// （可能 >30 天）。回填后若不刷新，CC 下一轮 30 天清理会**立即又删**回填出来的文件。故回填后显式把
// dest mtime 置 now。副作用：dest 与镜像秒级 mtime 不再相等 → ChatMirror 下一轮 fullScan 会再镜像一次
// 该文件（内容逐字节恒等，无害，仅一次多余 copy）。
import Foundation
import MuxvoStorage

/// 镜像 → CC 单向回填。所有路径经 init 注入（测试注入临时目录，绝不碰真 `~/.claude`）。
public struct ChatRestore: Sendable {
    /// 镜像根按序（dogfood-r5 PR-4）：共享归档池优先、per-分身 legacy 兜底；restore 命中**第一个**含
    /// `<sid>.jsonl` 的根。每根一级子目录 = projectHash（与 CC 同构，子目录名原样保留 → 回填到 CC 同名子目录）。
    public let mirrorRoots: [URL]
    /// CC 项目根 `~/.claude/projects/`（回填目的地，本类型是唯一允许写此处的反向通道）。
    public let ccProjectsRoot: URL

    public init(mirrorRoots: [URL], ccProjectsRoot: URL) {
        self.mirrorRoots = mirrorRoots
        self.ccProjectsRoot = ccProjectsRoot
    }

    public enum Outcome: Equatable, Sendable {
        /// 从镜像成功回填进 CC（mtime 已刷 now）。
        case restored
        /// CC 已有该会话（回填 dest 或 CC 任一子目录已存在同名文件）→ 不覆盖、no-op。
        case alreadyPresent
        /// 镜像内找不到该会话且 CC 也没有 → 无从回填。
        case archiveMissing
        /// I/O 异常（mkdir/copy/setAttributes 失败）或 sessionId 非法 → 附描述。
        case failed(String)
    }

    /// 回填一个会话：镜像 `<subdir>/<sid>.jsonl` → CC `<subdir>/<sid>.jsonl` + mtime=now。幂等（重跑 alreadyPresent）。
    public func restore(sessionId: String) -> Outcome {
        // 1. 严格 UUID 白名单（SEC-M3 同口径，防路径注入：合法 UUID 不含任何路径分隔符）。
        guard TerminalRestoreGate.isValidSessionId(sessionId) else {
            return .failed("invalid sessionId: \(sessionId)")
        }
        let fileName = "\(sessionId).jsonl"

        // 2. 定位镜像归档：按序枚举 mirrorRoots（共享池优先、legacy 兜底），首个根内首个含 <sid>.jsonl 命中。
        //    UUID 全局唯一无需 cwd→hash 重算；子目录名原样保留即与 CC 同构（worktree 子目录名自然对应）。
        var located: (subdir: String, url: URL)?
        for root in mirrorRoots {
            if let m = firstMatch(root: root, fileName: fileName) { located = m; break }
        }
        guard let hit = located else {
            // 全部镜像根都找不到：先查 CC 是否已在（在→alreadyPresent，兜住「镜像已删但 CC 仍有」），否则 archiveMissing。
            return firstMatch(root: ccProjectsRoot, fileName: fileName) != nil ? .alreadyPresent : .archiveMissing
        }

        // 3. dest = CC/<同子目录名>/<sid>.jsonl；已存在 → 绝不覆盖。
        let destDir = ccProjectsRoot.appendingPathComponent(hit.subdir, isDirectory: true)
        let dest = destDir.appendingPathComponent(fileName, isDirectory: false)
        if FileManager.default.fileExists(atPath: dest.path) { return .alreadyPresent }

        // 4. mkdir -p → copy → 刷 mtime=now（否则 CC 下轮 30 天清理据旧 mtime 立即又删）。
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: destDir, withIntermediateDirectories: true)
            try fm.copyItem(at: hit.url, to: dest)
            try fm.setAttributes([.modificationDate: Date()], ofItemAtPath: dest.path)
            return .restored
        } catch {
            return .failed("\(error)")
        }
    }

    /// 枚举 root 一级子目录（sorted 确定序），返回首个含 fileName 的 (子目录名, 文件 URL)。
    private func firstMatch(root: URL, fileName: String) -> (subdir: String, url: URL)? {
        let fm = FileManager.default
        guard let subdirs = try? fm.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey]) else { return nil }
        for entry in subdirs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            guard isDir else { continue }
            let candidate = entry.appendingPathComponent(fileName, isDirectory: false)
            if fm.fileExists(atPath: candidate.path) {
                return (entry.lastPathComponent, candidate)
            }
        }
        return nil
    }
}
