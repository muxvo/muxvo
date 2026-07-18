// 一次性归档迁移器（dogfood-r5 W-A PR-3，未接线——PR-4 才在 warmup 调用）。
//
// 职责：把 per-分身 legacy 镜像根（`<dataRoot>/chat-history/`）里的会话 .jsonl 一次性搬进中心化共享
// 归档池（`<sharedRoot>/chat-history/`）。搬完在**注入的** markerURL 落 marker，之后短路 no-op。
//
// 幂等与重入（marker 后置 + 对比-跳过）：
//  · marker 在 → 立即 .skippedMarker（零 I/O）。
//  · 逐 `<legacy>/<subdir>/<name>.jsonl`（只认 .jsonl 后缀 → sync-state.json 天然不进池；只扫子目录 →
//    top-level 文件本就不碰）：dest 缺失 → 原子拷（保 legacy mtime）；dest 存在 → shouldReplace 判
//    `(floorSec(mtime), size)` 字典序 src>dest 才替换，否则跳过。
//  · 全程零硬失败才写 marker（原子）；有失败不写 → 下次启动重跑，已搬的 dest 经 shouldReplace 命中相等即
//    跳过（compare-skip 幂等），只补上次失败项。
//
// 路径纪律：legacyRoot/sharedRoot/markerURL **全部注入**（PR-4 经 DataDirectory 派生），本文件不构造任何
// 数据目录字面量；写盘只经 MuxvoStorage.AtomicFile（全 app 唯一落盘入口）。
import Foundation
import MuxvoStorage

public struct ChatArchiveMigrator: Sendable {
    /// per-分身 legacy 镜像根（迁移源，只读输入）。
    public let legacyRoot: URL
    /// 中心化共享归档池根（迁移目标）。
    public let sharedRoot: URL
    /// 一次性完成 marker 路径（注入；存在即短路）。
    public let markerURL: URL

    public init(legacyRoot: URL, sharedRoot: URL, markerURL: URL) {
        self.legacyRoot = legacyRoot
        self.sharedRoot = sharedRoot
        self.markerURL = markerURL
    }

    public enum Outcome: Sendable, Equatable {
        /// marker 已在 → 短路，零 I/O。
        case skippedMarker
        /// 全程零硬失败 + marker 已落。copied=实拷数，skipped=已存在且无需替换数。
        case done(copied: Int, skipped: Int)
        /// 有硬失败（源不可读/拷贝失败）或 marker 落盘失败 → marker **未写**，下次重跑。
        case partial(copied: Int, skipped: Int, failed: Int)
    }

    /// dry-run 预估（离线回收 CLI 用，legacy-archive-reclaim 批）：不看 marker、零写盘。
    /// toCopy=dest 缺失将新拷；toReplace=dest 存在且 shouldReplace 判替换；toSkip=dest 更新/相等；
    /// unreadable=源 stat 失败（读权限不影响 stat——拷贝期 EACCES 归 migrate 的 failed，plan 不预测）。
    public struct DryRunSummary: Sendable, Equatable, Codable {
        public var toCopy: Int
        public var toReplace: Int
        public var toSkip: Int
        public var unreadable: Int
        public var toCopyBytes: Int
        public var toReplaceBytes: Int

        public init(
            toCopy: Int = 0, toReplace: Int = 0, toSkip: Int = 0, unreadable: Int = 0,
            toCopyBytes: Int = 0, toReplaceBytes: Int = 0
        ) {
            self.toCopy = toCopy
            self.toReplace = toReplace
            self.toSkip = toSkip
            self.unreadable = unreadable
            self.toCopyBytes = toCopyBytes
            self.toReplaceBytes = toReplaceBytes
        }
    }

    /// 只读预估 migrateIfNeeded 将做什么（无 marker 前提下）：与真迁移共用 plannedAction 判定，
    /// 全程不创建目录/不写文件/不落 marker。legacy==shared 同路径 → 全零（真迁移同为 no-op）。
    public func plan() -> DryRunSummary {
        var summary = DryRunSummary()
        if legacyRoot.standardizedFileURL == sharedRoot.standardizedFileURL { return summary }
        for subdir in immediateSubdirs(of: legacyRoot) {
            for src in jsonlFiles(in: subdir) {
                let dest = sharedRoot.appendingPathComponent(subdir.lastPathComponent, isDirectory: true)
                    .appendingPathComponent(src.lastPathComponent)
                switch plannedAction(source: src, dest: dest) {
                case .copy(_, let size):
                    summary.toCopy += 1
                    summary.toCopyBytes += size
                case .replace(_, let size):
                    summary.toReplace += 1
                    summary.toReplaceBytes += size
                case .skip:
                    summary.toSkip += 1
                case .unreadable:
                    summary.unreadable += 1
                }
            }
        }
        return summary
    }

    /// marker JSON（sortedKeys 稳定序）：`{version, migratedAt(ISO8601), copied, skipped}`。
    struct Marker: Codable, Equatable {
        let version: Int
        let migratedAt: String
        let copied: Int
        let skipped: Int
    }

