// CD_mirror_* / CD_syncstate_* 案例池（chat-data.md §6 镜像/归档，LIVE 权威 = legacy chat-archive.ts）
// + DATA_L1_06/07 翻牌（裁决 C，§6.3）：镜像实况结构（扁平 jsonl + sync-state.json，无
// project-info.json/history-index.jsonl）与 sync-state.json 格式。
//
// 手法：临时源树 + setAttributes 精确控 mtime；幂等断言 = 连跑两轮第二轮 copy 数 = 0（§8.3）。
import Foundation
import Testing

import MuxvoStorage
import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("镜像/归档（§6 秒级对比 + 写回 mtime + 仅增不删 + 只读降级）")
struct ChatMirrorTests {
    private let fm = FileManager.default

    // MARK: - 工具

    private func sub(_ base: URL, _ comps: String...) -> URL {
        comps.reduce(base) { $0.appendingPathComponent($1) }
    }

    private func writeFile(_ url: URL, _ content: String, mtime: Date? = nil) throws {
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(content.utf8).write(to: url)
        if let mtime {
            try fm.setAttributes([.modificationDate: mtime], ofItemAtPath: url.path)
        }
    }

    /// 文件 mtime 的整秒（floor）；缺失 → nil。
    private func mtimeSeconds(_ url: URL) -> Int? {
        guard let attrs = try? fm.attributesOfItem(atPath: url.path),
              let date = attrs[.modificationDate] as? Date else { return nil }
        return Int(date.timeIntervalSince1970.rounded(.down))
    }

    // MARK: - CD_mirror_mtime_second_compare

    @Test("CD_mirror_mtime_second_compare：两侧 floor(mtime/1000) 相等即跳过，不等才 copy，镜像缺失记 0 必 copy")
    func CD_mirror_mtime_second_compare() throws {
        // 单文件场景：给定源 mtime 与（可选）镜像 mtime，跑一轮 fullScan，返回 copy 数。
        func runSingle(source: Date, mirror mm: Date?) throws -> Int {
            try withTempRoot { root in
                let src = root.appendingPathComponent("src")
                let data = root.appendingPathComponent("data")
                try writeFile(sub(src, "proj", "s1.jsonl"), "x", mtime: source)
                let m = ChatMirror(sourceRoot: src, dataRoot: data)
                if let mm { try writeFile(sub(m.mirrorRoot, "proj", "s1.jsonl"), "OLD", mtime: mm) }
                return m.fullScan().synced
            }
        }
        let t = Date(timeIntervalSince1970: 1_700_000_000)
        let missing = try runSingle(source: t, mirror: nil)
        #expect(missing == 1) // 镜像缺失记 0 → 必 copy
        let sameSecond = try runSingle(source: t, mirror: t)
        #expect(sameSecond == 0) // 秒级相等 → 跳过
        let diffSecond = try runSingle(source: t, mirror: t.addingTimeInterval(-5))
        #expect(diffSecond == 1) // 秒级不等 → copy
        let subSecond = try runSingle(source: t.addingTimeInterval(0.7), mirror: t)
        #expect(subSecond == 0) // 亚秒差同秒 → 跳过（避坚果云/copy 抖动误判）
    }

    // MARK: - CD_mirror_copy_writes_back_mtime

    @Test("CD_mirror_copy_writes_back_mtime：copy 后镜像 mtime 写回源 mtime；连跑两轮第二轮 copy 数 = 0（幂等）")
    func CD_mirror_copy_writes_back_mtime() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            let srcMtime = Date(timeIntervalSince1970: 1_700_000_123.456)
            try writeFile(sub(src, "proj", "s1.jsonl"), "hello", mtime: srcMtime)
            let m = ChatMirror(sourceRoot: src, dataRoot: data)

            let r1 = m.fullScan()
            #expect(r1.synced == 1)
            let mirrorFile = sub(m.mirrorRoot, "proj", "s1.jsonl")
            #expect(fm.fileExists(atPath: mirrorFile.path))
            // 写回：镜像秒级 == 源秒级（若未写回则 = 复制时刻 now，与 1_700_000_123 天差地别）
            #expect(mtimeSeconds(mirrorFile) == Int(srcMtime.timeIntervalSince1970.rounded(.down)))

