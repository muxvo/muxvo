// FsService：fs.request 的「文件系统事实供给 + 菜单动作执行」（plan-native §1.1 / §1.3；M6 批B 增读写）。
//
// 两职责、两线程：
//   · readDir / readFile / writeFile —— 同一后台串行队列（muxvo.fs.io）+ continuation。串行是 writeFile
//     条件写的正确性前提：单次 writeFile 的「stat→写」在串行队列上作为一个不可中断块跑完，两个并发 writeFile
//     天然排队，消 TOCTOU（外部改文件的窗口无法夹进 stat 与写之间）。readDir 只列事实（**不排序、不过滤隐藏、
//     恒含 dot 条目**，排序/隐藏过滤归 web）；readFile 取 mtime + 内容（utf8 截断 / base64 整读 / 大小上限）；
//     writeFile 就地落盘（保 inode/权限/硬链接）。错误一律映射为 rejected{code,message}。
//   · performMenuAction —— @MainActor。showFileMenu 选中项后由 Router 调，native 自己执行副作用
//     （复制路径 / Finder 定位 / 默认应用打开）。
import AppKit
import Foundation
import MuxvoBridge
import MuxvoChatHistory  // PosixStat：整数毫秒 mtime（与 JS Math.floor(mtimeMs) 逐位对齐）

public struct FsService: Sendable {
    /// fs.io 后台串行队列：readDir / readFile / writeFile 共用（低频、短时）。串行保证 writeFile 条件写
    /// 的 stat→写 不被并发 fs 操作夹断（TOCTOU）。隐藏开关翻转不需重发 readDir——数据已含 dot 条目。
    private static let ioQueue = DispatchQueue(label: "muxvo.fs.io", qos: .userInitiated)
    /// 单层条目上限（node_modules 类目录 JSON 载荷防线）。超出截断置 truncated，web 尾部提示。
    static let entryLimit = 5000
    /// utf8 readFile 内容上限（超出只读前 2MB 并置 truncated；回退到合法 UTF-8 边界）。
    static let maxReadUtf8Bytes = 2 * 1024 * 1024
    /// base64 readFile 大小上限（image/pdf/xlsx 预览；超出 rejected TOO_LARGE，不截断）。
    static let maxReadBase64Bytes = 20 * 1024 * 1024

    public init() {}

    // MARK: - readDir（后台）

    public func readDir(path: String) async -> FsResponse {
        await withCheckedContinuation { (cont: CheckedContinuation<FsResponse, Never>) in
            Self.ioQueue.async { cont.resume(returning: Self.readDirSync(path: path)) }
        }
    }

