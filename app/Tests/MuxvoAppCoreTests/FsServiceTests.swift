// FsService 单测（批A，plan-native §1.1 / §7.1）：readDir 事实供给（含 dot、size 仅文件、不排序/不过滤）、
// 三态错误映射（NOT_FOUND / NOT_DIR / PERM_DENIED）、5000 截断；菜单动作 copyPath（写 pasteboard）/ dismissed no-op。
// 命名纪律：非 spec-ID 翻牌，测试名不像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoChatHistory  // PosixStat：mtime 回读断言
@testable import MuxvoAppCore

@Suite("FsService.readDir 事实供给与错误映射")
struct FsServiceReadDirTests {

    private func tempDir() -> URL {
        let d = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-fs-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test("普通目录：含 dotfile、子目录无 size、文件给 size、不含 './..'")
    func normalDir() throws {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let fm = FileManager.default
        fm.createFile(atPath: d.appendingPathComponent("a.txt").path, contents: Data("hello".utf8))
        fm.createFile(atPath: d.appendingPathComponent(".hidden").path, contents: Data("x".utf8))
        try fm.createDirectory(at: d.appendingPathComponent("sub"), withIntermediateDirectories: true)

        guard case let .dir(entries, truncated) = FsService.readDirSync(path: d.path) else {
            Issue.record("应回 dir"); return
        }
        #expect(truncated == nil)
        let byName = Dictionary(uniqueKeysWithValues: entries.map { ($0.name, $0) })
        #expect(byName.keys.sorted() == [".hidden", "a.txt", "sub"]) // 恒含 dot，无 . / ..
        #expect(byName["a.txt"]?.isDirectory == false)
        #expect(byName["a.txt"]?.size == 5)      // 文件给 size
        #expect(byName["sub"]?.isDirectory == true)
        #expect(byName["sub"]?.size == nil)      // 目录不给 size
        #expect(byName[".hidden"]?.size == 1)
    }

    @Test("空目录 = dir(entries:[])（非错误——空≠无权限，两态分明）")
    func emptyDir() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        guard case let .dir(entries, truncated) = FsService.readDirSync(path: d.path) else {
            Issue.record("应回 dir"); return
        }
        #expect(entries.isEmpty)
        #expect(truncated == nil)
    }

    @Test("不存在 → NOT_FOUND；路径是文件 → NOT_DIR")
    func notFoundAndNotDir() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        guard case let .rejected(code1, _) = FsService.readDirSync(path: d.appendingPathComponent("nope").path) else {
            Issue.record("应 rejected"); return
        }
        #expect(code1 == "NOT_FOUND")

        let file = d.appendingPathComponent("f.txt")
        FileManager.default.createFile(atPath: file.path, contents: Data())
        guard case let .rejected(code2, _) = FsService.readDirSync(path: file.path) else {
            Issue.record("应 rejected"); return
        }
        #expect(code2 == "NOT_DIR")
    }

    @Test("chmod 000 目录 → PERM_DENIED（错误≠空目录）")
    func permDenied() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) } // cleanup 会 chmod 回写再删
        let locked = d.appendingPathComponent("locked", isDirectory: true)
        try? FileManager.default.createDirectory(at: locked, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: locked.appendingPathComponent("secret").path, contents: Data())
        try? FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: locked.path)

        guard case let .rejected(code, _) = FsService.readDirSync(path: locked.path) else {
            Issue.record("应 rejected"); return
        }
        #expect(code == "PERM_DENIED")
    }

    @Test("超 5000 条截断置 truncated（node_modules 类载荷防线）")
    func truncation() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let fm = FileManager.default
        for i in 0..<(FsService.entryLimit + 1) {
            fm.createFile(atPath: d.appendingPathComponent("f\(i)").path, contents: Data())
        }
        guard case let .dir(entries, truncated) = FsService.readDirSync(path: d.path) else {
            Issue.record("应回 dir"); return
        }
        #expect(entries.count == FsService.entryLimit)
        #expect(truncated == true)
    }
}

@Suite("FsService.readFile 内容供给（M6 批B）")
struct FsServiceReadFileTests {