            // 幂等：源未变 → 第二轮 copy 数 = 0
            let r2 = m.fullScan()
            #expect(r2.synced == 0)
            #expect(r2.total == 0)
        }
    }

    // MARK: - fullScan onProgress（两段化，行为恒等加性；冻结面修订登记③）

    @Test("fullScan onProgress：进度单调递增、末帧 processed==total；total 恒定")
    func fullScan_onProgress_monotonic_to_total() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            try writeFile(sub(src, "pA", "s1.jsonl"), "a", mtime: Date(timeIntervalSince1970: 100))
            try writeFile(sub(src, "pA", "s2.jsonl"), "b", mtime: Date(timeIntervalSince1970: 200))
            try writeFile(sub(src, "pB", "s3.jsonl"), "c", mtime: Date(timeIntervalSince1970: 300))
            let m = ChatMirror(sourceRoot: src, dataRoot: data)

            var frames: [(processed: Int, total: Int)] = []
            let r = m.fullScan { processed, total in frames.append((processed, total)) }

            #expect(r.synced == 3)
            #expect(r.total == 3)
            #expect(frames.map(\.processed) == [1, 2, 3])       // 单调递增到 total
            #expect(frames.map(\.total).allSatisfy { $0 == 3 }) // total 恒定
            #expect(frames.last?.processed == frames.last?.total)  // 末帧 processed==total
        }
    }

    @Test("fullScan onProgress：0 任务（源未变第二轮）→ 回调一次 (0,0) 供上层推「已完成」末帧")
    func fullScan_onProgress_zero_task_frame() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            try writeFile(sub(src, "pA", "s1.jsonl"), "a", mtime: Date(timeIntervalSince1970: 100))
            let m = ChatMirror(sourceRoot: src, dataRoot: data)
            _ = m.fullScan()  // 首轮 copy 掉

            var frames: [(processed: Int, total: Int)] = []
            let r = m.fullScan { p, t in frames.append((p, t)) }  // 源未变 → 0 任务
            #expect(r.synced == 0)
            #expect(r.total == 0)
            #expect(frames.count == 1)
            #expect(frames.first?.processed == 0)
            #expect(frames.first?.total == 0)
        }
    }

    @Test("fullScan：带回调与不带回调 SyncResult 逐字段恒等（加性，不改返回/落盘）")
    func fullScan_result_identical_with_without_callback() throws {
        func run(withCallback: Bool) throws -> ChatMirror.SyncResult {
            try withTempRoot { root in
                let src = root.appendingPathComponent("src")
                let data = root.appendingPathComponent("data")
                try writeFile(sub(src, "pA", "s1.jsonl"), "a", mtime: Date(timeIntervalSince1970: 100))
                try writeFile(sub(src, "pB", "s2.jsonl"), "b", mtime: Date(timeIntervalSince1970: 200))
                let m = ChatMirror(sourceRoot: src, dataRoot: data)
                return withCallback ? m.fullScan { _, _ in } : m.fullScan()
            }
        }
        #expect(try run(withCallback: true) == run(withCallback: false))
    }

    // MARK: - 镜像仅增不删（写入面兜底；对应池名的 reader 合并面 archiveOnly 归 A2-1）

    @Test("mirror 全量扫仅增不删：源删 session → 镜像文件仍在（写入面兜底，reader 合并 archiveOnly 归 A2-1）")
    func mirror_fullScan_never_deletes() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            let fileA = sub(src, "projA", "a.jsonl")
            let fileB = sub(src, "projB", "b.jsonl")
            try writeFile(fileA, "A", mtime: Date(timeIntervalSince1970: 1_700_000_000))
            try writeFile(fileB, "B", mtime: Date(timeIntervalSince1970: 1_700_000_100))
            let m = ChatMirror(sourceRoot: src, dataRoot: data)
            _ = m.fullScan()
            let mirrorA = sub(m.mirrorRoot, "projA", "a.jsonl")
            let mirrorB = sub(m.mirrorRoot, "projB", "b.jsonl")
            #expect(fm.fileExists(atPath: mirrorA.path))
            #expect(fm.fileExists(atPath: mirrorB.path))

            // 源删掉 A，再同步
            try fm.removeItem(at: fileA)
            _ = m.fullScan()
            #expect(!fm.fileExists(atPath: fileA.path))    // 源确已删
            #expect(fm.fileExists(atPath: mirrorA.path))   // 镜像仍在（仅增不删）
            #expect(fm.fileExists(atPath: mirrorB.path))
        }
    }

    // MARK: - CD_mirror_data_root_not_dotmuxvo

    @Test("CD_mirror_data_root_not_dotmuxvo：镜像落 <dataRoot>/chat-history/（经 DataDirectory 派生），绝不写 ~/.muxvo")
    func CD_mirror_data_root_not_dotmuxvo() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            let m = ChatMirror(sourceRoot: src, dataRoot: data)
            // 路径唯一权威 = DataDirectory 布局
            #expect(m.mirrorRoot == DataDirectory.chatHistoryDirectoryURL(under: data))
            #expect(m.syncStateURL == DataDirectory.chatSyncStateURL(under: data))
            #expect(m.mirrorRoot.path.hasPrefix(data.path))
            #expect(!m.mirrorRoot.path.contains(".muxvo"))

            try writeFile(sub(src, "proj", "s1.jsonl"), "{}")
            _ = m.fullScan()
            let copied = sub(m.mirrorRoot, "proj", "s1.jsonl")
            #expect(fm.fileExists(atPath: copied.path))
            #expect(copied.path.hasPrefix(data.path))    // 产物落数据根内
            #expect(!copied.path.contains(".muxvo"))
        }
    }

    // MARK: - CD_mirror_readonly_degrade

    @Test("CD_mirror_readonly_degrade：镜像根不可写 → readonly + warning 文案，不 crash、不 copy")
    func CD_mirror_readonly_degrade() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            try writeFile(sub(src, "proj", "s1.jsonl"), "{}")
            let m = ChatMirror(sourceRoot: src, dataRoot: data)
            // 预建镜像根并去写权限
            try fm.createDirectory(at: m.mirrorRoot, withIntermediateDirectories: true)
            try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: m.mirrorRoot.path)
            defer { try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: m.mirrorRoot.path) }

            let r = m.fullScan()
            #expect(r.mode == .readonly)
            #expect(r.warning == ChatMirror.readonlyWarning)
            #expect(r.synced == 0)
            #expect(!fm.fileExists(atPath: sub(m.mirrorRoot, "proj", "s1.jsonl").path))
        }
    }

    // MARK: - CD_syncstate_schema

    @Test("CD_syncstate_schema：sync-state.json = {lastSync: ISO, fileMtime: {path→mtimeMs}}；round-trip + 容错自愈")
    func CD_syncstate_schema() throws {
        // round-trip
        let state = ChatSyncState(
            lastSync: "2026-07-06T12:34:56.789Z", fileMtime: ["projA/a.jsonl": 1_700_000_000_000])
        let data = try state.serialized()
        #expect(ChatSyncState.parse(data) == state)
        // schema shape：顶层恰 {lastSync, fileMtime}
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        #expect(Set(obj.keys) == ["lastSync", "fileMtime"])
        #expect(obj["lastSync"] is String)
        #expect(obj["fileMtime"] is [String: Any])
        // 容错自愈：坏 JSON → nil；缺失文件 → nil
        #expect(ChatSyncState.parse(Data("not json".utf8)) == nil)
        try withTempRoot { root in
            #expect(ChatSyncState.load(from: root.appendingPathComponent("nope.json")) == nil)
        }
    }

    // MARK: - DATA_L1_06 翻牌（镜像实况结构 = 裁决 C）

    @Test("DATA_L1_06: 镜像目录结构 —— 实况 = 扁平 <projectHash>/<sessionId>.jsonl + sync-state.json，无 project-info.json/history-index.jsonl（裁决 C，§6.3）")
    func DATA_L1_06_mirror_structure() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            try writeFile(sub(src, "projA", "s1.jsonl"), "{}", mtime: Date(timeIntervalSince1970: 1))
            try writeFile(sub(src, "projA", "s2.jsonl"), "{}", mtime: Date(timeIntervalSince1970: 2))
            try writeFile(sub(src, "projB", "s3.jsonl"), "{}", mtime: Date(timeIntervalSince1970: 3))
            let m = ChatMirror(sourceRoot: src, dataRoot: data)
            _ = m.fullScan()

            // 实况扁平结构 + sync-state.json
            #expect(fm.fileExists(atPath: sub(m.mirrorRoot, "projA", "s1.jsonl").path))
            #expect(fm.fileExists(atPath: sub(m.mirrorRoot, "projA", "s2.jsonl").path))
            #expect(fm.fileExists(atPath: sub(m.mirrorRoot, "projB", "s3.jsonl").path))
            #expect(fm.fileExists(atPath: m.syncStateURL.path))

            // 裁决 C 砍掉的死缓存结构一律不出现
            let all = fm.enumerator(at: m.mirrorRoot, includingPropertiesForKeys: nil)?
                .compactMap { $0 as? URL } ?? []
            let names = Set(all.map { $0.lastPathComponent })
            #expect(!names.contains("project-info.json"))
            #expect(!names.contains("history-index.jsonl"))
            #expect(!names.contains("projects")) // 无 projects/ 包裹层
            #expect(!names.contains("sessions")) // 无 sessions/ 包裹层
        }
    }

    // MARK: - DATA_L1_07 翻牌（sync-state.json 格式）

    @Test("DATA_L1_07: sync-state.json 格式 —— {lastSync: ISO, fileMtime: {相对路径→mtimeMs}}（裁决 C，§6.3）")
    func DATA_L1_07_syncstate_format() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let data = root.appendingPathComponent("data")
            let mtimeA = Date(timeIntervalSince1970: 1_700_000_000.5)
            try writeFile(sub(src, "projA", "a.jsonl"), "{}", mtime: mtimeA)
            let m = ChatMirror(sourceRoot: src, dataRoot: data)
            _ = m.fullScan()

            let raw = try Data(contentsOf: m.syncStateURL)
            let obj = try JSONSerialization.jsonObject(with: raw) as! [String: Any]
            #expect(Set(obj.keys) == ["lastSync", "fileMtime"])
            // lastSync = ISO8601 毫秒（YYYY-MM-DDTHH:MM:SS.mmmZ）
            let iso = obj["lastSync"] as! String
            let isoOk = iso.range(
                of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#, options: .regularExpression) != nil
            #expect(isoOk)
            // fileMtime：相对路径 → 数字 mtime（记录源 mtime；秒级对齐，避亚毫秒 FP 抖动）
            let fileMtime = obj["fileMtime"] as! [String: Any]
            #expect(fileMtime.keys.contains("projA/a.jsonl"))
            let recorded = (fileMtime["projA/a.jsonl"] as? NSNumber)?.doubleValue
            #expect(recorded != nil && recorded! > 0)
            #expect(recorded.map { Int(($0 / 1000).rounded(.down)) }
                == Int(mtimeA.timeIntervalSince1970.rounded(.down)))

            // 可被 ChatSyncState.load 解析（消费者面）
            let parsed = ChatSyncState.load(from: m.syncStateURL)
            #expect(parsed != nil)
            #expect(parsed?.fileMtime["projA/a.jsonl"] != nil)
        }
    }

    // MARK: - dogfood-r5 PR-2 原子写加固（ChatFileOps.atomicCopy + 孤儿清扫 + 并发双写者收敛）

    @Test("atomicCopy temp 命名不以 .jsonl 结尾（scanner 天然不见）；isOrphanTempName 严格匹配")
    func atomicCopy_temp_naming_discipline() {
        // 构造与 atomicCopy 同款 temp 名：`.tmp-<destBasename>.<UUID>`
        let tempName = ".tmp-s1.jsonl.\(UUID().uuidString)"
        #expect(!tempName.hasSuffix(".jsonl"))            // 关键：不以 .jsonl 结尾
        #expect(ChatFileOps.isOrphanTempName(tempName))   // 本入口 temp 被识别
        // 反例：真归档载荷/目录/畸形名绝不被当孤儿
        #expect(!ChatFileOps.isOrphanTempName("s1.jsonl"))                 // .jsonl 载荷
        #expect(!ChatFileOps.isOrphanTempName("projA"))                   // 目录名
        #expect(!ChatFileOps.isOrphanTempName(".tmp-s1.jsonl.not-a-uuid")) // 末段非 UUID
        #expect(!ChatFileOps.isOrphanTempName(".tmp-s1.jsonl"))           // 无 UUID 后缀
    }

    @Test("atomicCopy：源缺失 → 抛错且 destDir 无 .tmp-* 残留、dest 未生成")
    func atomicCopy_failure_leaves_no_residue() throws {
        try withTempRoot { root in
            let source = root.appendingPathComponent("nope.jsonl")  // 不存在
            let dest = sub(root, "mirror", "proj", "s1.jsonl")
            let destDir = dest.deletingLastPathComponent()
            #expect(throws: (any Error).self) {
                try ChatFileOps.atomicCopy(from: source, to: dest, mtime: Date())
            }
            #expect(!fm.fileExists(atPath: dest.path))
            let entries = (try? fm.contentsOfDirectory(atPath: destDir.path)) ?? []
            #expect(entries.allSatisfy { !$0.hasPrefix(".tmp-") })  // 无 temp 残留
            #expect(entries.isEmpty)                                // destDir 干净
        }
    }

    @Test("atomicCopy：成功拷内容 + 写回指定 mtime + 原子覆盖已存在目标")
    func atomicCopy_success_and_atomic_overwrite() throws {
        try withTempRoot { root in
            let source = sub(root, "src", "s1.jsonl")
            let dest = sub(root, "mirror", "proj", "s1.jsonl")
            let mtime = Date(timeIntervalSince1970: 1_700_000_123)
            try writeFile(source, "NEW-CONTENT")
            try writeFile(dest, "OLD-CONTENT", mtime: Date(timeIntervalSince1970: 1_600_000_000)) // 预置旧目标
            try ChatFileOps.atomicCopy(from: source, to: dest, mtime: mtime)
            #expect((try? String(contentsOf: dest, encoding: .utf8)) == "NEW-CONTENT")  // 原子覆盖
            #expect(mtimeSeconds(dest) == Int(mtime.timeIntervalSince1970.rounded(.down))) // 写回指定 mtime
        }
    }

    @Test("孤儿清扫三态：mtime>1h temp 删／新 temp 留／.jsonl 永不删（仅增不删红线）")
    func sweep_orphan_temps_three_states() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            try fm.createDirectory(at: src, withIntermediateDirectories: true)  // 空源（无 .jsonl，不触发 copy）
            let data = root.appendingPathComponent("data")
            let m = ChatMirror(sourceRoot: src, dataRoot: data)
            let staleTemp = sub(m.mirrorRoot, "proj", ".tmp-s1.jsonl.\(UUID().uuidString)")
            let freshTemp = sub(m.mirrorRoot, "proj", ".tmp-s2.jsonl.\(UUID().uuidString)")
            let realJsonl = sub(m.mirrorRoot, "proj", "s3.jsonl")
            try writeFile(staleTemp, "stale", mtime: Date().addingTimeInterval(-7200))  // 2h 老孤儿
            try writeFile(freshTemp, "fresh", mtime: Date())                            // 新（可能并发在飞）
            try writeFile(realJsonl, "{}", mtime: Date().addingTimeInterval(-7200))     // 2h 老 .jsonl 载荷

            _ = m.fullScan()  // 触发末尾 sweepOrphanTemps

            #expect(!fm.fileExists(atPath: staleTemp.path))  // >1h 孤儿 temp 删
            #expect(fm.fileExists(atPath: freshTemp.path))   // 新 temp 留（避误删在飞）
            #expect(fm.fileExists(atPath: realJsonl.path))   // .jsonl 永不删
        }
    }

    @Test("并发双写者：两 ChatMirror 同 mirrorRoot 并发 fullScan → 终态每文件完整==源，第二轮 copy=0（收敛）")
    func concurrent_double_writers_converge() throws {
        try withTempRoot { root in
            let src = root.appendingPathComponent("src")
            let mirror = root.appendingPathComponent("mirror")
            var expected: [(proj: String, name: String, body: String)] = []
            let baseMtime = Date()  // 近期 mtime：在飞 temp mtime==源 mtime 不足 1h，sweep 绝不误删
            for i in 0 ..< 24 {
                let proj = "p\(i % 3)"
                let name = "s\(i).jsonl"
                let body = String(repeating: "line-\(i)-payload\n", count: 40)
                try writeFile(sub(src, proj, name), body, mtime: baseMtime.addingTimeInterval(Double(i)))
                expected.append((proj, name, body))
            }
            // 同 mirrorRoot、不同 syncState（两分身并发镜像同一共享池）
            let mA = ChatMirror(sourceRoot: src, mirrorRoot: mirror,
                                syncStateURL: root.appendingPathComponent("stateA.json"))
            let mB = ChatMirror(sourceRoot: src, mirrorRoot: mirror,
                                syncStateURL: root.appendingPathComponent("stateB.json"))
            DispatchQueue.concurrentPerform(iterations: 2) { idx in
                _ = (idx == 0 ? mA : mB).fullScan()
            }
            // 终态：每文件完整、内容 == 源（rename 原子性 + 同内容后到者胜）
            for e in expected {
                let mf = sub(mirror, e.proj, e.name)
                #expect(fm.fileExists(atPath: mf.path))
                #expect((try? String(contentsOf: mf, encoding: .utf8)) == e.body)
            }
            // 收敛：随后单独第二轮 copy = 0
            #expect(mA.fullScan().synced == 0)
            #expect(mB.fullScan().synced == 0)
        }
    }
}
