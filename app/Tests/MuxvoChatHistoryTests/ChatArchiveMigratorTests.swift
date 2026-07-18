// ChatArchiveMigrator（dogfood-r5 W-A PR-3，未接线）：一次性 legacy 镜像 → 共享归档池迁移。
// 覆盖：shouldReplace 四象限 / dest 缺失拷贝保 mtime / marker 幂等短路 / 无 marker 重跑 compare-skip
// 收敛 / legacy 缺失即 seal / legacy==shared no-op / sync-state.json 不进池 / 不可读文件 → partial 不 seal。
import Foundation
import Testing

import MuxvoStorage
import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("归档迁移器（一次性 legacy→共享池，marker 后置 + 对比-跳过幂等）")
struct ChatArchiveMigratorTests {
    private let fm = FileManager.default

    private func sub(_ base: URL, _ comps: String...) -> URL {
        comps.reduce(base) { $0.appendingPathComponent($1) }
    }

    private func writeFile(_ url: URL, _ content: String, mtime: Date? = nil) throws {
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(content.utf8).write(to: url)
        if let mtime { try fm.setAttributes([.modificationDate: mtime], ofItemAtPath: url.path) }
    }

    private func mtimeSeconds(_ url: URL) -> Int? {
        guard let attrs = try? fm.attributesOfItem(atPath: url.path),
              let date = attrs[.modificationDate] as? Date else { return nil }
        return Int(date.timeIntervalSince1970.rounded(.down))
    }

    /// 装配：legacy / shared / marker 三根互不重叠。
    private func roots(_ root: URL) -> (legacy: URL, shared: URL, marker: URL) {
        (root.appendingPathComponent("legacy/chat-history"),
         root.appendingPathComponent("shared/chat-history"),
         root.appendingPathComponent("shared/state/chat-archive-migrated.json"))
    }

    // MARK: - shouldReplace 四象限

    @Test("shouldReplace 四象限：srcSec 大→替换；srcSec 小→不替换；同秒 srcSize 大→替换；同秒 srcSize ≤→不替换")
    func shouldReplace_four_quadrants() {
        // 主序：mtime 秒
        #expect(ChatArchiveMigrator.shouldReplace(srcSec: 200, srcSize: 1, destSec: 100, destSize: 999))   // 新者胜
        #expect(!ChatArchiveMigrator.shouldReplace(srcSec: 100, srcSize: 999, destSec: 200, destSize: 1))  // 旧者不替换
        // 次序：同秒比 size
        #expect(ChatArchiveMigrator.shouldReplace(srcSec: 100, srcSize: 50, destSec: 100, destSize: 40))   // 大者胜
        #expect(!ChatArchiveMigrator.shouldReplace(srcSec: 100, srcSize: 40, destSec: 100, destSize: 50))  // 小者不替换
        #expect(!ChatArchiveMigrator.shouldReplace(srcSec: 100, srcSize: 50, destSec: 100, destSize: 50))  // 相等→跳过
    }

    // MARK: - dest 缺失拷贝 + mtime 保留

