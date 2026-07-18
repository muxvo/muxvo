// 会话镜像/归档（chat-data.md §6，LIVE 权威 = legacy chat-archive.ts）。
//
// 职责：把 CC 源（`~/.claude/projects/`，只读输入）逐 .jsonl 镜像进**注入的镜像根**——dogfood-r5 PR-4 起
// **生产镜像根 = 中心化共享归档池**（`DataDirectory` 的共享归档根权威访问器派生，所有 Muxvo 分身共用，§6.5；
// 便捷 init 的 per-分身 `<dataRoot>/chat-history/` 降为迁移源/测试用）。扁平 `<projectHash>/<sessionId>.jsonl`，
// 与 CC 同构，reader 用同一份代码读 live-CC 与镜像。**严禁** legacy 的 `~/.muxvo/chat-archive/`——镜像根一律
// 经 DataDirectory 布局派生（本文件不构造任何数据目录字面量）。
//
// 核心不变式：
//  · 秒级对比（§6.1）：两侧 `floor(mtimeMs/1000)` 相等即跳过，不等才 copy；镜像缺失记 0（必 copy）。
//  · copy 前 stat 源 mtime 并写回（§6.1 幂等前提；dogfood-r5 PR-2 改经 ChatFileOps.atomicCopy）：copyItem
//    不保源 mtime，显式 setAttributes 写回，使下一轮秒级判据幂等（源未变→镜像 mtime==源 mtime→跳过；连跑
//    两轮第二轮 copy 数 = 0）。原子写 = copyItem→temp→rename(2)，杜绝「removeItem+copyItem」的非原子空窗。
//  · 双写者收敛（dogfood-r5 W-A 共享归档池多分身并发镜像同一源）：论证三条见 ChatFileOps 头注（同内容后
//    到者胜／旧盖新下轮秒级 != 重拷收敛／读者经 rename 原子性永见完整文件）。
//  · 仅增不删（§6.1）：只 copy、从不删镜像 `.jsonl`；源删掉的 session 镜像仍留（reader 合并标 archiveOnly）。
//    唯一例外 = fullScan 末尾清扫本入口自家孤儿 temp（`.tmp-*.<UUID>`，mtime>1h；非归档载荷，红线不破）。
//  · 只读降级（§6.4）：镜像根不可写 → readonly 模式 + warning 文案，不 crash、不阻塞；单文件 copy 失败
//    （文件锁/瞬时 I/O）→ skipped + 下轮重试（秒级 != 仍真）。
import Foundation
import MuxvoStorage

public struct ChatMirror: Sendable {
    /// CC 源根 `~/.claude/projects/`（只读输入，绝不写回）。
    public let sourceRoot: URL
    /// 镜像根 `<dataRoot>/chat-history/`（DataDirectory.chatHistoryDirectoryURL 派生）。
    public let mirrorRoot: URL
    /// sync-state.json 路径（DataDirectory.chatSyncStateURL 派生）。
    public let syncStateURL: URL

    public init(sourceRoot: URL, mirrorRoot: URL, syncStateURL: URL) {
        self.sourceRoot = sourceRoot
        self.mirrorRoot = mirrorRoot
        self.syncStateURL = syncStateURL
    }

    /// 便捷装配：per-分身 legacy 镜像根（dogfood-r5 起主镜像改指共享池，此 init 供迁移源/测试用）——
    /// 镜像根与 sync-state 路径均从数据根经 DataDirectory 布局派生（§6.2 严禁字面量：路径唯一权威是
    /// DataDirectory，杜绝 `~/.muxvo`/裸拼路径）。
    public init(sourceRoot: URL, dataRoot: URL) {
        self.init(
            sourceRoot: sourceRoot,
            mirrorRoot: DataDirectory.chatHistoryDirectoryURL(under: dataRoot),
            syncStateURL: DataDirectory.chatSyncStateURL(under: dataRoot)
        )
    }

    /// 只读降级文案（§6.4；sync-manager.ts:41-46）。
    public static let readonlyWarning = "无法写入数据目录，历史备份已暂停"

    public enum Mode: Sendable, Equatable { case active, readonly }

    public struct SyncResult: Sendable, Equatable {
        /// 本轮实际 copy 成功的文件数。
        public var synced: Int
        /// 本轮需同步（秒级 !=）的文件数（= synced + skipped.count）。
        public var total: Int
        public var mode: Mode
        /// 单文件 copy 失败（文件锁/瞬时 I/O）→ 相对路径，下轮重试（§6.4 retryOnNextSync）。
        public var skipped: [String]
        /// 只读降级时的 warning 文案（active 模式为 nil）。
        public var warning: String?

