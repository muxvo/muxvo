// worktree 自定义名持久化（worktree-popover.md §5）：终端重命名时若 cwd 在某 worktree 内，把名字
// 持久绑定到 **worktree 路径实体**——关终端/重启 app/未开终端时分支下拉列表仍显示该名。
// 不进 ConfigStore.openTerminals（那是终端生命周期态，随关闭消失；本 store 绑路径，生命周期不同）。
//
// 仿 ChatCustomTitlesStore（同 MuxvoStorage 落盘惯例）：NSLock 保护内存权威 map + AtomicFile 原子
// 落盘（durability .full、0600）、低频写即时落盘不去抖、文件损坏 → 空表兜底不 crash。无 onChange
// 反向链（worktree 列表按需请求 statusSync 现读，无推送面）。key 统一 canonicalKey 归一
// （/var↔/private/var），写读两侧口径一致。
import Foundation

/// worktree 自定义名存取（`<dataRoot>/state/worktree-names.json`，形 `{"<worktree绝对路径>":"<名字>"}`）。
public final class WorktreeNamesStore: @unchecked Sendable {
    private let fileURL: URL
    private let stateDirectory: URL

    private let lock = NSLock()
    private var names: [String: String]
    /// 实际落盘次数（测试观测用；仅真变化才 +1）。
    public private(set) var diskWrites = 0

    public init(root: URL) {
        let url = DataDirectory.worktreeNamesURL(under: root)
        fileURL = url
        stateDirectory = url.deletingLastPathComponent()
        names = Self.readFromDisk(url)
    }

    /// 取自定义名（无 → nil）。
    public func get(_ worktreePath: String) -> String? {
        lock.withLock { names[Self.canonicalKey(worktreePath)] }
    }

    /// 设置/清除：`name` 为 nil 或空串 → 移除该键；否则设置。仅在值真变化时落盘（幂等免冗余写）。
    /// 名字原样存（不 trim）——调用方（终端重命名正向链）已按 projection 语义 trim 后传入。
    /// 「最后改名赢」由同 key 覆写天然成立（多终端同 worktree 场景）。
    public func set(_ worktreePath: String, name: String?) {
        let normalized: String? = (name?.isEmpty == false) ? name : nil
        let key = Self.canonicalKey(worktreePath)
        lock.withLock {
            if let normalized {
                guard names[key] != normalized else { return }
                names[key] = normalized
            } else {
                guard names.removeValue(forKey: key) != nil else { return }
            }
            writeLocked()
        }
    }

    /// 启动回填（§5，存量升级路径）：把持久化开着的终端 (cwd, customName) 补进映射——本 store 引入前
    /// 已命名的 tile 升级后立即在分支列表可见。**只补缺**（已有 key 不覆盖：用户显式改名/清名优先；
    /// 同 key 多候选先到先得）。非 worktree cwd / 空名跳过；真有新增才落盘一次。
    public func backfill(from pairs: [(cwd: String, name: String)]) {
        lock.withLock {
            var changed = false
            for (cwd, name) in pairs {
                guard !name.isEmpty, let root = Self.worktreeRoot(forCwd: cwd) else { continue }
                let key = Self.canonicalKey(root)
                if names[key] == nil {
                    names[key] = name
                    changed = true
                }
            }
            if changed { writeLocked() }
        }
    }

    /// 移除该键（无该键 no-op、不落盘）。worktree 删除/编号复用重建时清陈名用。
    public func remove(_ worktreePath: String) {
        let key = Self.canonicalKey(worktreePath)
        lock.withLock {
            guard names.removeValue(forKey: key) != nil else { return }
            writeLocked()
        }
    }

    /// 内存权威快照（观测/测试用）。
    public func all() -> [String: String] {
        lock.withLock { names }
    }

    // MARK: 纯函数（static，直测）

    /// cwd → 所属 worktree 根：找首个 `/.worktrees/` 标记，根 = 截至其后一个路径组件
    /// （`/repo/.worktrees/wt-19/src` → `/repo/.worktrees/wt-19`）。无标记（主仓/普通目录）或
    /// 标记后组件为空（cwd 是 `.worktrees` 目录本身）→ nil。嵌套 worktree 不存在（createSync 拒绝），
    /// 首个标记即唯一标记。
    public static func worktreeRoot(forCwd cwd: String) -> String? {
        let marker = "/.worktrees/"
        guard let range = cwd.range(of: marker) else { return nil }
        let rest = cwd[range.upperBound...]
        let component = rest.split(separator: "/", omittingEmptySubsequences: true).first
        guard let component, !component.isEmpty else { return nil }
        return String(cwd[cwd.startIndex..<range.upperBound]) + component
    }

    /// 路径归一（与 InteractiveWorktreeService.canonical 同款：解符号链接 + 标准化），
    /// /var↔/private/var 等写读两侧归一到同一 key。
    static func canonicalKey(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
    }

    // MARK: 私有（须持 lock）

    private func writeLocked() {
        do {
            try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(names)
            try AtomicFile.write(data, to: fileURL, durability: .full)
            diskWrites += 1
        } catch {
            // 落盘失败不抛（名字丢失至多退化到显示 wt-N，非关键路径）；下次写再试。
            FileHandle.standardError.write(Data("[muxvo] worktree-names 落盘失败：\(error)\n".utf8))
        }
    }

    private static func readFromDisk(_ url: URL) -> [String: String] {
        guard let data = try? Data(contentsOf: url) else { return [:] } // 缺失 = 空表
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:] // 损坏 = 空表兜底
    }
}
