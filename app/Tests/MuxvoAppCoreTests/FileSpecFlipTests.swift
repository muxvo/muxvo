// FILE 域 spec-ID 翻牌锚（M6 批3 翻牌欠账）：批A 已在 main 落地 fs 事实供给 / 目录选择功能，
// 本文件只补 spec-ID 锚测试。FsServiceTests / ConfigRequestHandlerTests 保留其描述性行为测试
// （作者标注「非 spec-ID 翻牌」），此处不改它们，各自单独持有一条 spec-ID active 测试（spec-runner 1:1）。
//
//   FILE_L1_01 fs:read-dir 契约（真 IO + 线格 FsEntry 形状）——
//     Tier-B：as-built FsEntry = {name, isDirectory, size?}；legacy spec 的 `type` 由 isDirectory:bool 表达、
//     `mtime` 弃（bridge v9 冻结 protocol.json，文件面板 §3 UI 仅消费 size；新码从行为规格实现，不继承 legacy 结构）。
//   FILE_L1_07 fs:select-directory 契约（直调 AppRequestHandler + 注入 picker 替身）——
//     渠道由 legacy 的 fs:select-directory 迁到 app.request selectDirectory（批0 裁决 §8）。
//   FILE_L1_02 fs:read-file 契约（M7 批7 翻牌）——legacy {content,encoding} → fileContent{content,encoding,truncated?,mtimeMs}；
//     实现 FsService.readFileSync，描述性行为测试保留于 FsServiceTests『FsService.readFile 内容供给』。
//   FILE_L1_03 fs:write-file 契约（M7 批7 翻牌）——legacy {success:true} → fileWritten{mtimeMs}；
//     实现 FsService.writeFileSync，描述性行为测试保留于 FsServiceTests『FsService.writeFile 落盘与冲突检测』。
import Foundation
import Testing
import MuxvoBridge
@testable import MuxvoAppCore

@Suite("FILE 域 spec-ID 翻牌锚（批3）")
struct FileSpecFlipTests {

    private func tempDir() -> URL {
        let d = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-fileflip-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @Test("FILE_L1_01: fs:read-dir 契约 —— entries 每条 {name,isDirectory,size?}（含 dotfiles、size 仅文件、不排序/不过滤）；线格无 type/mtime（Tier-B）")
    func fileL1_01_readDirContract() throws {
        let d = tempDir(); defer { try? FileManager.default.removeItem(at: d) }
        let fm = FileManager.default
        fm.createFile(atPath: d.appendingPathComponent("a.txt").path, contents: Data("hello".utf8))
        fm.createFile(atPath: d.appendingPathComponent(".hidden").path, contents: Data("x".utf8))
        try fm.createDirectory(at: d.appendingPathComponent("sub"), withIntermediateDirectories: true)

        guard case let .dir(entries, truncated) = FsService.readDirSync(path: d.path) else {
            Issue.record("fs:read-dir 应回 dir 变体"); return
        }
        #expect(truncated == nil)
        // 恒含 dotfiles、不含 './..'、不排序（用字典按名取值，序无关，过滤/排序归 web）。
        let byName = Dictionary(uniqueKeysWithValues: entries.map { ($0.name, $0) })
        #expect(byName.keys.sorted() == [".hidden", "a.txt", "sub"])
        // 每条形状：name + isDirectory + size（仅文件）。
        #expect(byName["a.txt"]?.isDirectory == false)
        #expect(byName["a.txt"]?.size == 5)          // 文件给 size
        #expect(byName[".hidden"]?.isDirectory == false)
        #expect(byName["sub"]?.isDirectory == true)
        #expect(byName["sub"]?.size == nil)          // 目录不给 size

        // type:"ipc" 线格契约：FsEntry 编码键恰 {name,isDirectory,size}，无 legacy 的 "type"/"mtime"（Tier-B）。
        let json = try JSONEncoder().encode(FsEntry(name: "a.txt", isDirectory: false, size: 5))
        let wire = try #require(try JSONSerialization.jsonObject(with: json) as? [String: Any])
        #expect(Set(wire.keys) == ["name", "isDirectory", "size"])
        #expect(wire["type"] == nil)
        #expect(wire["mtime"] == nil)
    }

    /// DirectoryPicker 替身（@MainActor 协议 → 结论确定，绝不弹真面板）。
    struct StubPicker: DirectoryPicker {
        let result: String?
        func pick(defaultPath: String?) async -> String? { result }
    }

    @MainActor
    @Test("FILE_L1_07: fs:select-directory 契约 —— 注入 picker 返路径 → directorySelected；返 nil → selectionCancelled（渠道 fs→app.request，批0 裁决 §8）")
    func fileL1_07_selectDirectoryContract() async {
        let selected = AppRequestHandler(picker: StubPicker(result: "/Users/x/proj"))
        #expect(await selected.handle(.selectDirectory(defaultPath: "/Users/x"))
            == .directorySelected(path: "/Users/x/proj"))

        let cancelled = AppRequestHandler(picker: StubPicker(result: nil))
        #expect(await cancelled.handle(.selectDirectory(defaultPath: nil)) == .selectionCancelled)
    }

    @Test("FILE_L1_02: fs:read-file 契约 —— legacy {content, encoding} → as-built fileContent{content, encoding, truncated?, mtimeMs}（Tier-B：content/encoding 保真，加性 truncated/mtimeMs——>2MB utf8 只读前 2MB 置 truncated，base64 encoding='base64'）")
    func fileL1_02_readFileContract() throws {
        let d = tempDir(); defer { try? FileManager.default.removeItem(at: d) }
        let f = d.appendingPathComponent("note.txt")
        try Data("hello 世界".utf8).write(to: f)

        guard case let .fileContent(content, encoding, truncated, mtimeMs) =
                FsService.readFileSync(path: f.path, encoding: nil) else {
            Issue.record("fs:read-file 应回 fileContent 变体"); return
        }
        #expect(content == "hello 世界")   // content 保真（legacy 契约字段）
        #expect(encoding == "utf8")         // encoding 在场（legacy 契约字段）
        #expect(truncated == nil)           // 小文件不截断（加性字段）
        #expect(mtimeMs > 0)                // 加性 mtimeMs（as-built 扩展）
    }

    @Test("FILE_L1_03: fs:write-file 契约 —— legacy {success:true} → as-built fileWritten{mtimeMs}（Tier-B：成功信号 = fileWritten 变体携回读 mtime；既存就地 truncate+write 保 inode）")
    func fileL1_03_writeFileContract() throws {
        let d = tempDir(); defer { try? FileManager.default.removeItem(at: d) }
        let f = d.appendingPathComponent("out.txt")

        guard case let .fileWritten(mtimeMs) =
                FsService.writeFileSync(path: f.path, content: "written", baseMtimeMs: nil) else {
            Issue.record("fs:write-file 成功应回 fileWritten 变体（success 信号的 as-built 载体）"); return
        }
        #expect(mtimeMs > 0)                // fileWritten 携回读 mtime
        let readBack = try String(contentsOf: f, encoding: .utf8)
        #expect(readBack == "written")      // success:true 的 as-built 语义 = 内容确实落盘
    }
}
