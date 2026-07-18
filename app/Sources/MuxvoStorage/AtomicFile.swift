// 全 app 唯一落盘写入口（SQLite 自管 WAL 除外）。禁止在别处用 Data.write(.atomic) 等替代。
// 协议（蓝本 architecture.md §6.3）：同目录写 <name>.tmp.<random> → write → 同步（macOS
// F_FULLFSYNC，失败 fallback fsync）→ rename(2) 原子替换 → 父目录 fsync → 启动时清扫 *.tmp.*。
import Darwin
import Foundation

public enum Durability: Sendable {
    case full // F_FULLFSYNC（APFS 普通 fsync 只刷到驱动缓存）：cold path（flag/SCHEMA_VERSION 等）
    case standard // fsync：hot path 留位（草稿类高频写），M1 未用
}

public struct AtomicFileError: Error, Equatable {
    public enum Operation: Sendable, Equatable {
        case open, write, sync, close, rename, directorySync, unlink
    }

    public let operation: Operation
    public let path: String
    public let code: Int32
}

/// internal 注入缝：只为单测验证「write→syncFile→rename→syncDirectory」序列与 durability 透传，
/// 不 mock 整个文件系统（真实持久化语义由任务 11 的 SIGKILL 集成测试覆盖）。
protocol FileSyncing: Sendable {
    func syncFile(descriptor: Int32, durability: Durability, path: String) throws
    func syncDirectory(descriptor: Int32, durability: Durability, path: String) throws
}

struct RealFileSyncing: FileSyncing {
    func syncFile(descriptor: Int32, durability: Durability, path: String) throws {
        try Self.sync(descriptor: descriptor, durability: durability, path: path, operation: .sync)
    }

    func syncDirectory(descriptor: Int32, durability: Durability, path: String) throws {
        try Self.sync(descriptor: descriptor, durability: durability, path: path, operation: .directorySync)
    }

    private static func sync(
        descriptor: Int32, durability: Durability, path: String,
        operation: AtomicFileError.Operation
    ) throws {
        switch durability {
        case .full:
            // F_FULLFSYNC 在 SMB/FUSE 等返回失败（ENOTSUP）→ fallback fsync 保住排序语义
            if fcntl(descriptor, F_FULLFSYNC) == -1 {
                if fsync(descriptor) == -1 {
                    throw AtomicFileError(operation: operation, path: path, code: errno)
                }
            }
        case .standard:
            if fsync(descriptor) == -1 {
                throw AtomicFileError(operation: operation, path: path, code: errno)
            }
        }
    }
}

public enum AtomicFile {
    public static func write(_ data: Data, to destination: URL, durability: Durability) throws {
        try write(data, to: destination, durability: durability, syncer: RealFileSyncing())
    }

    static func write(
        _ data: Data, to destination: URL, durability: Durability, syncer: any FileSyncing
    ) throws {
        let directory = destination.deletingLastPathComponent()

        // 1. 同目录建 tmp（O_CREAT|O_EXCL，64-bit 随机后缀，EEXIST 重试 3 次兜底）
        var fd: Int32 = -1
        var tmpURL = makeTemporaryURL(for: destination)
        for attempt in 0 ..< 3 {
            fd = open(tmpURL.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
            if fd >= 0 { break }
            if errno == EEXIST, attempt < 2 {
                tmpURL = makeTemporaryURL(for: destination)
                continue
            }
            throw AtomicFileError(operation: .open, path: tmpURL.path, code: errno)
        }

        // tmp 已创建：之后任何失败都先清掉 tmp 再上抛
        do {
            // 2. write(2) 循环（partial write + EINTR）
            try data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in
                guard let base = buffer.baseAddress else { return }
                var offset = 0
                while offset < buffer.count {
                    let written = Darwin.write(fd, base.advanced(by: offset), buffer.count - offset)
                    if written < 0 {
                        if errno == EINTR { continue }
                        throw AtomicFileError(operation: .write, path: tmpURL.path, code: errno)
                    }
                    offset += written
                }
            }
            // 3. 文件内容落盘
            try syncer.syncFile(descriptor: fd, durability: durability, path: tmpURL.path)
            if close(fd) == -1 {
                fd = -1
                throw AtomicFileError(operation: .close, path: tmpURL.path, code: errno)
            }
            fd = -1

            CrashInjector.hit(.atomicWriteBeforeRename)

            // 4. rename(2) 原子替换（FileManager.moveItem 目标存在即失败，不可用）
            if Darwin.rename(tmpURL.path, destination.path) == -1 {
                throw AtomicFileError(operation: .rename, path: destination.path, code: errno)
            }
        } catch {
            if fd >= 0 { close(fd) }
            unlink(tmpURL.path) // 尽力清理，失败由启动清扫兜底
            throw error
        }

        // 5. 父目录 fsync（rename 是目录元数据变更）
        try syncDirectory(at: directory, durability: durability, syncer: syncer)
    }

    /// unlink + 父目录同步。文件本不存在 = 幂等成功（且不动目录）。
    /// 删除也必须同步目录：否则断电后已删 flag「复活」，会把崩溃误判成 clean exit。
    public static func remove(at url: URL, durability: Durability) throws {
        if unlink(url.path) == -1 {
            if errno == ENOENT { return }
            throw AtomicFileError(operation: .unlink, path: url.path, code: errno)
        }
        try syncDirectory(
            at: url.deletingLastPathComponent(), durability: durability, syncer: RealFileSyncing()
        )
    }

    /// 递归清扫 *.tmp.<hex> 残留（崩溃在 rename 前留下的孤儿），返回删除清单。
    @discardableResult
    public static func sweepTemporaryFiles(under root: URL) throws -> [URL] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: root.path) else { return [] }
        guard let enumerator = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey])
        else { return [] }
        var removed: [URL] = []
        for case let url as URL in enumerator {
            guard isTemporaryArtifactName(url.lastPathComponent) else { continue }
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
            else { continue }
            try fm.removeItem(at: url)
            removed.append(url)
        }
        return removed
    }

    /// 纯谓词：是否本入口产生的 tmp 残留（<非空前缀>.tmp.<非空 hex 后缀>）。
    static func isTemporaryArtifactName(_ name: String) -> Bool {
        guard let range = name.range(of: ".tmp.", options: .backwards) else { return false }
        let prefix = name[..<range.lowerBound]
        let suffix = name[range.upperBound...]
        return !prefix.isEmpty && !suffix.isEmpty && suffix.allSatisfy(\.isHexDigit)
    }

    static func makeTemporaryURL(for destination: URL) -> URL {
        let suffix = String(format: "%016llx", UInt64.random(in: .min ... .max))
        return destination.deletingLastPathComponent()
            .appendingPathComponent("\(destination.lastPathComponent).tmp.\(suffix)")
    }

    private static func syncDirectory(
        at directory: URL, durability: Durability, syncer: any FileSyncing
    ) throws {
        let fd = open(directory.path, O_RDONLY | O_DIRECTORY)
        guard fd >= 0 else {
            throw AtomicFileError(operation: .open, path: directory.path, code: errno)
        }
        defer { close(fd) }
        try syncer.syncDirectory(descriptor: fd, durability: durability, path: directory.path)
    }
}