    private func tempDir() -> URL {
        let d = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-fs-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test("utf8 正常读取：内容/encoding/mtimeMs 一致，无 truncated")
    func readUtf8Normal() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("note.md")
        let text = "hello 世界\nsecond line\n"
        try? Data(text.utf8).write(to: f)
        let expectedMtime = PosixStat.of(path: f.path)!.mtimeMs
        guard case let .fileContent(content, encoding, truncated, mtimeMs) =
                FsService.readFileSync(path: f.path, encoding: nil) else {
            Issue.record("应回 fileContent"); return
        }
        #expect(content == text)
        #expect(encoding == "utf8")
        #expect(truncated == nil)
        #expect(mtimeMs == Int(expectedMtime))
    }

    @Test("utf8 超 2MB：只读前 2MB，回退到合法 UTF-8 边界，truncated=true")
    func readUtf8Truncated() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("big.txt")
        // '中' 每字 3 字节；2MB 边界(2097152) mod 3 == 2，必切在多字节序列中间 → 触发边界回退。
        let content = String(repeating: "中", count: 700_000) // 2,100,000 字节 > 2MB
        try? Data(content.utf8).write(to: f)
        guard case let .fileContent(text, encoding, truncated, _) =
                FsService.readFileSync(path: f.path, encoding: nil) else {
            Issue.record("应回 fileContent"); return
        }
        #expect(truncated == true)
        #expect(encoding == "utf8")
        #expect(!text.isEmpty)
        #expect(text.allSatisfy { $0 == "中" })          // 全是完整字，无残缺半字
        let bytes = text.utf8.count
        #expect(bytes <= FsService.maxReadUtf8Bytes)      // 不超上限
        #expect(FsService.maxReadUtf8Bytes - bytes < 3)   // 回退最多丢 3 字节（此例丢 2）
    }

    @Test("base64 读取：二进制整读回 base64，encoding=base64，无 truncated")
    func readBase64() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("bin.dat")
        let raw = Data([0x00, 0xFF, 0x10, 0xAB, 0xCD])    // 含非 UTF-8 字节
        try? raw.write(to: f)
        guard case let .fileContent(content, encoding, truncated, _) =
                FsService.readFileSync(path: f.path, encoding: "base64") else {
            Issue.record("应回 fileContent"); return
        }
        #expect(content == raw.base64EncodedString())
        #expect(encoding == "base64")
        #expect(truncated == nil)
    }

    @Test("base64 超 20MB → TOO_LARGE")
    func readBase64TooLarge() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("huge.bin")
        try? Data(count: FsService.maxReadBase64Bytes + 1).write(to: f)
        guard case let .rejected(code, _) = FsService.readFileSync(path: f.path, encoding: "base64") else {
            Issue.record("应 rejected"); return
        }
        #expect(code == "TOO_LARGE")
    }

    @Test("不存在 → NOT_FOUND；路径是目录 → IS_DIR")
    func readNotFoundAndIsDir() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        guard case let .rejected(code1, _) =
                FsService.readFileSync(path: d.appendingPathComponent("ghost").path, encoding: nil) else {
            Issue.record("应 rejected"); return
        }
        #expect(code1 == "NOT_FOUND")
        guard case let .rejected(code2, _) = FsService.readFileSync(path: d.path, encoding: nil) else {
            Issue.record("应 rejected"); return
        }
        #expect(code2 == "IS_DIR")
    }

    @Test("非法 UTF-8（utf8 模式）→ NOT_UTF8")
    func readNotUtf8() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("bad.txt")
        try? Data([0xFF, 0xFE, 0x00, 0xFF]).write(to: f)  // 0xFF 恒非法 UTF-8
        guard case let .rejected(code, _) = FsService.readFileSync(path: f.path, encoding: nil) else {
            Issue.record("应 rejected"); return
        }
        #expect(code == "NOT_UTF8")
    }
}

@Suite("FsService.writeFile 落盘与冲突检测（M6 批B）")
struct FsServiceWriteFileTests {

