// SCHEMA_VERSION 文件的纯解析/序列化。格式：单行 "<int> <channel>\n"（如 "1 dev"）。
// 解析失败一律 throw corruptSchemaVersion——绝不把不可解析当 fresh 处理（宁拒启不清数据）。
import Foundation

public enum ReleaseChannel: String, Sendable, Equatable, CaseIterable {
    case dev
    case prod // M7 发布时才启用，先占位语义
}

public struct SchemaVersionStamp: Sendable, Equatable {
    public let version: Int
    public let channel: ReleaseChannel

    public init(version: Int, channel: ReleaseChannel) {
        self.version = version
        self.channel = channel
    }

    /// 容忍：首尾空白、缺尾换行、多余空白分隔。拒绝：非 UTF-8、非两段、非正整数、未知 channel。
    public static func parse(_ data: Data) throws -> SchemaVersionStamp {
        guard let text = String(data: data, encoding: .utf8) else {
            throw DataDirectoryError.corruptSchemaVersion(detail: "非 UTF-8 内容")
        }
        let parts = text.split(whereSeparator: { $0.isWhitespace })
        guard parts.count == 2 else {
            throw DataDirectoryError.corruptSchemaVersion(detail: "应为两段「版本 channel」，实际 \(parts.count) 段")
        }
        guard let version = Int(parts[0]), version >= 1 else {
            throw DataDirectoryError.corruptSchemaVersion(detail: "版本段不是正整数：\(parts[0])")
        }
        guard let channel = ReleaseChannel(rawValue: String(parts[1])) else {
            throw DataDirectoryError.corruptSchemaVersion(detail: "未知 channel：\(parts[1])")
        }
        return SchemaVersionStamp(version: version, channel: channel)
    }

    public func serialized() -> Data {
        Data("\(version) \(channel.rawValue)\n".utf8)
    }
}