    @Test("dest 缺失：原子拷进池、内容==源、mtime 保留（秒级）、outcome=.done、marker 落盘")
    func dest_missing_copies_and_preserves_mtime() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            let t = Date(timeIntervalSince1970: 1_700_000_123)
            try writeFile(sub(legacy, "proj", "s1.jsonl"), "PAYLOAD", mtime: t)
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)

            let out = mig.migrateIfNeeded()
            #expect(out == .done(copied: 1, skipped: 0))
            let dest = sub(shared, "proj", "s1.jsonl")
            #expect((try? String(contentsOf: dest, encoding: .utf8)) == "PAYLOAD")
            #expect(mtimeSeconds(dest) == Int(t.timeIntervalSince1970.rounded(.down)))  // 保 legacy mtime
            #expect(fm.fileExists(atPath: marker.path))
        }
    }

    // MARK: - M7 批3 §7.2：marker 计数读取（首启迁移提示判「本次迁移有命中」copied>0）

    @Test("migrationCounts：读已落 marker 的 copied/skipped；marker 缺失/损坏 → nil")
    func migrationCounts_reads_marker() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            // marker 缺失 → nil。
            #expect(ChatArchiveMigrator.migrationCounts(markerURL: marker) == nil)
            // 迁两会话（一拷一 skip）后 marker 落，计数可读。
            try writeFile(sub(legacy, "P", "a.jsonl"), "A", mtime: Date(timeIntervalSince1970: 100))
            try writeFile(sub(shared, "P", "b.jsonl"), "B", mtime: Date(timeIntervalSince1970: 100))
            try writeFile(sub(legacy, "P", "b.jsonl"), "B", mtime: Date(timeIntervalSince1970: 100))  // == 池内 → skip
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)
            #expect(mig.migrateIfNeeded() == .done(copied: 1, skipped: 1))
            let counts = ChatArchiveMigrator.migrationCounts(markerURL: marker)
            #expect(counts?.copied == 1)
            #expect(counts?.skipped == 1)
            // 损坏 marker → nil（非崩）。
            try Data("{not json".utf8).write(to: marker)
            #expect(ChatArchiveMigrator.migrationCounts(markerURL: marker) == nil)
        }
    }

    // MARK: - marker 幂等短路（零 I/O）

    @Test("marker 已在：重跑立即 .skippedMarker，不再拷（dest 内容不被二次写）")
    func marker_present_short_circuits() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            try writeFile(sub(legacy, "proj", "s1.jsonl"), "V1", mtime: Date(timeIntervalSince1970: 100))
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)
            #expect(mig.migrateIfNeeded() == .done(copied: 1, skipped: 0))
            // 源改内容（若不短路会被重拷），marker 在 → 应短路
            try writeFile(sub(legacy, "proj", "s1.jsonl"), "V2", mtime: Date(timeIntervalSince1970: 999))
            #expect(mig.migrateIfNeeded() == .skippedMarker)
            #expect((try? String(contentsOf: sub(shared, "proj", "s1.jsonl"), encoding: .utf8)) == "V1")  // 未二次写
        }
    }

    // MARK: - 无 marker 重跑 compare-skip 收敛幂等

    @Test("无 marker 重跑：dest 已存在且相等 → 全跳过（compare-skip 幂等），copied=0/skipped=N")
    func no_marker_rerun_converges_idempotent() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            try writeFile(sub(legacy, "pA", "a.jsonl"), "A", mtime: Date(timeIntervalSince1970: 100))
            try writeFile(sub(legacy, "pB", "b.jsonl"), "B", mtime: Date(timeIntervalSince1970: 200))
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)

            #expect(mig.migrateIfNeeded() == .done(copied: 2, skipped: 0))
            try fm.removeItem(at: marker)  // 模拟上次 partial/marker 缺失
            #expect(mig.migrateIfNeeded() == .done(copied: 0, skipped: 2))  // dest 相等 → 全跳过
            #expect(fm.fileExists(atPath: marker.path))  // 二次跑重新落 marker
        }
    }

    // MARK: - legacy 缺失即 seal

    @Test("legacy 根缺失：不拷、立即 seal（.done(0,0) + marker）")
    func legacy_missing_seals_immediately() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)  // legacy 目录从不建
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)
            #expect(mig.migrateIfNeeded() == .done(copied: 0, skipped: 0))
            #expect(fm.fileExists(atPath: marker.path))
        }
    }

    // MARK: - legacy == shared no-op

    @Test("legacy 与 shared 同路径：no-op seal（.done(0,0)，不自拷）")
    func legacy_equals_shared_noop() throws {
        try withTempRoot { root in
            let same = root.appendingPathComponent("chat-history")
            let marker = root.appendingPathComponent("state/chat-archive-migrated.json")
            try writeFile(sub(same, "proj", "s1.jsonl"), "X", mtime: Date(timeIntervalSince1970: 100))
            let mig = ChatArchiveMigrator(legacyRoot: same, sharedRoot: same, markerURL: marker)
            #expect(mig.migrateIfNeeded() == .done(copied: 0, skipped: 0))
            #expect(fm.fileExists(atPath: marker.path))
            // 未自拷/未改
            #expect((try? String(contentsOf: sub(same, "proj", "s1.jsonl"), encoding: .utf8)) == "X")
        }
    }

    // MARK: - sync-state.json / 非 .jsonl 不进池

    @Test("只 .jsonl 进池：sync-state.json（top-level）与子目录内非 .jsonl 均不迁")
    func only_jsonl_enters_pool() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            try writeFile(sub(legacy, "sync-state.json"), "{}")             // top-level，非子目录
            try writeFile(sub(legacy, "proj", "s1.jsonl"), "OK", mtime: Date(timeIntervalSince1970: 1))
            try writeFile(sub(legacy, "proj", "notes.txt"), "junk")         // 子目录内非 .jsonl
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)

            #expect(mig.migrateIfNeeded() == .done(copied: 1, skipped: 0))  // 仅 s1.jsonl
            #expect(fm.fileExists(atPath: sub(shared, "proj", "s1.jsonl").path))
            #expect(!fm.fileExists(atPath: sub(shared, "sync-state.json").path))
            #expect(!fm.fileExists(atPath: sub(shared, "proj", "notes.txt").path))
        }
    }

    // MARK: - plan()（dry-run 预估，legacy-archive-reclaim 批）

    @Test("plan 计数：dest 缺失→toCopy(+bytes)；dest 旧→toReplace(+bytes)；dest 新/相等→toSkip")
    func plan_counts_copy_replace_skip() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            // toCopy：dest 缺失（7 字节）
            try writeFile(sub(legacy, "pA", "new.jsonl"), "PAYLOAD", mtime: Date(timeIntervalSince1970: 100))
            // toReplace：dest 旧（src 5 字节，mtime 更新）
            try writeFile(sub(legacy, "pB", "upd.jsonl"), "NEWER", mtime: Date(timeIntervalSince1970: 200))
            try writeFile(sub(shared, "pB", "upd.jsonl"), "OLD", mtime: Date(timeIntervalSince1970: 100))
            // toSkip：dest 相等
            try writeFile(sub(legacy, "pC", "same.jsonl"), "EQ", mtime: Date(timeIntervalSince1970: 300))
            try writeFile(sub(shared, "pC", "same.jsonl"), "EQ", mtime: Date(timeIntervalSince1970: 300))
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)

            let plan = mig.plan()
            #expect(plan == ChatArchiveMigrator.DryRunSummary(
                toCopy: 1, toReplace: 1, toSkip: 1, unreadable: 0,
                toCopyBytes: 7, toReplaceBytes: 5))
        }
    }

    @Test("plan 只读：不建 dest 目录、不写文件、不落 marker；marker 已在也照常预估（不看 marker）")
    func plan_is_read_only_and_ignores_marker() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            try writeFile(sub(legacy, "proj", "s1.jsonl"), "PAYLOAD", mtime: Date(timeIntervalSince1970: 100))
            // marker 预置：plan 不看 marker，照常报 toCopy=1（migrate 则会短路）
            try writeFile(marker, "{}")
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)

            let plan = mig.plan()
            #expect(plan.toCopy == 1)
            #expect(!fm.fileExists(atPath: shared.path))  // dest 根都不建
            #expect((try? String(contentsOf: marker, encoding: .utf8)) == "{}")  // marker 未被动
        }
    }

    @Test("plan↔migrate 对齐（无 marker、全可读）：toCopy+toReplace==copied、toSkip==skipped")
    func plan_matches_migrate_outcome() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            try writeFile(sub(legacy, "pA", "a.jsonl"), "AAAA", mtime: Date(timeIntervalSince1970: 100))
            try writeFile(sub(legacy, "pA", "b.jsonl"), "BB", mtime: Date(timeIntervalSince1970: 200))
            try writeFile(sub(legacy, "pB", "c.jsonl"), "CCC", mtime: Date(timeIntervalSince1970: 300))
            try writeFile(sub(shared, "pB", "c.jsonl"), "C", mtime: Date(timeIntervalSince1970: 100))  // 将被替换
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)

            let plan = mig.plan()
            let out = mig.migrateIfNeeded()
            #expect(out == .done(copied: plan.toCopy + plan.toReplace, skipped: plan.toSkip))
            // 复跑 plan（dest 已同步）：全 skip
            let plan2 = mig.plan()
            #expect(plan2 == ChatArchiveMigrator.DryRunSummary(toSkip: 3))
        }
    }

    @Test("plan：legacy 与 shared 同路径 → 全零（真迁移同为 no-op）；legacy 缺失 → 全零")
    func plan_same_path_and_missing_legacy_zero() throws {
        try withTempRoot { root in
            let same = root.appendingPathComponent("chat-history")
            let marker = root.appendingPathComponent("state/m.json")
            try writeFile(sub(same, "proj", "s1.jsonl"), "X", mtime: Date(timeIntervalSince1970: 100))
            #expect(ChatArchiveMigrator(legacyRoot: same, sharedRoot: same, markerURL: marker).plan()
                == ChatArchiveMigrator.DryRunSummary())
            let missing = root.appendingPathComponent("nope/chat-history")
            let shared = root.appendingPathComponent("shared/chat-history")
            #expect(ChatArchiveMigrator(legacyRoot: missing, sharedRoot: shared, markerURL: marker).plan()
                == ChatArchiveMigrator.DryRunSummary())
        }
    }

    @Test("plan：源 stat 失败（悬空 symlink）计 unreadable；migrate 同源计 failed→partial 不 seal")
    func plan_counts_unreadable_and_migrate_fails_partial() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            try writeFile(sub(legacy, "proj", "good.jsonl"), "OK", mtime: Date(timeIntervalSince1970: 100))
            let dangling = sub(legacy, "proj", "zbroken.jsonl")  // 排序在 good 后
            try fm.createSymbolicLink(
                at: dangling, withDestinationURL: root.appendingPathComponent("nonexistent"))
            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)

            let plan = mig.plan()
            #expect(plan.toCopy == 1)
            #expect(plan.unreadable == 1)
            #expect(mig.migrateIfNeeded() == .partial(copied: 1, skipped: 0, failed: 1))
            #expect(!fm.fileExists(atPath: marker.path))  // 有失败不 seal
        }
    }

    // MARK: - 不可读文件 → partial 不写 marker

    @Test("有硬失败（不可读源）：copied 计成功项、failed 计失败项、outcome=.partial、marker 不写（下次重跑）")
    func unreadable_source_yields_partial_no_marker() throws {
        try withTempRoot { root in
            let (legacy, shared, marker) = roots(root)
            try writeFile(sub(legacy, "proj", "good.jsonl"), "GOOD", mtime: Date(timeIntervalSince1970: 100))
            let bad = sub(legacy, "proj", "zbad.jsonl")  // 排序在 good 之后，先拷 good 成功
            try writeFile(bad, "BAD", mtime: Date(timeIntervalSince1970: 100))
            try fm.setAttributes([.posixPermissions: 0o000], ofItemAtPath: bad.path)  // 拷贝 EACCES
            defer { try? fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: bad.path) }

            let mig = ChatArchiveMigrator(legacyRoot: legacy, sharedRoot: shared, markerURL: marker)
            #expect(mig.migrateIfNeeded() == .partial(copied: 1, skipped: 0, failed: 1))
            #expect(fm.fileExists(atPath: sub(shared, "proj", "good.jsonl").path))  // 成功项已落
            #expect(!fm.fileExists(atPath: marker.path))                            // 有失败 → 不 seal
        }
    }
}
