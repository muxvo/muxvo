// muxvo 后端 auth client（右上角批 B5；endpoints 逐条对齐 legacy backend-client.ts +
// server/src/routes/auth.ts）。baseURL：env MUXVO_API_URL ?? https://api.muxvo.com
//（legacy 同名 env；dev 可指 http://localhost:3100）。错误：HTTP 非 2xx → AuthError.fromServer
// 稳定码；传输层失败 → AUTH_NETWORK。
import Foundation

public struct OAuthInitResult: Equatable, Sendable {
    public var authUrl: String
    public var state: String
}

public enum OAuthPollResult: Equatable, Sendable {
    case pending
    case tokens(AuthTokens)
}

/// GET /user/me 的档案投影（legacy BackendUser：id/displayName/email/avatarUrl/role）。
public struct BackendProfile: Equatable, Sendable {
    public var displayName: String?
    public var email: String?
    public var avatarUrl: String?
}

public struct AuthBackendClient: Sendable {
    public let baseURL: URL
    private let transport: any AuthTransport

    public init(
        baseURL: URL? = nil,
        transport: any AuthTransport = URLSessionTransport(),
        env: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.baseURL = baseURL
            ?? env["MUXVO_API_URL"].flatMap { URL(string: $0) }
            ?? URL(string: "https://api.muxvo.com")!
        self.transport = transport
    }

    // MARK: - endpoints

    public func oauthInit(provider: String) async throws -> OAuthInitResult {
        let obj = try await postJSON("/auth/\(provider)/init", body: [:])
        guard let url = obj["authUrl"] as? String, let state = obj["state"] as? String else {
            throw AuthError(.server, "oauth init: malformed response")
        }
        return OAuthInitResult(authUrl: url, state: state)
    }

    public func oauthPoll(state: String) async throws -> OAuthPollResult {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/auth/poll"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "state", value: state)]
        let obj = try await sendExpectJSON(URLRequest(url: comps.url!))
        if obj["pending"] as? Bool == true { return .pending }
        guard let access = obj["accessToken"] as? String, let refresh = obj["refreshToken"] as? String else {
            return .pending // one-time key 已被读走等边缘 → 继续等（超时兜底在 manager）
        }
        return .tokens(AuthTokens(accessToken: access, refreshToken: refresh))
    }

    public func sendEmailCode(email: String, purpose: String) async throws {
        _ = try await postJSON("/auth/email/send", body: ["email": email, "purpose": purpose])
    }

    public func passwordLogin(email: String, password: String) async throws -> AuthTokens {
        try tokens(from: try await postJSON("/auth/password/login", body: ["email": email, "password": password]))
    }

    public func register(email: String, code: String, password: String) async throws -> AuthTokens {
        try tokens(from: try await postJSON(
            "/auth/password/register", body: ["email": email, "code": code, "password": password]))
    }

    public func resetPassword(email: String, code: String, newPassword: String) async throws {
        _ = try await postJSON(
            "/auth/password/reset", body: ["email": email, "code": code, "newPassword": newPassword])
    }

    public func refresh(refreshToken: String) async throws -> AuthTokens {
        try tokens(from: try await postJSON("/auth/refresh", body: ["refreshToken": refreshToken]))
    }

    public func logout(refreshToken: String) async throws {
        _ = try await postJSON("/auth/logout", body: ["refreshToken": refreshToken])
    }

    public func profile(accessToken: String) async throws -> BackendProfile {
        var req = URLRequest(url: baseURL.appendingPathComponent("/user/me"))
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let obj = try await sendExpectJSON(req)
        return BackendProfile(
            displayName: obj["displayName"] as? String ?? obj["username"] as? String,
            email: obj["email"] as? String,
            avatarUrl: obj["avatarUrl"] as? String)
    }

    // MARK: - 传输与解码

    private func tokens(from obj: [String: Any]) throws -> AuthTokens {
        guard let access = obj["accessToken"] as? String, let refresh = obj["refreshToken"] as? String else {
            throw AuthError(.server, "malformed token response")
        }
        return AuthTokens(accessToken: access, refreshToken: refresh)
    }

    private func postJSON(_ path: String, body: [String: String]) async throws -> [String: Any] {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return try await sendExpectJSON(req)
    }

    private func sendExpectJSON(_ req: URLRequest) async throws -> [String: Any] {
        let data: Data
        let status: Int
        do {
            (data, status) = try await transport.send(req)
        } catch let e as AuthError {
            throw e
        } catch {
            throw AuthError(.network, "transport: \(error.localizedDescription)")
        }
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let message = (obj["message"] as? String)
                ?? (obj["error"] as? String)
                ?? String(data: data.prefix(200), encoding: .utf8) ?? ""
            throw AuthError.fromServer(status: status, message: message)
        }
        return obj
    }
}
