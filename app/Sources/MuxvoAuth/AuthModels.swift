// muxvo 账号模型 + 稳定错误码（右上角批 B5；login-modal.md §5 / bridge-v1.md §8 AUTH）。
// native 只产稳定 code + 英文 debug message；中文文案在 web 层映射（auth-strings.ts）。
import Foundation

/// 登录用户视图（AuthUserView 桥类型的源；legacy AuthUser 对齐）。
public struct AuthUser: Codable, Equatable, Sendable {
    public var username: String
    public var email: String?
    public var avatarUrl: String?
    /// github / google / email（登录时刻已知，随 token 落盘供重启恢复显示）。
    public var provider: String

    public init(username: String, email: String? = nil, avatarUrl: String? = nil, provider: String) {
        self.username = username
        self.email = email
        self.avatarUrl = avatarUrl
        self.provider = provider
    }
}

/// token 对（access=JWT 15min / refresh=30d，legacy token 模型）。
public struct AuthTokens: Codable, Equatable, Sendable {
    public var accessToken: String
    public var refreshToken: String

    public init(accessToken: String, refreshToken: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
}

/// 稳定错误码（web auth-strings.ts 的键面；rawValue 即桥 rejected.code）。
public enum AuthErrorCode: String, Sendable {
    case invalidCredentials = "AUTH_INVALID_CREDENTIALS"
    case codeInvalid = "AUTH_CODE_INVALID"
    case emailTaken = "AUTH_EMAIL_TAKEN"
    case weakPassword = "AUTH_WEAK_PASSWORD"
    case rateLimited = "AUTH_RATE_LIMITED"
    case timeout = "AUTH_TIMEOUT"
    case network = "AUTH_NETWORK"
    case server = "AUTH_SERVER"
    case unavailable = "AUTH_UNAVAILABLE"
}

/// auth 域错误：稳定 code + 英文 debug message（永不含用户凭据）。
public struct AuthError: Error, Equatable, Sendable {
    public var code: AuthErrorCode
    public var message: String

    public init(_ code: AuthErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }

    /// 后端错误文案 → 稳定码（legacy backend-client ERROR_MESSAGE_MAP 的判别面搬到 code 层）。
    public static func fromServer(status: Int, message: String) -> AuthError {
        let m = message.lowercased()
        if m.contains("invalid email or password") { return AuthError(.invalidCredentials, message) }
        if m.contains("verification") || m.contains("code") && m.contains("invalid") {
            return AuthError(.codeInvalid, message)
        }
        if m.contains("already registered") { return AuthError(.emailTaken, message) }
        if m.contains("password") && (m.contains("least") || m.contains("8")) {
            return AuthError(.weakPassword, message)
        }
        if status == 429 || m.contains("too many") || m.contains("rate") {
            return AuthError(.rateLimited, message)
        }
        return AuthError(.server, "HTTP \(status): \(message)")
    }
}
