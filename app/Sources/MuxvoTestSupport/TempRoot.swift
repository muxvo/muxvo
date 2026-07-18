// 测试唯一允许的落盘位置：$TMPDIR 下按 UUID 隔离的临时根。
// 纪律：任何测试不得触碰 ~/Library/Application Support/（含老版两个数据目录）。
import Foundation

/// 每次调用生成独立临时 root（默认名 "Muxvo2 Test"），闭包结束（含抛错）后清理。
/// swift-testing 默认并行：UUID 唯一路径保证互不相干。
public func withTempRoot<R>(
    name: String = "Muxvo2 Test",
    _ body: (URL) throws -> R
) throws -> R {
    let root = try makeTempRoot(name: name)
    defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
    return try body(root)
}

/// async 重载（actor/GRDB async API 的测试用），语义同上。
public func withTempRoot<R>(
    name: String = "Muxvo2 Test",
    _ body: (URL) async throws -> R
) async throws -> R {
    let root = try makeTempRoot(name: name)
    defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
    return try await body(root)
}

/// @MainActor async 变体（@MainActor 套件 await MainActor 隔离 API 用——闭包与调用方同域，
/// 免「MainActor 闭包送 nonisolated 泛型」的 sending 红），语义同上。独立命名避开重载歧义。
@MainActor
public func withTempRootOnMain<R>(
    name: String = "Muxvo2 Test",
    _ body: @MainActor (URL) async throws -> R
) async throws -> R {
    let root = try makeTempRoot(name: name)
    defer { try? FileManager.default.removeItem(at: root.deletingLastPathComponent()) }
    return try await body(root)
}

private func makeTempRoot(name: String) throws -> URL {
    let tmpBase = FileManager.default.temporaryDirectory
    let base = tmpBase.appendingPathComponent("muxvo-tests-\(UUID().uuidString)", isDirectory: true)
    let root = base.appendingPathComponent(name, isDirectory: true)
    precondition(base.path.hasPrefix(tmpBase.path), "测试根必须在 $TMPDIR 下")
    precondition(
        !["muxvo dev", "muxvo"].contains(root.lastPathComponent.lowercased()),
        "测试根不得撞老版数据目录名"
    )
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
}