    /// 纯逻辑（可直测）：列目录 → FsResponse。存在性/目录性/权限三态映射；size 仅文件。
    static func readDirSync(path: String) -> FsResponse {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: path, isDirectory: &isDir) else {
            return .rejected(code: "NOT_FOUND", message: "目录不存在")
        }
        guard isDir.boolValue else {
            return .rejected(code: "NOT_DIR", message: "不是目录")
        }
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey]
        let contents: [URL]
        do {
            // 无 .skipsHiddenFiles → 含 dotfiles、不含 "."/".."（正是「恒含 dot 条目、不过滤」所需）。
            contents = try fm.contentsOfDirectory(
                at: URL(fileURLWithPath: path, isDirectory: true),
                includingPropertiesForKeys: keys, options: [])
        } catch {
            return .rejected(code: mapReadError(error), message: "无法读取此目录")
        }
        var entries: [FsEntry] = []
        entries.reserveCapacity(min(contents.count, entryLimit))
        var truncated = false
        for url in contents {
            if entries.count >= entryLimit { truncated = true; break }
            let vals = try? url.resourceValues(forKeys: Set(keys))
            let isDirectory = vals?.isDirectory ?? false
            // size 仅文件给（目录 nil）。非 UTF-8 文件名 lastPathComponent 原样透传（roundtrip 一致）。
            let size = isDirectory ? nil : vals?.fileSize
            entries.append(FsEntry(name: url.lastPathComponent, isDirectory: isDirectory, size: size))
        }
        return .dir(entries: entries, truncated: truncated ? true : nil)
    }

    /// 读目录错误 → rejected code。权限（EACCES/NSFileReadNoPermission）→ PERM_DENIED；其余 → INTERNAL。
    static func mapReadError(_ error: Error) -> String {
        let ns = error as NSError
        if ns.domain == NSCocoaErrorDomain,
           ns.code == NSFileReadNoPermissionError || ns.code == NSFileWriteNoPermissionError {
            return "PERM_DENIED"
        }
        if ns.domain == NSCocoaErrorDomain, ns.code == NSFileReadNoSuchFileError {
            return "NOT_FOUND"
        }
        // 底层 POSIX EACCES（部分路径经 NSFileReadUnknownError 包裹）。
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError,
           underlying.domain == NSPOSIXErrorDomain, underlying.code == Int(EACCES) {
            return "PERM_DENIED"
        }
        if ns.domain == NSPOSIXErrorDomain, ns.code == Int(EACCES) {
            return "PERM_DENIED"
        }
        return "INTERNAL"
    }

    // MARK: - readFile（后台）

    public func readFile(path: String, encoding: String?) async -> FsResponse {
        await withCheckedContinuation { (cont: CheckedContinuation<FsResponse, Never>) in
            Self.ioQueue.async { cont.resume(returning: Self.readFileSync(path: path, encoding: encoding)) }
        }
    }

    /// 纯逻辑（可直测）：读文件 → fileContent / rejected。encoding 缺省 utf8，仅 "base64" 走二进制整读；
    /// 其余（含未知串）按 utf8。mtimeMs 由 PosixStat 取整数毫秒（与 JS Math.floor 对齐）。
    static func readFileSync(path: String, encoding: String?) -> FsResponse {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: path, isDirectory: &isDir) else {
            return .rejected(code: "NOT_FOUND", message: "文件不存在")
        }
        guard !isDir.boolValue else {
            return .rejected(code: "IS_DIR", message: "路径是目录")
        }
        guard let info = PosixStat.of(path: path) else {
            return .rejected(code: "PERM_DENIED", message: "无法读取文件元信息")
        }
        let mtimeMs = Int(info.mtimeMs)

        if encoding?.lowercased() == "base64" {
            guard info.size <= maxReadBase64Bytes else {
                return .rejected(code: "TOO_LARGE", message: "文件超过 20MB base64 上限")
            }
            guard let data = fm.contents(atPath: path) else {
                return .rejected(code: "PERM_DENIED", message: "无法读取文件")
            }
            return .fileContent(content: data.base64EncodedString(), encoding: "base64",
                                truncated: nil, mtimeMs: mtimeMs)
        }

        // utf8：>2MB 只读前 2MB（截断处回退到合法 UTF-8 边界）；解码非法 → NOT_UTF8。
        let needsTruncate = info.size > maxReadUtf8Bytes
        guard let handle = FileHandle(forReadingAtPath: path) else {
            return .rejected(code: "PERM_DENIED", message: "无法读取文件")
        }
        defer { try? handle.close() }
        var data: Data
        do {
            data = try (needsTruncate ? handle.read(upToCount: maxReadUtf8Bytes) : handle.readToEnd()) ?? Data()
        } catch {
            return .rejected(code: mapReadError(error), message: "无法读取文件")
        }
        if needsTruncate {
            // 截断可能切在多字节序列中间：最多丢弃末 3 字节回退到 UTF-8 边界（一序列 ≤4 字节）。
            // 丢满 3 字节仍解不出 = 内容内部本就非法 UTF-8 → NOT_UTF8。
            var dropped = 0
            while dropped < 3, String(data: data, encoding: .utf8) == nil, !data.isEmpty {
                data.removeLast()
                dropped += 1
            }
        }
        guard let text = String(data: data, encoding: .utf8) else {
            return .rejected(code: "NOT_UTF8", message: "文件不是合法 UTF-8 文本")
        }
        return .fileContent(content: text, encoding: "utf8",
                            truncated: needsTruncate ? true : nil, mtimeMs: mtimeMs)
    }

    // MARK: - writeFile（后台）

    public func writeFile(path: String, content: String, baseMtimeMs: Int?) async -> FsResponse {
        await withCheckedContinuation { (cont: CheckedContinuation<FsResponse, Never>) in
            Self.ioQueue.async {
                cont.resume(returning: Self.writeFileSync(path: path, content: content, baseMtimeMs: baseMtimeMs))
            }
        }
    }

    /// 纯逻辑（可直测，串行队列上跑消 TOCTOU）：写文件 → fileWritten / rejected。
    /// baseMtimeMs 非 nil = 条件写：文件须存在且 mtime 匹配（不匹配 → MTIME_CONFLICT）；nil = create-or-overwrite。
    /// 已存在 → **就地** truncate+write（保 inode/权限/硬链接：外部工具持 fd/watch 时 inode 稳定优先于
    /// 原子替换，且 ≤2MB 文本写入窗口极小）；不存在 → 创建。content 按 utf8 落盘（Swift String 恒合法 utf8）。
    static func writeFileSync(path: String, content: String, baseMtimeMs: Int?) -> FsResponse {
        let fm = FileManager.default
        let bytes = Data(content.utf8)
        var isDir: ObjCBool = false
        let exists = fm.fileExists(atPath: path, isDirectory: &isDir)
        if exists, isDir.boolValue {
            return .rejected(code: "IS_DIR", message: "路径是目录")
        }
        if let base = baseMtimeMs {
            // 条件写：先 stat（与随后的写同在串行队列上，无并发窗口）。
            guard exists else {
                return .rejected(code: "NOT_FOUND", message: "文件不存在")
            }
            guard let before = PosixStat.of(path: path) else {
                return .rejected(code: "PERM_DENIED", message: "无法读取文件元信息")
            }
            guard Int(before.mtimeMs) == base else {
                return .rejected(code: "MTIME_CONFLICT", message: "文件已被外部修改")
            }
        }
        if exists {
            guard let handle = FileHandle(forWritingAtPath: path) else {
                return .rejected(code: "PERM_DENIED", message: "无法写入文件")
            }
            defer { try? handle.close() }
            do {
                try handle.truncate(atOffset: 0)
                try handle.write(contentsOf: bytes)
            } catch {
                return .rejected(code: mapReadError(error), message: "写入失败")
            }
        } else {
            guard fm.createFile(atPath: path, contents: bytes) else {
                return .rejected(code: "PERM_DENIED", message: "无法创建文件")
            }
        }
        guard let after = PosixStat.of(path: path) else {
            return .rejected(code: "INTERNAL", message: "写入后无法读取 mtime")
        }
        return .fileWritten(mtimeMs: Int(after.mtimeMs))
    }

    // MARK: - 菜单动作执行（@MainActor）

    /// showFileMenu 选中项落地：native 自执行副作用。dismissed = no-op（用户关菜单未选）。
    @MainActor
    public func performMenuAction(_ action: FileMenuAction, path: String) {
        switch action {
        case .copyPath:
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(path, forType: .string)
        case .revealInFinder:
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        case .openWithDefaultApp:
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
        case .dismissed:
            break
        }
    }
}