        public init(synced: Int, total: Int, mode: Mode, skipped: [String], warning: String?) {
            self.synced = synced
            self.total = total
            self.mode = mode
            self.skipped = skipped
            self.warning = warning
        }
    }

    // MARK: - 全量扫（fullScan:73-97）

    /// 全量镜像：递归扫 sourceRoot 下 .jsonl，秒级对比后 copy 变更项，末尾整表覆盖 sync-state。
    ///
    /// `onProgress`（chat-data.md 冻结面修订登记③，**行为恒等加性**）：装配层要「同步中 N/M」进度条时传入。
    /// 两段化：先收集「需 copy 清单」→ total 先知；再逐个 copyOne，每处理一项回调一次 `(processed, total)`。
    /// **回调 processed = 已处理项数（copied+skipped），保末帧 processed==total 供进度条推完成**——与
    /// `SyncResult.synced`（仅 copied）口径分列。0 任务时回调一次 `(0, 0)` 让上层能推「已完成」末帧。
    /// 节流不在此（装配层做），回调保持纯粹。**返回值/落盘行为与无回调跑逐字段恒等**（既有测试零改动）。
    @discardableResult
    public func fullScan(onProgress: ((_ processed: Int, _ total: Int) -> Void)? = nil) -> SyncResult {
        guard mirrorIsWritable() else { return readonlyResult() }
        let sourceFiles = collectSourceFiles()
        // 段1：收集「需 copy 清单」（秒级 != 或镜像缺失）——total 先知。逐文件独立，先判后 copy 与原内联判序恒等。
        let needsCopy = sourceFiles.filter { f in
            let srcSec = floorSeconds(f.sourceMtimeMs)
            let mirrorSec = mtimeMs(of: f.mirror).map(floorSeconds) ?? 0  // 镜像缺失记 0 → 必 copy
            return srcSec != mirrorSec  // 秒级不等/缺失才 copy；相等跳过
        }
        let total = needsCopy.count
        if total == 0 { onProgress?(0, 0) }  // 末帧 (0,0)
        // 段2：逐个 copy，每处理一项回调 (processed, total)。
        var synced = 0
        var processed = 0
        var skipped: [String] = []
        for f in needsCopy {
            switch copyOne(source: f.source, mirror: f.mirror) {
            case .copied: synced += 1
            case .skipped: skipped.append(f.relativePath)
            }
            processed += 1
            onProgress?(processed, total)
        }
        try? persistSyncState(sourceFiles: sourceFiles)
        sweepOrphanTemps()  // 可写分支末尾：清本入口自家孤儿 temp（>1h），绝不碰 `.jsonl`
        return SyncResult(synced: synced, total: total, mode: .active, skipped: skipped, warning: nil)
    }

    // MARK: - 增量（archiveSession:102-127）

    /// 单会话增量镜像（chat-watcher 事件触发）。源缺失/秒级相等/copy 失败 → false；实际 copy → true。
    @discardableResult
    public func archiveSession(projectHash: String, sessionId: String) -> Bool {
        guard mirrorIsWritable() else { return false }
        let fileName = "\(sessionId).jsonl"
        let source = sourceRoot.appendingPathComponent(projectHash, isDirectory: true)
            .appendingPathComponent(fileName)
        let mirror = mirrorRoot.appendingPathComponent(projectHash, isDirectory: true)
            .appendingPathComponent(fileName)
        guard let srcMs = mtimeMs(of: source) else { return false }  // 源缺失（legacy stat 抛 → false）
        let mirrorSec = mtimeMs(of: mirror).map(floorSeconds) ?? 0
        if floorSeconds(srcMs) == mirrorSec { return false }  // 秒级相等 → 不 copy
        guard case .copied = copyOne(source: source, mirror: mirror) else { return false }
        // sync-state 增量更新一条（读现有 → 合并 → 写；损坏/缺失当空重建，§6.3 自愈）
        let relativePath = "\(projectHash)/\(fileName)"
        var state = ChatSyncState.load(from: syncStateURL) ?? ChatSyncState(lastSync: "", fileMtime: [:])
        state.fileMtime[relativePath] = Int(srcMs.rounded(.down))
        state.lastSync = ChatSyncState.nowISOString()
        try? state.write(to: syncStateURL)
        return true
    }

    // MARK: - 私有

    private struct SourceFile {
        let source: URL
        let mirror: URL
        let relativePath: String
        let sourceMtimeMs: Double
    }