    private func tempDir() -> URL {
        let d = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-fs-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func inode(_ path: String) -> Int? {
        (try? FileManager.default.attributesOfItem(atPath: path))?[.systemFileNumber] as? Int
    }

    @Test("无条件写：新建文件落盘，回 fileWritten 且 mtime 与回读一致")
    func writeUnconditionalCreate() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("new.txt")
        let text = "created content\n世界"
        guard case let .fileWritten(mtimeMs) =
                FsService.writeFileSync(path: f.path, content: text, baseMtimeMs: nil) else {
            Issue.record("应回 fileWritten"); return
        }
        let onDisk = try? String(contentsOf: f, encoding: .utf8)
        #expect(onDisk == text)
        #expect(PosixStat.of(path: f.path).map { Int($0.mtimeMs) } == mtimeMs)  // 写后回读一致
    }

    @Test("无条件写覆盖既存文件：内容更新且 inode 不变（就地写保 inode）")
    func writeUnconditionalOverwriteKeepsInode() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("edit.txt")
        try? Data("old longer content".utf8).write(to: f)
        let inodeBefore = inode(f.path)
        guard case .fileWritten = FsService.writeFileSync(path: f.path, content: "brand new", baseMtimeMs: nil) else {
            Issue.record("应回 fileWritten"); return
        }
        let onDisk = try? String(contentsOf: f, encoding: .utf8)
        #expect(onDisk == "brand new")
        #expect(inodeBefore != nil)
        #expect(inodeBefore == inode(f.path))  // 就地 truncate+write，inode 稳定
    }

    @Test("条件写通过：baseMtimeMs 匹配当前 mtime → 覆盖成功，回新 mtime")
    func writeConditionalMatch() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("doc.txt")
        try? Data("v1".utf8).write(to: f)
        let base = Int(PosixStat.of(path: f.path)!.mtimeMs)
        guard case let .fileWritten(newMtime) =
                FsService.writeFileSync(path: f.path, content: "v2 content", baseMtimeMs: base) else {
            Issue.record("应回 fileWritten"); return
        }
        let onDisk = try? String(contentsOf: f, encoding: .utf8)
        #expect(onDisk == "v2 content")
        #expect(PosixStat.of(path: f.path).map { Int($0.mtimeMs) } == newMtime)
    }

    @Test("条件写冲突：外部改 mtime 后用旧 baseMtimeMs 写 → MTIME_CONFLICT（不落盘）")
    func writeConditionalConflict() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        let f = d.appendingPathComponent("shared.txt")
        try? Data("original".utf8).write(to: f)
        let stale = Int(PosixStat.of(path: f.path)!.mtimeMs)
        // 外部工具改文件 → mtime 变（显式设 modificationDate 到远早时刻，保证整数 ms 必不同）。
        try? FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 1_000_000_000)], ofItemAtPath: f.path)
        guard case let .rejected(code, _) =
                FsService.writeFileSync(path: f.path, content: "should not land", baseMtimeMs: stale) else {
            Issue.record("应 rejected"); return
        }
        #expect(code == "MTIME_CONFLICT")
        let onDisk = try? String(contentsOf: f, encoding: .utf8)
        #expect(onDisk == "original")  // 冲突不落盘
    }

    @Test("条件写文件不存在 → NOT_FOUND")
    func writeConditionalNotFound() {
        let d = tempDir(); defer { GitTestFixture.cleanup(d) }
        guard case let .rejected(code, _) = FsService.writeFileSync(
            path: d.appendingPathComponent("ghost.txt").path, content: "x", baseMtimeMs: 123) else {
            Issue.record("应 rejected"); return
        }
        #expect(code == "NOT_FOUND")
    }
}

@Suite("FsService 菜单动作执行", .serialized)
@MainActor
struct FsServiceMenuTests {

    @Test("copyPath：路径写入通用 pasteboard；dismissed：no-op（pasteboard 不变）")
    func copyPathAndDismissed() {
        let svc = FsService()
        let path = "/Users/test/proj/README.md"
        svc.performMenuAction(.copyPath, path: path)
        #expect(NSPasteboard.general.string(forType: .string) == path)

        // dismissed 不改 pasteboard（用户关菜单未选）。
        svc.performMenuAction(.dismissed, path: "/other")
        #expect(NSPasteboard.general.string(forType: .string) == path)
    }
}
