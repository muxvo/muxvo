// 归档整文件原子拷贝（dogfood-r5 W-A PR-2）：ChatMirror 与 ChatArchiveMigrator（PR-3）共用。
//
// 为何独立于 MuxvoStorage.AtomicFile：AtomicFile 写「内存 Data → 目标」（自建 tmp、O_EXCL、
// F_FULLFSYNC）；此处是「已存在的源文件 → 目标」的整文件拷贝，须 copyItem（不把可达数 MiB 的会话
// 文件读全量进内存）+ 写回源 mtime（下轮秒级幂等判据）+ rename(2) 原子替换。语义不同故独立入口。
//
// 双写者终态收敛（共享归档池多分身并发镜像同一源文件）三条论证：
//  1. 同内容后到者胜：两写者拷同一源 → 内容逐字节相同，rename 原子替换，谁最后 rename 都落同一内容。
//  2. 旧盖新下轮收敛：若写者 A 拿旧源 mtime、B 拿新源 mtime，B 后到则镜像=新内容+新 mtime；A 后到则
//     镜像=旧内容+旧 mtime，但下轮任一写者 fullScan 秒级对比 源(新) != 镜像(旧) → 必重拷，秒级收敛到新。
//  3. 读者永见完整文件：rename(2) 同卷原子——读者要么见 rename 前的旧完整文件、要么见新完整文件，
//     绝不见半写中间态（temp 不以 .jsonl 结尾，scanner/reader 只认 `.jsonl` 后缀，天然不枚举 temp）。
import Darwin
import Foundation

enum ChatFileOpsError: Error, Equatable {
    case renameFailed(errno: Int32)
}

enum ChatFileOps {
    /// 整文件原子拷贝：createDirectory → copyItem→temp → setAttributes(源 mtime) → rename(2) 原子替换。
    ///
    /// - Parameter mtime: **调用方必须在 copy 前 stat 源得到**（copy 期间源被追加时，旧 mtime 配旧内容 →
    ///   下轮秒级对比 != 必重拷收敛；若 copy 后再 stat，新 mtime 可能配到中途快照/不完整内容，破坏幂等）。
    ///
    /// temp 命名 `.tmp-<destBasename>.<UUID>`（**不以 .jsonl 结尾**——scanner/reader 只枚举 `.jsonl` 后缀，
    /// 天然看不见 temp）。任一步失败尽力删 temp 后 throw（调用方转 .skipped，下轮重试；仅增不删语义不破）。
    static func atomicCopy(from source: URL, to dest: URL, mtime: Date) throws {
        let fm = FileManager.default
        let destDir = dest.deletingLastPathComponent()
        try fm.createDirectory(at: destDir, withIntermediateDirectories: true)
        let temp = destDir.appendingPathComponent(".tmp-\(dest.lastPathComponent).\(UUID().uuidString)")
        do {
            try fm.copyItem(at: source, to: temp)
            // copyItem 不保源 mtime（§6.1）→ 显式写回，令下轮秒级判据幂等。
            try fm.setAttributes([.modificationDate: mtime], ofItemAtPath: temp.path)
            // rename(2) 同卷原子替换（目标存在与否皆可，无「removeItem+copyItem」的非原子空窗）。
            guard Darwin.rename(temp.path, dest.path) == 0 else {
                throw ChatFileOpsError.renameFailed(errno: errno)
            }
        } catch {
            try? fm.removeItem(at: temp)  // 尽力清 temp（本调用独占 UUID，清理绝不碰他人在飞 temp）
            throw error
        }
    }

    /// 纯谓词：是否本入口遗留的孤儿 temp（`.tmp-` 前缀 + 末段可解析为 UUID 的后缀）。严格匹配保证绝不
    /// 误伤 `*.jsonl`（末段 "jsonl" 非 UUID）——temp 非归档载荷，清扫它不违「ChatMirror 仅增不删」红线。
    static func isOrphanTempName(_ name: String) -> Bool {
        guard name.hasPrefix(".tmp-"), let lastDot = name.lastIndex(of: ".") else { return false }
        return UUID(uuidString: String(name[name.index(after: lastDot)...])) != nil
    }
}