    /// 已落 marker 的迁移计数（copied/skipped）。marker 缺失/损坏 → nil。M7 批3 首启迁移提示
    /// （legacy-migration.md §7.2）判「本次迁移有命中」用（copied>0）；纯读、零副作用。
    public static func migrationCounts(markerURL: URL) -> (copied: Int, skipped: Int)? {
        guard let data = try? Data(contentsOf: markerURL),
              let marker = try? JSONDecoder().decode(Marker.self, from: data)
        else { return nil }
        return (marker.copied, marker.skipped)
    }

    /// 纯函数：dest 已存在时是否用 src 替换——`(floorSec(mtime), size)` 字典序 src 严格大于 dest 才替换
    /// （新者胜；秒级同则大者胜；相等/更旧 → 跳过）。单测四象限穷举。
    static func shouldReplace(srcSec: Int, srcSize: Int, destSec: Int, destSize: Int) -> Bool {
        if srcSec != destSec { return srcSec > destSec }
        return srcSize > destSize
    }

    public func migrateIfNeeded() -> Outcome {
        let fm = FileManager.default
        // 1. marker 在 → 短路。
        if fm.fileExists(atPath: markerURL.path) { return .skippedMarker }
        // 2. legacy 与池同路径（换根为 no-op 时）→ 无可迁，直接 seal。
        if legacyRoot.standardizedFileURL == sharedRoot.standardizedFileURL {
            return sealed(copied: 0, skipped: 0)
        }
        // 3. 逐 <legacy>/<subdir>/*.jsonl 迁移（legacy 缺失/空 → subdirs 空 → 落 copied0/skipped0 后 seal）。
        var copied = 0, skipped = 0, failed = 0
        for subdir in immediateSubdirs(of: legacyRoot) {
            for src in jsonlFiles(in: subdir) {
                let dest = sharedRoot.appendingPathComponent(subdir.lastPathComponent, isDirectory: true)
                    .appendingPathComponent(src.lastPathComponent)
                switch migrateOne(source: src, dest: dest) {
                case .copied: copied += 1
                case .skipped: skipped += 1
                case .failed: failed += 1
                }
            }
        }
        // 4. 零硬失败才 seal；有失败 → 不写 marker（下次重跑，compare-skip 幂等）。
        guard failed == 0 else { return .partial(copied: copied, skipped: skipped, failed: failed) }
        return sealed(copied: copied, skipped: skipped)
    }

    // MARK: - 私有

    private enum FileOutcome { case copied, skipped, failed }

    /// 单文件判定（migrateOne 与 plan 共用，保两径永不漂移）：
    /// 源 stat 失败 → .unreadable；dest 缺失 → .copy；dest 存在 → shouldReplace 判 .replace/.skip。
    private enum PlannedAction {
        case copy(mtime: Date, size: Int)
        case replace(mtime: Date, size: Int)
        case skip
        case unreadable
    }

    private func plannedAction(source: URL, dest: URL) -> PlannedAction {
        guard let srcInfo = PosixStat.of(source) else { return .unreadable }
        let srcSec = Int(srcInfo.mtimeMs / 1000)  // floor 到整秒（正值整除 == floor）
        let mtime = Date(timeIntervalSince1970: Double(srcInfo.mtimeMs) / 1000.0)  // 保 legacy mtime
        guard let destInfo = PosixStat.of(dest) else {
            return .copy(mtime: mtime, size: srcInfo.size)
        }
        let destSec = Int(destInfo.mtimeMs / 1000)
        guard Self.shouldReplace(
            srcSec: srcSec, srcSize: srcInfo.size, destSec: destSec, destSize: destInfo.size)
        else { return .skip }  // dest 更新/相等 → 跳过
        return .replace(mtime: mtime, size: srcInfo.size)
    }

    /// 单文件：dest 缺失 → 原子拷（保 legacy mtime）；dest 存在 → shouldReplace 才替换，否则跳过。
    private func migrateOne(source: URL, dest: URL) -> FileOutcome {
        switch plannedAction(source: source, dest: dest) {
        case .unreadable:
            return .failed  // 源不可读
        case .skip:
            return .skipped
        case .copy(let mtime, _), .replace(let mtime, _):
            do {
                try ChatFileOps.atomicCopy(from: source, to: dest, mtime: mtime)
                return .copied
            } catch {
                return .failed
            }
        }
    }

    /// 落 marker（原子），成功 → .done；marker 落盘失败 → .partial（failed:0=全拷成功但未 seal，下次重跑）。
    private func sealed(copied: Int, skipped: Int) -> Outcome {
        let marker = Marker(
            version: 1,
            migratedAt: ChatSyncState.nowISOString(),
            copied: copied, skipped: skipped)
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(marker)
            try FileManager.default.createDirectory(
                at: markerURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try AtomicFile.write(data, to: markerURL, durability: .full)
            return .done(copied: copied, skipped: skipped)
        } catch {
            return .partial(copied: copied, skipped: skipped, failed: 0)
        }
    }

    /// legacyRoot 的一级子目录（sorted 确定序；读失败/缺失 → 空）。
    private func immediateSubdirs(of root: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey]) else { return [] }
        return entries
            .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    /// 子目录下 .jsonl 文件（sorted；只认 .jsonl → sync-state.json/非载荷天然排除）。
    private func jsonlFiles(in dir: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        else { return [] }
        return entries
            .filter { $0.lastPathComponent.hasSuffix(".jsonl") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
}
