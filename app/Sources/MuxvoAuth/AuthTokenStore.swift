// token 明文 JSON 存储（右上角批 B5）：**语义对齐 legacy token-storage.ts**——明文 + chmod 0600 +
// 原子写（tmp→rename）；解析失败删文件强制重登。路径由装配层注入（新版落各分身数据根，
// legacy 的 userData/.auth-token 路径不继承——bridge-v1.md §8 偏差登记）。Keychain 升级挂账
//（ad-hoc 签名分身重建会撞 Keychain 身份提示，dogfood 期明文 0600 是清醒取舍）。
import Foundation

/// 落盘形状：tokens + 登录时刻已知的用户档案（重启恢复显示 provider/头像，等 /user/me 兜底）。
public struct StoredAuth: Codable, Equatable, Sendable {
    public var tokens: AuthTokens
    public var user: AuthUser?

    public init(tokens: AuthTokens, user: AuthUser?) {
        self.tokens = tokens
        self.user = user
    }
}

public struct AuthTokenStore: Sendable {
    public let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    public func load() -> StoredAuth? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        guard let stored = try? JSONDecoder().decode(StoredAuth.self, from: data) else {
            try? FileManager.default.removeItem(at: fileURL) // 损坏/旧格式 → 删除强制重登（legacy 同语义）
            return nil
        }
        return stored
    }

    public func save(_ auth: StoredAuth) throws {
        let data = try JSONEncoder().encode(auth)
        let tmp = fileURL.deletingLastPathComponent()
            .appendingPathComponent(".\(fileURL.lastPathComponent).tmp")
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        // tmp 以 0600 直建（MINOR-6 回修：write 后补 chmod 存在极窄 0644 窗口）
        guard FileManager.default.createFile(
            atPath: tmp.path, contents: data, attributes: [.posixPermissions: 0o600])
        else { throw CocoaError(.fileWriteUnknown) }
        // rename 原子替换（同卷）；目标已存在时 replaceItem 语义
        _ = try FileManager.default.replaceItemAt(fileURL, withItemAt: tmp)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    public func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
