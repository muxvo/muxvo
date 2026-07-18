import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@Suite("AtomicFile 原子写")
struct AtomicFileTests {
    private func entries(of dir: URL) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: dir.path)
    }

    @Test("写后内容正确且目录无 tmp 残留") // 验收 3-⑥
    func writeLeavesNoTmpResidue() throws {
        try withTempRoot { root in
            let target = root.appendingPathComponent("file.txt")
            try AtomicFile.write(Data("你好，原子写".utf8), to: target, durability: .full)
            #expect(try String(contentsOf: target, encoding: .utf8) == "你好，原子写")
            #expect(try entries(of: root).allSatisfy { !AtomicFile.isTemporaryArtifactName($0) })
        }
    }

    @Test("覆盖写以新内容收尾且无残留") // 验收 3-⑥
    func overwriteIsAtomicReplace() throws {
        try withTempRoot { root in
            let target = root.appendingPathComponent("file.txt")
            try AtomicFile.write(Data("第一版".utf8), to: target, durability: .full)
            try AtomicFile.write(Data("第二版".utf8), to: target, durability: .full)
            #expect(try String(contentsOf: target, encoding: .utf8) == "第二版")
            #expect(try entries(of: root) == ["file.txt"])
        }
    }

    @Test("空数据也可原子写")
    func emptyDataWrite() throws {
        try withTempRoot { root in
            let target = root.appendingPathComponent("empty.bin")
            try AtomicFile.write(Data(), to: target, durability: .full)
            #expect(try Data(contentsOf: target).isEmpty)
        }
    }

    @Test("sweep 只清扫 tmp 模式文件（含子目录），近似名与正常文件保留") // 验收 3-④
    func sweepRemovesOnlyTmpFiles() throws {
        try withTempRoot { root in
            let fm = FileManager.default
            let sub = root.appendingPathComponent("state", isDirectory: true)
            try fm.createDirectory(at: sub, withIntermediateDirectories: true)
            let victims = [
                root.appendingPathComponent("a.txt.tmp.0123abcd"),
                sub.appendingPathComponent("b.bin.tmp.ffff"),
            ]
            let survivors = [
                root.appendingPathComponent("keep.txt"),
                root.appendingPathComponent("notes.tmp"), // 无随机段
                root.appendingPathComponent("x.tmpy.123"), // 不是 .tmp. 分隔
                sub.appendingPathComponent("y.tmp.zz"), // 后缀非 hex
            ]
            for url in victims + survivors {
                try Data("x".utf8).write(to: url)
            }

            let removed = try AtomicFile.sweepTemporaryFiles(under: root)
            #expect(Set(removed.map(\.lastPathComponent)) == Set(victims.map(\.lastPathComponent)))
            for url in victims {
                #expect(!fm.fileExists(atPath: url.path))
            }
            for url in survivors {
                #expect(fm.fileExists(atPath: url.path))
            }
        }
    }

    @Test("remove 幂等：删除存在的文件、对不存在的文件静默成功")
    func removeIsIdempotent() throws {
        try withTempRoot { root in
            let target = root.appendingPathComponent("flag")
            try AtomicFile.write(Data("x".utf8), to: target, durability: .full)
            try AtomicFile.remove(at: target, durability: .full)
            #expect(!FileManager.default.fileExists(atPath: target.path))
            try AtomicFile.remove(at: target, durability: .full) // 第二次不抛
        }
    }

    @Test("tmp 命名谓词：自产命名命中，常规命名放行")
    func temporaryArtifactPredicate() throws {
        try withTempRoot { root in
            let tmp = AtomicFile.makeTemporaryURL(for: root.appendingPathComponent("file.txt"))
            #expect(AtomicFile.isTemporaryArtifactName(tmp.lastPathComponent))
        }
        #expect(AtomicFile.isTemporaryArtifactName("a.tmp.00ff"))
        #expect(!AtomicFile.isTemporaryArtifactName("a.tmp."))
        #expect(!AtomicFile.isTemporaryArtifactName(".tmp.00ff"))
        #expect(!AtomicFile.isTemporaryArtifactName("file.txt"))
        #expect(!AtomicFile.isTemporaryArtifactName("a.tmp.xyz"))
    }

    // 白盒（FileSyncing 注入缝）：验证持久化序列与 durability 透传，不 mock 整个文件系统

    private struct RecordingSyncer: FileSyncing {
        let events: SyncEventLog
        func syncFile(descriptor: Int32, durability: Durability, path: String) throws {
            events.append(.file(durability: durability, destinationExists: events.destinationExists()))
        }

        func syncDirectory(descriptor: Int32, durability: Durability, path: String) throws {
            events.append(.dir(durability: durability, destinationExists: events.destinationExists()))
        }
    }

    /// 录制器：记录 sync 事件 + 事件发生时目标文件是否已存在（rename 是否已发生）
    final class SyncEventLog: @unchecked Sendable {
        enum Event: Equatable {
            case file(durability: Durability, destinationExists: Bool)
            case dir(durability: Durability, destinationExists: Bool)
        }

        private let lock = NSLock()
        private var _events: [Event] = []
        private let destination: URL
        init(destination: URL) { self.destination = destination }
        func append(_ e: Event) {
            lock.lock()
            _events.append(e)
            lock.unlock()
        }

        func destinationExists() -> Bool {
            FileManager.default.fileExists(atPath: destination.path)
        }

        var events: [Event] {
            lock.lock()
            defer { lock.unlock() }
            return _events
        }
    }

    @Test("持久化序列：write→syncFile→rename→syncDirectory（syncFile 时 rename 未发生）")
    func syncSequenceOrder() throws {
        try withTempRoot { root in
            let target = root.appendingPathComponent("seq.txt")
            let state = SyncEventLog(destination: target)
            try AtomicFile.write(
                Data("seq".utf8), to: target, durability: .full,
                syncer: RecordingSyncer(events: state)
            )
            #expect(state.events == [
                .file(durability: .full, destinationExists: false), // rename 前
                .dir(durability: .full, destinationExists: true), // rename 后
            ])
        }
    }

    @Test("durability 档位透传到两次 sync")
    func durabilityModeDispatch() throws {
        try withTempRoot { root in
            let target = root.appendingPathComponent("d.txt")
            let state = SyncEventLog(destination: target)
            try AtomicFile.write(
                Data("d".utf8), to: target, durability: .standard,
                syncer: RecordingSyncer(events: state)
            )
            #expect(state.events == [
                .file(durability: .standard, destinationExists: false),
                .dir(durability: .standard, destinationExists: true),
            ])
        }
    }
}
