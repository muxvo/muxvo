// 埋点设备标识（analytics.md §0）：state/analytics-device-id 持久 UUID，每数据根一个。
// 首建 isNew=true → 装配层恰发一次 app.first_launch。不迁移老版 device_id（M7-PLAN 已定）。
import Foundation
import MuxvoStorage

public struct DeviceIdentity: Equatable, Sendable {
    public let id: String
    public let isNew: Bool
}

public enum AnalyticsDeviceID {
    static let fileName = "analytics-device-id"

    /// 读 `<stateDirectory>/analytics-device-id`；缺失或内容非 UUID → 生成新 UUID 原子写（isNew=true）。
    public static func loadOrCreate(stateDirectory: URL) throws -> DeviceIdentity {
        let url = stateDirectory.appendingPathComponent(fileName)
        if let raw = try? String(contentsOf: url, encoding: .utf8) {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if UUID(uuidString: trimmed) != nil {
                return DeviceIdentity(id: trimmed, isNew: false)
            }
        }
        let fresh = UUID().uuidString.lowercased()
        try AtomicFile.write(Data(fresh.utf8), to: url, durability: .full)
        return DeviceIdentity(id: fresh, isNew: true)
    }
}