    /// 递归扫 sourceRoot 下全部 .jsonl（读失败/stat 失败静默跳过，legacy catch → skip）。
    private func collectSourceFiles() -> [SourceFile] {
        var out: [SourceFile] = []
        walk(sourceDir: sourceRoot, mirrorDir: mirrorRoot, prefix: "", into: &out)
        return out
    }

    private func walk(sourceDir: URL, mirrorDir: URL, prefix: String, into out: inout [SourceFile]) {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: sourceDir, includingPropertiesForKeys: [.isDirectoryKey]
        ) else { return }  // 目录读失败静默跳过
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let name = entry.lastPathComponent
            let relativePath = prefix.isEmpty ? name : "\(prefix)/\(name)"
            let mirrorEntry = mirrorDir.appendingPathComponent(name)
            let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir {
                walk(sourceDir: entry, mirrorDir: mirrorEntry, prefix: relativePath, into: &out)
            } else if name.hasSuffix(".jsonl") {
                guard let ms = mtimeMs(of: entry) else { continue }  // 源 stat 失败跳过
                out.append(SourceFile(
                    source: entry, mirror: mirrorEntry, relativePath: relativePath, sourceMtimeMs: ms))
            }
        }
    }

    private enum CopyOutcome { case copied, skipped }

    /// copy 单文件（原子替换）+ 写回源 mtime。任何 I/O 失败（文件锁/源不可读/rename 失败）→ skipped
    /// （下轮重试，不 crash）。dogfood-r5 PR-2：改经 ChatFileOps.atomicCopy——**stat 源 mtime 在 copy 前**
    /// （copy 期间源被追加时旧 mtime 配旧内容→下轮秒级 != 重拷收敛），temp+rename(2) 杜绝非原子空窗。
    private func copyOne(source: URL, mirror: URL) -> CopyOutcome {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: source.path),
              let srcDate = attrs[.modificationDate] as? Date else {
            return .skipped  // 源不可读/缺失 → 下轮重试
        }
        do {
            try ChatFileOps.atomicCopy(from: source, to: mirror, mtime: srcDate)
            return .copied
        } catch {
            return .skipped
        }
    }

    /// 清扫本入口遗留的孤儿 temp（写者崩溃在 rename 前留下）：严格匹配 `.tmp-*.<UUID>` 命名 + mtime 距今
    /// >1h（在飞 temp 存活仅 copy→rename 毫秒窗，1h 阈值避误删并发写者在飞 temp）。绝不碰 `*.jsonl` 归档载荷。
    private func sweepOrphanTemps() {
        let fm = FileManager.default
        guard let en = fm.enumerator(
            at: mirrorRoot,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]
        ) else { return }
        let cutoff = Date().addingTimeInterval(-3600)  // >1h
        for case let url as URL in en {
            guard ChatFileOps.isOrphanTempName(url.lastPathComponent) else { continue }
            let vals = try? url.resourceValues(
                forKeys: [.contentModificationDateKey, .isRegularFileKey])
            guard vals?.isRegularFile == true, let mtime = vals?.contentModificationDate else { continue }
            if mtime < cutoff { try? fm.removeItem(at: url) }
        }
    }

    /// 整表覆盖 sync-state = 源现况快照（记录/断言面，§6.3）。
    private func persistSyncState(sourceFiles: [SourceFile]) throws {
        var fileMtime: [String: Int] = [:]
        for f in sourceFiles { fileMtime[f.relativePath] = Int(f.sourceMtimeMs.rounded(.down)) }
        try ChatSyncState(lastSync: ChatSyncState.nowISOString(), fileMtime: fileMtime)
            .write(to: syncStateURL)
    }

    /// 镜像根可写性（§6.4）：幂等建镜像根；建不出（父只读）或建出后不可写 → readonly。
    private func mirrorIsWritable() -> Bool {
        let fm = FileManager.default
        try? fm.createDirectory(at: mirrorRoot, withIntermediateDirectories: true)
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: mirrorRoot.path, isDirectory: &isDir), isDir.boolValue
        else { return false }
        return fm.isWritableFile(atPath: mirrorRoot.path)
    }

    private func readonlyResult() -> SyncResult {
        SyncResult(synced: 0, total: 0, mode: .readonly, skipped: [], warning: Self.readonlyWarning)
    }

    private func mtimeMs(of url: URL) -> Double? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let date = attrs[.modificationDate] as? Date else { return nil }
        return date.timeIntervalSince1970 * 1000
    }

    private func floorSeconds(_ ms: Double) -> Int { Int((ms / 1000).rounded(.down)) }
}
