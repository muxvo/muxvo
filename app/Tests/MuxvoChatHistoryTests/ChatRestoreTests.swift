// ChatRestore 会话回填（镜像 → CC 反向通道，chat-data.md 冻结面修订登记①）。
// 全部临时目录注入，绝不碰真 ~/.claude / 真数据根。
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("ChatRestore 回填（镜像→CC 单向；UUID 白名单 + mtime=now + 幂等/不覆盖）")
struct ChatRestoreTests {
    private let fm = FileManager.default

    // 合法小写 UUID（isValidSessionId 白名单）。
    private let sidA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    private let sidB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

    private func write(_ url: URL, _ content: String, mtime: Date? = nil) throws {
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(content.utf8).write(to: url)
        if let mtime { try fm.setAttributes([.modificationDate: mtime], ofItemAtPath: url.path) }
    }

    private func mtime(_ url: URL) -> Date? {
        (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }

    /// 临时单 mirrorRoot + ccProjectsRoot（互不重叠）。PR-4 起 ChatRestore 收多根，单根既有测试用 [mirror] 包一层。
    private func roots(_ root: URL) -> (restore: ChatRestore, mirror: URL, cc: URL) {
        let mirror = root.appendingPathComponent("chat-history", isDirectory: true)
        let cc = root.appendingPathComponent("cc-projects", isDirectory: true)
        return (ChatRestore(mirrorRoots: [mirror], ccProjectsRoot: cc), mirror, cc)
    }

    // MARK: - restored + 内容逐字节相等 + 自动建缺失目录

    @Test("restored：镜像有、CC 无 → 回填成功；dest 内容与镜像逐字节相等；缺失子目录自动建")
    func restoredCopiesBytesAndMakesDir() throws {
        try withTempRoot { root in
            let (r, mirror, cc) = roots(root)
            let hash = "-Users-rl-proj"
            let body = #"{"sessionId":"\#(sidA)","cwd":"/Users/rl/proj"}"# + "\n第二行\n"
            try write(mirror.appendingPathComponent("\(hash)/\(sidA).jsonl"), body)
            #expect(!fm.fileExists(atPath: cc.path))  // CC 根一开始都不在

            #expect(r.restore(sessionId: sidA) == .restored)

            let dest = cc.appendingPathComponent("\(hash)/\(sidA).jsonl")
            #expect(fm.fileExists(atPath: dest.path))  // 缺失子目录已自动建
            let destBytes = try Data(contentsOf: dest)
            #expect(destBytes == Data(body.utf8))  // 逐字节相等
        }
    }

    // MARK: - mtime=now（与源旧 mtime 显著不同）

    @Test("mtime=now：回填后 dest mtime ≈ 现在，与镜像的旧源 mtime 显著不同（否则 CC 下轮 30 天清理立即又删）")
    func restoreRefreshesMtimeToNow() throws {
        try withTempRoot { root in
            let (r, mirror, cc) = roots(root)
            let hash = "-Users-rl-proj"
            let old = Date(timeIntervalSince1970: 1_600_000_000)  // 2020 年，远超 30 天
            try write(mirror.appendingPathComponent("\(hash)/\(sidA).jsonl"), "x", mtime: old)

            #expect(r.restore(sessionId: sidA) == .restored)

            let dest = cc.appendingPathComponent("\(hash)/\(sidA).jsonl")
            let dm = try #require(mtime(dest))
            #expect(abs(dm.timeIntervalSinceNow) < 30)              // ≈ now
            #expect(abs(dm.timeIntervalSince(old)) > 1_000_000)     // 与旧源 mtime 显著不同
        }
    }

    // MARK: - dest 已存在 → 不覆盖

    @Test("alreadyPresent：dest 已存在 → 绝不覆盖，返回 alreadyPresent，dest 内容保持原样")
    func destExistsNeverOverwrites() throws {
        try withTempRoot { root in
            let (r, mirror, cc) = roots(root)
            let hash = "-Users-rl-proj"
            try write(mirror.appendingPathComponent("\(hash)/\(sidA).jsonl"), "MIRROR_NEW")
            try write(cc.appendingPathComponent("\(hash)/\(sidA).jsonl"), "CC_ORIGINAL")

            #expect(r.restore(sessionId: sidA) == .alreadyPresent)

            let dest = cc.appendingPathComponent("\(hash)/\(sidA).jsonl")
            #expect(try Data(contentsOf: dest) == Data("CC_ORIGINAL".utf8))  // 未被覆盖
        }
    }

    // MARK: - 幂等：二跑 alreadyPresent

    @Test("幂等：连跑两次 → 首次 restored、二次 alreadyPresent；内容不变")
    func idempotentSecondRunAlreadyPresent() throws {
        try withTempRoot { root in
            let (r, mirror, cc) = roots(root)
            let hash = "-Users-rl-proj"
            try write(mirror.appendingPathComponent("\(hash)/\(sidA).jsonl"), "content")

            #expect(r.restore(sessionId: sidA) == .restored)
            #expect(r.restore(sessionId: sidA) == .alreadyPresent)

            let dest = cc.appendingPathComponent("\(hash)/\(sidA).jsonl")
            #expect(try Data(contentsOf: dest) == Data("content".utf8))
        }
    }

    // MARK: - archiveMissing

    @Test("archiveMissing：镜像与 CC 均无该会话 → archiveMissing（无从回填）")
    func archiveMissingWhenNowhere() throws {
        try withTempRoot { root in
            let (r, mirror, _) = roots(root)
            // 镜像里有别的会话，但不含 sidA
            try write(mirror.appendingPathComponent("-Users-rl-proj/\(sidB).jsonl"), "other")
            #expect(r.restore(sessionId: sidA) == .archiveMissing)
        }
    }

    @Test("镜像已删但 CC 仍有 → alreadyPresent（先查 dest 是否已在，再 archiveMissing）")
    func mirrorGoneButCcHasIt() throws {
        try withTempRoot { root in
            let (r, _, cc) = roots(root)
            // 镜像空；CC 里已有 sidA（镜像已被清、CC 未清的场景）
            try write(cc.appendingPathComponent("-Users-rl-proj/\(sidA).jsonl"), "present")
            #expect(r.restore(sessionId: sidA) == .alreadyPresent)
        }
    }

    // MARK: - worktree 型目录名原样保留

    @Test("worktree 型目录名（--worktrees- hash 目录）原样保留，dest 落同名子目录")
    func worktreeDirNamePreserved() throws {
        try withTempRoot { root in
            let (r, mirror, cc) = roots(root)
            let wtHash = "-Users-rl-proj--worktrees-wt-1"
            try write(mirror.appendingPathComponent("\(wtHash)/\(sidA).jsonl"), "wt")

            #expect(r.restore(sessionId: sidA) == .restored)

            // dest 落在与镜像逐字节同名的子目录（与 CC 同构，回查次序自然对应）
            let dest = cc.appendingPathComponent("\(wtHash)/\(sidA).jsonl")
            #expect(fm.fileExists(atPath: dest.path))
        }
    }

    // MARK: - PR-4 多根按序命中（共享池优先、legacy 兜底、都无 archiveMissing）

    @Test("多根按序：池与 legacy 同 sid → 回填池版本（池优先）；仅 legacy 有 → legacy 兜底；两根皆无 → archiveMissing")
    func multiRootOrderedFirstMatch() throws {
        try withTempRoot { root in
            let pool = root.appendingPathComponent("shared-chat-history", isDirectory: true)
            let legacy = root.appendingPathComponent("chat-history", isDirectory: true)
            let cc = root.appendingPathComponent("cc-projects", isDirectory: true)
            let r = ChatRestore(mirrorRoots: [pool, legacy], ccProjectsRoot: cc)  // 池排前
            let hash = "-Users-rl-proj"

            // (1) 池优先：sidA 在池与 legacy 都有、内容不同 → 回填池版本。
            try write(pool.appendingPathComponent("\(hash)/\(sidA).jsonl"), "POOL_A")
            try write(legacy.appendingPathComponent("\(hash)/\(sidA).jsonl"), "LEGACY_A")
            #expect(r.restore(sessionId: sidA) == .restored)
            #expect(try Data(contentsOf: cc.appendingPathComponent("\(hash)/\(sidA).jsonl")) == Data("POOL_A".utf8))

            // (2) legacy 兜底：sidB 只在 legacy → legacy 命中回填。
            try write(legacy.appendingPathComponent("\(hash)/\(sidB).jsonl"), "LEGACY_B")
            #expect(r.restore(sessionId: sidB) == .restored)
            #expect(try Data(contentsOf: cc.appendingPathComponent("\(hash)/\(sidB).jsonl")) == Data("LEGACY_B".utf8))

            // (3) 两根皆无 → archiveMissing。
            let sidC = "cccccccc-cccc-cccc-cccc-cccccccccccc"
            #expect(r.restore(sessionId: sidC) == .archiveMissing)
        }
    }

    // MARK: - 非 UUID 拒绝（防路径注入）

    @Test("非 UUID 拒绝：路径注入串/前导-/长度错/大写 → failed，绝不写 CC")
    func rejectsNonUuid() throws {
        try withTempRoot { root in
            let (r, _, cc) = roots(root)
            for bad in [
                "../../etc/passwd",
                "-rf",
                "not-a-uuid",
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa",     // 尾段 11 位（短一位）
                "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",     // 大写非白名单
                "",
            ] {
                if case .failed = r.restore(sessionId: bad) { } else {
                    Issue.record("应拒绝非法 sessionId: \(bad)")
                }
            }
            #expect(!fm.fileExists(atPath: cc.path))  // 全程绝不写 CC
        }
    }
}
